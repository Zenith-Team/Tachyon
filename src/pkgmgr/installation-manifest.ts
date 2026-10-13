import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import semver from 'semver';
import { abort, CommonDirs, CommonFiles, fs_move, fs_rmrf_unlink, isObject, isSafeFilename, randomShortUUID, trySymlink } from '../utils.js';
import { type ProjectConfigFile } from '../shared/projectconfig.js';
import { type ResolvedDependency, type Lockfile } from './lockfile.js';
import { normalizeGitHubReleaseURL } from './pkg-resolver.js';
interface InstalledPackage {
    Current: string;
    Source: string;
    Hash: string;
    Kind: 'archive' | 'link';
}
function validatePackageProjectConfig(config: ProjectConfigFile, name: string, dependency: ResolvedDependency): void {
    if (config.Name !== name)
        abort.thrown(`Name mismatch for package "${name}": package config declares "${config.Name}".`);
    const version = typeof config.Version === 'string' ? semver.valid(config.Version) : null;
    if (!version || (dependency.Hash !== '0' && version !== dependency.Current)) {
        abort.thrown(`Version mismatch for package "${name}": required ${dependency.Current}, package config declares ${config.Version}.`);
    }
}
export class InstallationManifest {
    readonly #manifestFilePath: string;
    readonly #packages = new Map<string, InstalledPackage>();
    #cacheCleared = false;
    constructor(private readonly projectDir: string) {
        this.#manifestFilePath = path.join(projectDir, CommonDirs.Intermediate, CommonFiles.LocalPackagesLock);
        let data: unknown;
        try {
            data = JSON.parse(fs.readFileSync(this.#manifestFilePath, 'utf8')) as unknown;
        }
        catch (err) {
            if (err instanceof SyntaxError || (err as NodeJS.ErrnoException).code === 'ENOENT')
                return;
            throw err;
        }
        if (!isObject(data) || data.Version !== 1 || !isObject(data.Packages))
            return;
        for (const [name, entry] of Object.entries(data.Packages)) {
            if (!isSafeFilename(name) || !isObject(entry)
                || typeof entry.Current !== 'string' || !semver.valid(entry.Current)
                || typeof entry.Source !== 'string' || typeof entry.Hash !== 'string'
                || (entry.Kind !== 'archive' && entry.Kind !== 'link')
                || (entry.Kind === 'link' ? entry.Hash !== '0' : !/^[a-f\d]{64}$/.test(entry.Hash))) {
                this.#packages.clear();
                return;
            }
            this.#packages.set(name, {
                Current: entry.Current, Source: entry.Source, Hash: entry.Hash, Kind: entry.Kind,
            });
        }
    }
    #packagePath(name: string): string {
        if (!isSafeFilename(name))
            abort.thrown(`Package "${name}" has an illegal name.`);
        return path.join(this.projectDir, CommonDirs.Packages, name);
    }
    #identity(dependency: ResolvedDependency): InstalledPackage {
        return {
            Current: dependency.Current,
            Source: dependency.Hash === '0' ? path.resolve(this.projectDir, dependency.Source) : normalizeGitHubReleaseURL(dependency.Source),
            Hash: dependency.Hash,
            Kind: dependency.Hash === '0' ? 'link' : 'archive',
        };
    }
    status(pkgName: string, dependency: ResolvedDependency): string | undefined {
        const pkgDir = this.#packagePath(pkgName);
        const stat = fs.lstatSync(pkgDir, { throwIfNoEntry: false });
        if (!stat)
            return 'missing';
        const expected = this.#identity(dependency);
        if (stat.isSymbolicLink() !== (expected.Kind === 'link'))
            return 'installation kind differs';
        if (expected.Kind === 'link') {
            try {
                if (!fs.statSync(pkgDir).isDirectory())
                    return 'missing';
                if (fs.realpathSync(pkgDir) !== fs.realpathSync(expected.Source))
                    return 'link target differs';
            }
            catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT')
                    return 'missing';
                throw err;
            }
        }
        else if (!stat.isDirectory())
            return 'missing';
        const installed = this.#packages.get(pkgName);
        if (!installed)
            return 'unverified';
        if (installed.Current !== expected.Current)
            return `installed ${installed.Current}`;
        if (installed.Source !== expected.Source || installed.Hash !== expected.Hash || installed.Kind !== expected.Kind) {
            return 'package source or hash differs';
        }
        return undefined;
    }
    assertInstalled(lockfile: Lockfile): void {
        for (const [depName, dependency] of Object.entries(lockfile.ResolvedDependencies)) {
            const status = this.status(depName, dependency);
            if (status)
                abort(`Dependency "${depName}" requires ${dependency.Current}, ${status}. Run "tachyon pm install".`);
        }
    }
    #save(): void {
        fs.mkdirSync(path.dirname(this.#manifestFilePath), { recursive: true });
        const tmpPath = `${this.#manifestFilePath}-${randomShortUUID()}.tmp`;
        try {
            fs.writeFileSync(tmpPath, JSON.stringify({ Version: 1, Packages: Object.fromEntries(this.#packages) }, null, 2));
            fs.renameSync(tmpPath, this.#manifestFilePath);
        }
        finally {
            fs.rmSync(tmpPath, { force: true });
        }
    }
    #invalidate(name: string): void {
        const deleted = this.#packages.delete(name);
        if (!deleted)
            return;
        this.#save();
        if (!this.#cacheCleared) {
            fs.rmSync(path.join(this.projectDir, CommonDirs.Objs), { recursive: true, force: true });
            this.#cacheCleared = true;
        }
    }
    async uninstall(pkgName: string): Promise<void> {
        const pkgDir = this.#packagePath(pkgName);
        this.#invalidate(pkgName);
        await fs_rmrf_unlink(pkgDir);
    }
    async install(pkgName: string, dependency: ResolvedDependency, sourceDir: string, replaceLink = false): Promise<void> {
        const pkgDir = this.#packagePath(pkgName);
        const identity = this.#identity(dependency);
        const config = JSON5.parse<ProjectConfigFile>(fs.readFileSync(path.join(sourceDir, CommonFiles.Config), 'utf8'));
        const existing = fs.lstatSync(pkgDir, { throwIfNoEntry: false });
        validatePackageProjectConfig(config, pkgName, dependency);
        if (!replaceLink && identity.Kind === 'archive' && existing?.isSymbolicLink()) {
            abort.thrown(`Package "${pkgName}" is linked locally. Uninstall it before installing the locked archive.`);
        }
        this.#invalidate(pkgName);
        fs.mkdirSync(path.dirname(pkgDir), { recursive: true });
        const backupDir = `${pkgDir}-${randomShortUUID()}.tmp`;
        if (existing)
            fs.renameSync(pkgDir, backupDir);
        try {
            if (identity.Kind === 'link') {
                if (!trySymlink(pkgDir, path.resolve(sourceDir)))
                    abort.thrown(`Unable to create symlink for package "${pkgName}".`);
            }
            else {
                fs_move(sourceDir, pkgDir);
            }
        }
        catch (err) {
            await fs_rmrf_unlink(pkgDir);
            if (existing)
                fs.renameSync(backupDir, pkgDir);
            throw err;
        }
        if (existing)
            await fs_rmrf_unlink(backupDir);
        this.#packages.set(pkgName, identity);
        this.#save();
    }
}
