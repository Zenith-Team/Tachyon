import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';
import JSON5 from 'json5';
import { extract as extractZip } from 'zip-lib';
import { abort, CommonDirs, CommonFiles, sha256hex, fs_move, isSafeFilename, fs_rmrf_unlink } from '../utils.js';
import { type DirectDependency, type ResolvedDependency, Lockfile } from './lockfile.js';
import { locationType, PkgInstallSourceLocationType } from './pkg-resolver.js';
import { buildRegistryFromDirectDeps, resolvePackageVersions } from './pkg-registry.js';
import { mapConcurrent } from './pkg-installer.js';
import { AssertField, type ProjectConfigFile } from '../shared/projectconfig.js';
export async function downloadAndExtract(url: string): Promise<{
    tempDir: string;
    sha256: string;
}> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tpkg-upd-'));
    try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!resp.ok || !resp.body)
            abort.thrown(`Download failed for ${url}: ${resp.status} ${resp.statusText}`);
        const data = await resp.bytes();
        const hash = sha256hex(data);
        await extractZip(Buffer.from(data), tempDir, {
            overwrite: true, safeSymlinksOnly: true, forceFileMode: 0o644, forceDirMode: 0o755,
        });
        return { tempDir, sha256: hash };
    }
    catch (e) {
        await fs.rm(tempDir, { recursive: true, force: true });
        throw e;
    }
}
export function collectConstraintsOn(deps: Record<string, DirectDependency>, targetName: string, requiredBy = '(root)'): Array<{
    constraint: string;
    requiredBy: string;
}> {
    const result: Array<{
        constraint: string;
        requiredBy: string;
    }> = [];
    for (const [name, dep] of Object.entries(deps)) {
        if (name === targetName) {
            result.push({ constraint: dep.Version, requiredBy });
        }
        else if (dep.Dependencies) {
            result.push(...collectConstraintsOn(dep.Dependencies, targetName, name));
        }
    }
    return result;
}
export function reachableNames(deps: Record<string, DirectDependency>): Set<string> {
    const seen = new Set<string>();
    const walk = (d: Record<string, DirectDependency>) => {
        for (const [name, dep] of Object.entries(d)) {
            if (seen.has(name))
                continue;
            seen.add(name);
            if (dep.Dependencies)
                walk(dep.Dependencies);
        }
    };
    walk(deps);
    return seen;
}
interface PlannedUpdate {
    pkgName: string;
    ghRef: string;
    oldVersion: string;
    newVersion: string;
    tempDir: string;
    sha256: string;
    sourceURL: string;
    newSubResolved: Record<string, ResolvedDependency>;
    newSubDirect: Record<string, DirectDependency>;
    newConfig: ProjectConfigFile;
}
export async function updatePackagesWithResolution(lockfile: Lockfile, projectDir: string, packageNames: string[] = [], pre: boolean = false): Promise<void> {
    if (packageNames.length === 0 && Object.keys(lockfile.DirectDependencies).length === 0) {
        console.info('No direct dependencies to update.');
        return;
    }
    const targets = packageNames.length > 0 ? packageNames : Object.keys(lockfile.DirectDependencies);
    const filteredDirectDeps: Record<string, DirectDependency> = {};
    for (const name of targets) {
        if (!lockfile.DirectDependencies[name]) {
            abort.thrown(`"${name}" is not a direct dependency. Available: ${Object.keys(lockfile.DirectDependencies).join(', ') || '(none)'}`);
        }
        filteredDirectDeps[name] = lockfile.DirectDependencies[name]!;
    }
    const registry = await buildRegistryFromDirectDeps(filteredDirectDeps);
    const resolved = await resolvePackageVersions(filteredDirectDeps, registry, pre);
    console.info('Resolved update versions:', resolved);
    await updateDepsWithResolved(lockfile, projectDir, targets, resolved, pre);
}
export async function updateDepsWithResolved(lockfile: Lockfile, projectDir: string, packageNames: string[], resolved: Record<string, string>, pre: boolean = false): Promise<void> {
    const targets = packageNames.length > 0 ? packageNames : Object.keys(lockfile.DirectDependencies);
    for (const name of targets) {
        if (!lockfile.DirectDependencies[name]) {
            abort.thrown(`"${name}" is not a direct dependency. Available: ${Object.keys(lockfile.DirectDependencies).join(', ') || '(none)'}`);
        }
    }
    const packagesDir = path.join(projectDir, CommonDirs.Packages);
    await fs.mkdir(packagesDir, { recursive: true });
    const tempDirs: string[] = [];
    try {
        const plan: PlannedUpdate[] = [];
        for (const pkgName of targets) {
            const directDep = lockfile.DirectDependencies[pkgName]!;
            const resolvedVersion = resolved[pkgName];
            if (!resolvedVersion) {
                console.warn(`  skip "${pkgName}": not found in resolved versions`);
                continue;
            }
            if ((await locationType(pkgName, directDep.Source)) !== PkgInstallSourceLocationType.GitHubRepo) {
                console.info(`  skip "${pkgName}": not a GitHub-hosted package (${directDep.Source})`);
                continue;
            }
            const currentVersion = lockfile.ResolvedDependencies[pkgName]?.Current ?? '0.0.0';
            if (resolvedVersion === currentVersion) {
                console.info(`  ${pkgName}@${currentVersion} ✓ already at latest compatible version`);
                continue;
            }
            console.info(`  ${pkgName}: ${currentVersion} -> ${resolvedVersion}  (downloading...)`);
            const downloadURL = `https://github.com/${directDep.Source}/releases/download/${resolvedVersion}/package.zip`;
            const { tempDir, sha256 } = await downloadAndExtract(downloadURL);
            tempDirs.push(tempDir);
            const newConfig = JSON5.parse<ProjectConfigFile>(await fs.readFile(path.join(tempDir, CommonFiles.Config), 'utf8'));
            AssertField.Type('Name', newConfig.Name, 'string', true);
            if (!isSafeFilename(newConfig.Name))
                abort.thrown(`Package "${newConfig.Name}" has an illegal name`);
            if (newConfig.Name !== pkgName) {
                abort.thrown(`Name mismatch: lockfile key is "${pkgName}" but package config says "${newConfig.Name}". ` +
                    'This may indicate a mis-configured package or lockfile corruption.');
            }
            const embeddedLockfile = existsSync(path.join(tempDir, CommonFiles.Lockfile))
                ? Lockfile.load(path.join(tempDir, CommonFiles.Lockfile))
                : null;
            plan.push({
                pkgName,
                ghRef: directDep.Source,
                oldVersion: currentVersion,
                newVersion: resolvedVersion,
                tempDir,
                sha256,
                sourceURL: downloadURL,
                newSubResolved: embeddedLockfile?.ResolvedDependencies ?? {},
                newSubDirect: embeddedLockfile?.DirectDependencies ?? {},
                newConfig,
            });
        }
        if (plan.length === 0) {
            console.info('All specified packages are already up to date.');
            return;
        }
        const updatedDirectDeps: Record<string, DirectDependency> = { ...lockfile.DirectDependencies };
        for (const entry of plan) {
            updatedDirectDeps[entry.pkgName] = {
                ...updatedDirectDeps[entry.pkgName]!,
                Dependencies: entry.newSubDirect,
            };
        }
        const versionChanges = new Map<string, string>(plan.map(e => [e.pkgName, e.newVersion]));
        for (const entry of plan) {
            for (const [subName, subDep] of Object.entries(entry.newSubResolved)) {
                const currentVer = lockfile.ResolvedDependencies[subName]?.Current;
                if (currentVer !== subDep.Current) {
                    const existing = versionChanges.get(subName);
                    if (!existing || semver.gt(subDep.Current, existing)) {
                        versionChanges.set(subName, subDep.Current);
                    }
                }
            }
        }
        for (const [pkgName, newVersion] of versionChanges) {
            const constraints = collectConstraintsOn(updatedDirectDeps, pkgName);
            for (const { constraint, requiredBy } of constraints) {
                if (!semver.satisfies(newVersion, constraint, { includePrerelease: pre })) {
                    abort.thrown(`Version conflict: cannot update "${pkgName}" to ${newVersion}\n` +
                        `  "${requiredBy}" requires: ${constraint}\n` +
                        `  ${newVersion} does not satisfy that constraint.\n` +
                        `  Tip: try updating "${requiredBy}" first, or adjust its version constraint.`);
                }
            }
        }
        const updatedResolvedDeps: Record<string, ResolvedDependency> = { ...lockfile.ResolvedDependencies };
        for (const entry of plan) {
            const finalDir = path.join(packagesDir, entry.pkgName);
            console.info(`  installing ${entry.pkgName}@${entry.newVersion}`);
            await fs_rmrf_unlink(finalDir);
            fs_move(entry.tempDir, finalDir);
            updatedResolvedDeps[entry.pkgName] = {
                Current: entry.newVersion,
                Source: entry.sourceURL,
                Hash: entry.sha256,
                IncludeDirs: (entry.newConfig.IncludeDirs ?? []).map(dir => path.relative(projectDir, path.join(packagesDir, entry.pkgName, dir))),
            };
        }
        const subDepUpdates = new Map<string, ResolvedDependency>();
        for (const entry of plan) {
            for (const [subName, subDep] of Object.entries(entry.newSubResolved)) {
                const current = lockfile.ResolvedDependencies[subName];
                if (current?.Current !== subDep.Current) {
                    const queued = subDepUpdates.get(subName);
                    if (!queued || semver.gt(subDep.Current, queued.Current)) {
                        subDepUpdates.set(subName, subDep);
                    }
                }
            }
        }
        const transitiveEntries = [...subDepUpdates];
        const transitiveResults = await mapConcurrent(transitiveEntries, async ([subName, subDep]) => {
            const fromVer = lockfile.ResolvedDependencies[subName]?.Current ?? 'none';
            console.info(`  transitive: ${subName}  ${fromVer} -> ${subDep.Current}`);
            const { tempDir, sha256 } = await downloadAndExtract(subDep.Source);
            tempDirs.push(tempDir);
            if (sha256 !== subDep.Hash) {
                abort.thrown(`Integrity check failed for sub-dep "${subName}" (expected ${subDep.Hash}, got ${sha256})`);
            }
            const finalDir = path.join(packagesDir, subName);
            await fs_rmrf_unlink(finalDir);
            fs_move(tempDir, finalDir);
            const subConfig = JSON5.parse<ProjectConfigFile>(await fs.readFile(path.join(finalDir, CommonFiles.Config), 'utf8'));
            return {
                [subName]: {
                    ...subDep,
                    IncludeDirs: (subConfig.IncludeDirs ?? []).map(dir => path.relative(projectDir, path.join(packagesDir, subName, dir))),
                }
            };
        }, 10);
        for (const result of transitiveResults) {
            Object.assign(updatedResolvedDeps, result);
        }
        const stillNeeded = reachableNames(updatedDirectDeps);
        const orphans = Object.keys(updatedResolvedDeps).filter(name => !stillNeeded.has(name));
        if (orphans.length > 0) {
            console.info(`  removing ${orphans.length} orphaned package(s): ${orphans.join(', ')}`);
            for (const orphan of orphans) {
                await fs_rmrf_unlink(path.join(packagesDir, orphan));
                Reflect.deleteProperty(updatedResolvedDeps, orphan);
            }
        }
        lockfile.DirectDependencies = updatedDirectDeps;
        lockfile.ResolvedDependencies = updatedResolvedDeps;
        lockfile.save();
        const summary = plan.map(e => `${e.pkgName} (${e.oldVersion} -> ${e.newVersion})`).join(', ');
        console.success(`Updated: ${summary}`);
    }
    finally {
        for (const dir of tempDirs) {
            await fs.rm(dir, { recursive: true, force: true });
        }
    }
}
