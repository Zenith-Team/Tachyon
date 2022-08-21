export type u8  = number;
export type u16 = number;
export type u32 = number;
export type u64 = bigint;
export type s8  = number;
export type s16 = number;
export type s32 = number;
export type s64 = bigint;

declare global {
    interface Process {
        exit(code?: number): never;
    }
}

/**
 * Convert absolute WSL path to Windows path, if possible. Otherwise return the path unchanged.
 */
export function WindowsPath(path: string) {
    return path.replace(/^\/mnt\/([a-z])\//, ($0, $1: string) => `${$1.toUpperCase()}:/`);
}

/**
 * Convert absolute Windows path to WSL path, if possible. Otherwise return the path unchanged.
 * 
 * Unconditionally changes all backslashes to forward slashes, if any.
 */
export function UnixPath(path: string) {
    path = path.replaceAll('\\', '/');
    if (path[1] === ':') path = `/___drive___${path[0]}${path.slice(2)}`;
    return path;
}

/**
 * For use with UnixPath output
 */
export function ResolveDrive(path: string) {
    if (!path.startsWith('/___drive___')) return path;
    const drive = path[12];
    return `${drive}:${path.slice(13)}`;
}
