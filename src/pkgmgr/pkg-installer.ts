import JSON5 from 'json5';
import os from 'node:os';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { extract as extractZip } from 'zip-lib';
import { abort, CommonDirs, CommonFiles, fs_move, isSafeFilename, trySymlink, sha256hex, fs_rmrf_unlink, isFolderAt, toPortablePath } from '../utils.js';
import { AssertField, type ProjectConfigFile } from '../shared/projectconfig.js';
import { locationType, normalizeGitHubRepoRef, PkgInstallSourceLocationType } from './pkg-resolver.js';
import { type DirectDependency, type ResolvedDependency, isPinnedVersionConstraint, Lockfile } from './lockfile.js';
import { reachableNames, downloadAndExtract } from './pkg-updater.js';
import { buildRegistryFromDirectDeps, resolvePackageVersions } from './pkg-registry.js';
export async function mapConcurrent<T, R>(inputs: T[], fn: (input: T) => Promise<R>, concurrency: number): Promise<R[]> {
    const results: R[] = new Array<R>(inputs.length);
    let nextIndex = 0;
    async function worker(): Promise<void> {
        while (nextIndex < inputs.length) {
            const i = nextIndex++;
            results[i] = await fn(inputs[i]!);
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker());
    await Promise.all(workers);
    return results;
}
interface InstallFromTempResult {
    pkgName: string;
}
async function installPackageFromTemp(lockfile: Lockfile, projectDir: string, tempDir: string, pkgRef: string, versionConstraint: string, sourceURL: string, hash: string, isDirect: boolean, resolvedVersion?: string): Promise<InstallFromTempResult> {
    const isSymlink = hash === '0';
    const sourceDir = path.resolve(tempDir);
    const tpkgConfig = JSON5.parse<ProjectConfigFile>(await fs.readFile(path.join(sourceDir, CommonFiles.Config), 'utf8'));
    AssertField.Type('Name', tpkgConfig.Name, 'string', true);
    const tpkgName = tpkgConfig.Name;
    if (!isSafeFilename(tpkgName)) {
        abort.thrown(`Package ${tpkgName} has illegal name`);
    }
    AssertField.Type('Version', tpkgConfig.Version, 'string', true);
    const packageVersion = semver.valid(tpkgConfig.Version);
    if (!packageVersion) {
        abort.thrown(`Package "${tpkgName}" has invalid Version "${tpkgConfig.Version}"; expected a fixed semantic version.`);
    }
    if (resolvedVersion && packageVersion !== resolvedVersion) {
        abort.thrown(`Version mismatch for package "${tpkgName}": resolved release ${resolvedVersion} ` +
            `but package config declares ${packageVersion}.`);
    }
    const tpkgFinalDir = path.join(projectDir, CommonDirs.Packages, tpkgName);
    const resolvedTpkgLock: ResolvedDependency = {
        Current: packageVersion,
        Source: sourceURL,
        Hash: hash,
        IncludeDirs: (tpkgConfig.IncludeDirs ?? []).map(dir => {
            return toPortablePath(path.relative(projectDir, path.join(projectDir, CommonDirs.Packages, tpkgName, dir)));
        }),
    };
    const existing = lockfile.ResolvedDependencies[tpkgName];
    if (existing && existing.Current !== resolvedTpkgLock.Current) {
        abort.thrown(`Version conflict for "${tpkgName}": ` +
            `already resolved to ${existing.Current} but ${pkgRef} requires ${resolvedTpkgLock.Current}.\n` +
            '  Run `tachyon update` or adjust your dependency constraints.');
    }
    if (!isSymlink) {
        fs_move(sourceDir, tpkgFinalDir, true);
    }
    else {
        await fs_rmrf_unlink(tpkgFinalDir);
        console.debug('pkg-installer symlink call', tpkgFinalDir, '->', sourceDir);
        const symlinkOK = trySymlink(tpkgFinalDir, sourceDir);
        if (!symlinkOK)
            abort.thrown('Unable to create symlink in your filesystem.');
    }
    lockfile.ResolvedDependencies[tpkgName] = resolvedTpkgLock;
    let tpkgLockfile: Lockfile | null = null;
    const tpkgLockfilePath = path.join(tpkgFinalDir, CommonFiles.Lockfile);
    if (existsSync(tpkgLockfilePath)) {
        tpkgLockfile = Lockfile.load(tpkgLockfilePath);
    }
    if (tpkgLockfile) {
        for (const [depName, depEntry] of Object.entries(tpkgLockfile.ResolvedDependencies)) {
            const existing = lockfile.ResolvedDependencies[depName];
            if (existing && existing.Current !== depEntry.Current) {
                abort.thrown(`Version conflict for "${depName}": ` +
                    `already resolved to ${existing.Current} but "${tpkgName}" requires ${depEntry.Current}.\n` +
                    '  Run `tachyon update` or adjust your dependency constraints.');
            }
        }
    }
    let depdeps: Record<string, DirectDependency>;
    if (tpkgLockfile) {
        depdeps = tpkgLockfile.DirectDependencies;
    }
    else {
        depdeps = {};
    }
    if (isDirect) {
        lockfile.DirectDependencies[tpkgName] = {
            Source: pkgRef,
            Version: isSymlink ? '*' : (isPinnedVersionConstraint(versionConstraint) ? versionConstraint : `^${packageVersion}`),
            Dependencies: depdeps,
        };
    }
    return { pkgName: tpkgName };
}
async function runTasksWithCleanup(tasks: Array<{
    run: () => Promise<void>;
}>): Promise<void> {
    const errors: Error[] = [];
    const promises = tasks.map(t => (async () => {
        try {
            await t.run();
        }
        catch (e) {
            errors.push(e instanceof Error ? e : new Error(String(e)));
        }
    })());
    await Promise.all(promises);
    if (errors.length > 0)
        throw new AggregateError(errors, 'Errors while running tasks');
}
function subDepTask(subName: string, subDep: ResolvedDependency, lockfile: Lockfile, packagesDir: string, tempDirs: string[]): {
    run: () => Promise<void>;
} {
    return {
        run: async () => {
            if (subDep.Hash === '0') {
                if (!await isFolderAt(subDep.Source)) {
                    abort.thrown(`Sub-dependency "${subName}" has a local symlink source that no longer exists: ${subDep.Source}`);
                }
                const sourceDir = path.resolve(subDep.Source);
                const tpkgDir = path.join(packagesDir, subName);
                await fs_rmrf_unlink(tpkgDir);
                console.debug('pkg-installer symlink sub-dep', tpkgDir, '->', sourceDir);
                const symlinkOK = trySymlink(tpkgDir, sourceDir);
                if (!symlinkOK)
                    abort.thrown(`Unable to create symlink for sub-dependency "${subName}"`);
                lockfile.ResolvedDependencies[subName] = subDep;
                const embeddedLockfilePath = path.join(tpkgDir, CommonFiles.Lockfile);
                if (existsSync(embeddedLockfilePath)) {
                    const subLockfile = Lockfile.load(embeddedLockfilePath);
                    for (const [deepName, deepDep] of Object.entries(subLockfile.ResolvedDependencies)) {
                        lockfile.ResolvedDependencies[deepName] ??= deepDep;
                    }
                }
                return;
            }
            const parsedURL = URL.parse(subDep.Source);
            if (parsedURL?.hostname !== 'github.com')
                abort.thrown(`Invalid source location for package ${subName}: ${subDep.Source}`);
            const req = await fetch(parsedURL, { signal: AbortSignal.timeout(120000) });
            if (!req.ok || !req.body)
                throw new Error(`Failed to fetch sub-dep "${subName}" from ${subDep.Source}`);
            const tpkgData = await req.bytes();
            const hash = sha256hex(tpkgData);
            if (hash !== subDep.Hash)
                throw new Error(`Integrity check failed for "${subName}" (expected ${subDep.Hash}, got ${hash})`);
            const tpkgTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tpkg-sub-'));
            tempDirs.push(tpkgTempDir);
            await extractZip(Buffer.from(tpkgData), tpkgTempDir, {
                overwrite: true, safeSymlinksOnly: true, forceFileMode: 0o644, forceDirMode: 0o755,
            });
            const tpkgUnpackDir = path.join(packagesDir, subName);
            if (existsSync(tpkgUnpackDir)) {
                await fs.rm(tpkgUnpackDir, { recursive: true, force: true });
            }
            fs_move(tpkgTempDir, tpkgUnpackDir);
            lockfile.ResolvedDependencies[subName] = subDep;
            const embeddedLockfilePath = path.join(tpkgUnpackDir, CommonFiles.Lockfile);
            if (existsSync(embeddedLockfilePath)) {
                const subLockfile = Lockfile.load(embeddedLockfilePath);
                for (const [deepName, deepDep] of Object.entries(subLockfile.ResolvedDependencies)) {
                    lockfile.ResolvedDependencies[deepName] ??= deepDep;
                }
            }
        },
    };
}
async function resolveSubDependencies(lockfile: Lockfile, _projectDir: string, packagesDir: string): Promise<void> {
    const lockfiles = Object.entries(lockfile.ResolvedDependencies).map(([depName]) => {
        const pkgDir = path.join(packagesDir, depName);
        if (!existsSync(pkgDir))
            return null;
        const lockfilePath = path.join(pkgDir, CommonFiles.Lockfile);
        if (!existsSync(lockfilePath))
            return null;
        try {
            const embeddedLockfile = Lockfile.load(lockfilePath);
            return { depName, embeddedLockfile };
        }
        catch (err) {
            console.warn(`Failed to load lockfile for "${depName}": ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    });
    const stillNeeded = reachableNames(lockfile.DirectDependencies);
    const tempDirs: string[] = [];
    try {
        const subDepTaskMap = new Map<string, {
            run: () => Promise<void>;
        }>();
        for (const result of lockfiles) {
            if (!result)
                continue;
            const { embeddedLockfile } = result;
            if (Object.keys(embeddedLockfile.ResolvedDependencies).length === 0)
                continue;
            for (const [subName, subDep] of Object.entries(embeddedLockfile.ResolvedDependencies)) {
                if (stillNeeded.has(subName) && !lockfile.ResolvedDependencies[subName] && !subDepTaskMap.has(subName)) {
                    subDepTaskMap.set(subName, subDepTask(subName, subDep, lockfile, packagesDir, tempDirs));
                }
            }
        }
        const subDepTasks = [...subDepTaskMap.values()];
        await runTasksWithCleanup(subDepTasks);
        const missingEntries = Object.entries(lockfile.ResolvedDependencies)
            .filter(([depName]) => stillNeeded.has(depName) && !existsSync(path.join(packagesDir, depName)));
        const missingTasks = missingEntries.map(([depName, dep]) => subDepTask(depName, dep, lockfile, packagesDir, tempDirs));
        await runTasksWithCleanup(missingTasks);
    }
    finally {
        for (const dir of tempDirs) {
            try {
                if (existsSync(dir))
                    await fs.rm(dir, { recursive: true, force: true });
            }
            catch {
                void 0;
            }
        }
    }
}
export async function installAllLockfileDeps(lockfile: Lockfile, projectDir: string) {
    const tempDirs: string[] = [];
    try {
        await mapConcurrent(Object.entries(lockfile.ResolvedDependencies), async ([dependencyName, dependency]) => {
            const parsedURL = URL.parse(dependency.Source);
            if (parsedURL?.hostname !== 'github.com')
                abort.thrown(`Invalid source location for package ${dependencyName}: ${dependency.Source}`);
            console.info(`⬇︎ Downloading ${dependencyName}@${dependency.Current} ...`);
            const req = await fetch(parsedURL, { signal: AbortSignal.timeout(120000) });
            if (!req.ok || !req.body)
                abort.thrown(`Failed to fetch remote release for ${dependencyName} from: ${dependency.Source} (${req.status} ${req.statusText})`);
            const tpkgData: Uint8Array<ArrayBuffer> = await req.bytes();
            const hash = sha256hex(tpkgData);
            if (hash !== dependency.Hash)
                abort.thrown(`Integrity hash check failure for dependency ${dependencyName}`);
            const tpkgUnpackTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tpkg-inst-'));
            tempDirs.push(tpkgUnpackTempDir);
            await extractZip(Buffer.from(tpkgData), tpkgUnpackTempDir, {
                overwrite: true, safeSymlinksOnly: true, forceFileMode: 0o644, forceDirMode: 0o755,
            });
            const tpkgFinalDir = path.join(projectDir, CommonDirs.Packages, dependencyName);
            if (existsSync(tpkgFinalDir)) {
                await fs.rm(tpkgFinalDir, { recursive: true, force: true });
            }
            fs_move(tpkgUnpackTempDir, tpkgFinalDir);
            console.success(`✓ Downloaded ${dependencyName}@${dependency.Current}`);
        }, 5);
        console.success('Project dependencies successfully installed.');
    }
    finally {
        for (const dir of tempDirs) {
            try {
                if (existsSync(dir))
                    await fs.rm(dir, { recursive: true, force: true });
            }
            catch {
                void 0;
            }
        }
    }
}
export async function installPackagesWithResolution(lockfile: Lockfile, projectDir: string, packageRefs: string[], pre: boolean = false): Promise<void> {
    async function packageRefToDep(pkgRef: string): Promise<{
        name: string;
        dep: DirectDependency;
    }> {
        const splitRefVer = pkgRef.split('@');
        if (splitRefVer.length > 2) {
            throw new Error(`Malformed package reference ${pkgRef}`);
        }
        const source = splitRefVer[0]!;
        const constraint = splitRefVer[1] ?? '*';
        if (!source) {
            throw new Error(`Assertion failure: ${pkgRef}`);
        }
        if (!constraint || semver.validRange(constraint) === null) {
            throw new Error(`Invalid semantic version constraint in package reference ${pkgRef}`);
        }
        let pkgName: string;
        const locType = await locationType(pkgRef, source);
        if (locType === PkgInstallSourceLocationType.GitHubRepo) {
            const parts = source.split('/');
            if (parts.length < 2)
                throw new Error(`Invalid GitHub repository reference: ${source}`);
            pkgName = parts.at(-1)!;
        }
        else if (locType === PkgInstallSourceLocationType.LocalFile) {
            const parts = source.split(/[/\\]/);
            pkgName = parts.at(-1)!.replace(/\.zip$/, '');
        }
        else {
            const parts = source.split('/');
            pkgName = parts.at(-1)!.replace(/\.zip$/, '');
        }
        if (!pkgName)
            throw new Error(`Could not determine pkgName for ${source}`);
        const dep: DirectDependency = {
            Source: locType === PkgInstallSourceLocationType.GitHubRepo
                ? normalizeGitHubRepoRef(source)
                : source,
            Version: constraint,
        };
        return { name: pkgName, dep };
    }
    const tempDirs: string[] = [];
    try {
        const newDeps: Record<string, DirectDependency> = {};
        const githubDepsToResolve: Record<string, DirectDependency> = {};
        const packageInfo = new Map<string, {
            tempDir: string;
            sha256: string;
            sourceURL: string;
            resolvedVersion?: string;
        }>();
        for (const pkgRef of packageRefs) {
            const { name, dep } = await packageRefToDep(pkgRef);
            newDeps[name] = dep;
            const locType = await locationType(name, dep.Source);
            if (locType === PkgInstallSourceLocationType.GitHubRepo) {
                githubDepsToResolve[name] = dep;
            }
            else if (locType === PkgInstallSourceLocationType.LocalFile) {
                if (await isFolderAt(dep.Source)) {
                    packageInfo.set(name, { tempDir: dep.Source, sha256: '0', sourceURL: dep.Source });
                }
                else {
                    const pkgData = await fs.readFile(dep.Source);
                    const hash = sha256hex(pkgData);
                    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tpkg-inst-'));
                    tempDirs.push(tempDir);
                    await extractZip(Buffer.from(pkgData), tempDir, {
                        overwrite: true, safeSymlinksOnly: true, forceFileMode: 0o644, forceDirMode: 0o755,
                    });
                    packageInfo.set(name, { tempDir, sha256: hash, sourceURL: dep.Source });
                }
            }
            else {
                throw new Error(`Unsupported package location for ${name}: ${dep.Source}`);
            }
        }
        if (Object.keys(githubDepsToResolve).length > 0) {
            const registry = await buildRegistryFromDirectDeps(githubDepsToResolve);
            const resolved = await resolvePackageVersions(githubDepsToResolve, registry, pre);
            for (const [name, dep] of Object.entries(githubDepsToResolve)) {
                const resolvedVersion = resolved[name];
                if (resolvedVersion === undefined)
                    throw new Error(`Failed to resolve version for package ${name}`);
                console.info(`⬇︎ Downloading ${name}@${resolvedVersion} ...`);
                const downloadURL = `https://github.com/${dep.Source}/releases/download/${resolvedVersion}/package.zip`;
                const { tempDir, sha256 } = await downloadAndExtract(downloadURL);
                tempDirs.push(tempDir);
                packageInfo.set(name, { tempDir, sha256, sourceURL: downloadURL, resolvedVersion });
                console.success(`✓ Downloaded ${name}@${resolvedVersion}`);
            }
        }
        for (const [name, info] of packageInfo) {
            const dependency = newDeps[name]!;
            await installPackageFromTemp(lockfile, projectDir, info.tempDir, dependency.Source, dependency.Version, info.sourceURL, info.sha256, true, info.resolvedVersion);
        }
        const packagesDir = path.join(projectDir, CommonDirs.Packages);
        await resolveSubDependencies(lockfile, projectDir, packagesDir);
        lockfile.save();
        console.success(`Installed ${Object.keys(newDeps).join(', ')}`);
    }
    finally {
        for (const dir of tempDirs) {
            try {
                if (existsSync(dir))
                    await fs.rm(dir, { recursive: true, force: true });
            }
            catch {
                void 0;
            }
        }
    }
}
