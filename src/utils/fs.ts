import fs, { promises as fsp } from 'node:fs';
export function toPortablePath(filepath: string): string {
    return filepath.replaceAll('\\', '/');
}
export function isFolderAtSync(dirpath: string): boolean {
    return tryStatSync(dirpath)?.isDirectory() === true;
}
export function isFileAtSync(filepath: string): boolean {
    return tryStatSync(filepath)?.isFile() === true;
}
export async function isFolderAt(dirpath: string): Promise<boolean> {
    return (await tryStat(dirpath))?.isDirectory() === true;
}
export async function isFileAt(filepath: string): Promise<boolean> {
    return (await tryStat(filepath))?.isFile() === true;
}
export function isSafeFilename(str: string): boolean {
    if (!/^[\w\-!@+;=#^]+$/.test(str) || /^-|-$/.test(str) || str.length > 32)
        return false;
    return true;
}
const STAT_OPTS = { throwIfNoEntry: false } as const;
export function tryStatSync(file: string): fs.Stats | undefined {
    return fs.statSync(file, STAT_OPTS);
}
export function tryStat(file: string): Promise<fs.Stats | undefined> {
    return fsp.stat(file, STAT_OPTS);
}
export function fs_move(src: string, dest: string, force = false) {
    try {
        if (force) {
            if (!fs.existsSync(src))
                return;
            if (fs.existsSync(dest))
                fs.rmSync(dest, { recursive: true, force: true });
        }
        try {
            fs.renameSync(src, dest);
        }
        catch (err: unknown) {
            const hasCode = err instanceof Error && 'code' in err;
            if (hasCode && err.code === 'EXDEV') {
                fs.cpSync(src, dest, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
                fs.rmSync(src, { recursive: true, force: true });
            }
            else {
                throw err;
            }
        }
    }
    catch (err) {
        if (!force)
            throw err;
    }
}
export async function fs_rmrf_unlink(folderPath: string): Promise<void> {
    try {
        const stat = await fsp.lstat(folderPath);
        if (stat.isSymbolicLink()) {
            await fsp.unlink(folderPath);
        }
        else {
            await fsp.rm(folderPath, { recursive: true, force: true });
        }
    }
    catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT')
            return;
        throw err;
    }
}
export function trySymlink(from: string, target: string, type?: fs.symlink.Type | null, silent = false): boolean {
    try {
        fs.symlinkSync(target, from, type);
        return true;
    }
    catch (err: unknown) {
        if (silent)
            return false;
        const hasCode = err instanceof Error && 'code' in err;
        const windowsIsATerribleOS = hasCode && process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EACCES');
        console.warn(`Failed to create symlink: ${hasCode ? err.message : 'Unknown error'}` +
            (windowsIsATerribleOS ? '\nYou may fix this by enabling Developer Mode in Windows settings.' : ''));
        if (process.env.TACHYON_DEBUG)
            throw err;
        return false;
    }
}
export enum CommonDirs {
    PkgIntermediate = '.tpkg',
    PkgExports = `${PkgIntermediate}/exports`,
    Intermediate = '.tachyon',
    Exports = `${Intermediate}/exports`,
    Linker = `${Intermediate}/linker`,
    Objs = `${Intermediate}/objs`,
    SymbolMaps = `${Intermediate}/maps`,
    Packages = `${Intermediate}/packages`,
    ConversionMaps = 'conv',
    DefaultOutputPath = 'out',
    BundleOutputPath = `${DefaultOutputPath}/bundle`,
    Project = 'project',
    TachyonHome = 'tachyon-zenith'
}
export enum CommonFiles {
    Config = 'project.json5',
    Lockfile = 'project-deps.json',
    LinkerDirective = 'project.ld',
    ProjectCache = '.project-cache',
    MainSymbolMap = 'syms.map',
    Redirects = '__redirects.S',
    Initializer = '__initializer.cpp',
    CompileDB = 'compile_commands.json',
    TachyonUpdateCheck = 'tachyon_updchk',
    TachyonConfig = 'tachyon.config',
    TachyonToolchainLock = 'tachyon.lock'
}
