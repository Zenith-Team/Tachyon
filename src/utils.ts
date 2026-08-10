import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import nodeCrypto from 'node:crypto';
import type { ProjectConfig } from './shared/projectconfig.js';
import type { int } from 'rpxlib';
import { isFileAtSync, isFolderAtSync, CommonDirs, CommonFiles } from './utils/fs.js';
export * from './utils/fs.js';
export * from './utils/titleid.js';
export type u8 = number;
export type u16 = number;
export type u32 = number;
export type u64 = bigint;
export type s8 = number;
export type s16 = number;
export type s32 = number;
export type s64 = bigint;
export class AbortError extends Error {
    // eslint-disable-next-line unicorn/custom-error-definition
    constructor(msg: string, public code: number = 1) {
        super(msg);
        this.name = 'AbortError';
        process.exitCode = code;
        setTimeout(() => {
            console.error('Forcefully terminated.');
            process.exit(code);
        }, 3000).unref();
    }
}
export function abort(msg: string, code: number = 1): never {
    console.error(msg);
    return process.exit(code);
}
abort.thrown = (msg: string, code: number = 1): never => {
    console.error(msg);
    throw new AbortError(msg, code);
};
export function hex(num: int | bigint | number, pad: number = 8, prefix = '0x'): string {
    return prefix + num.toString(16).toUpperCase().padStart(pad, '0');
}
export function sha256hex(data: Uint8Array): string {
    return nodeCrypto.createHash('sha256').update(data).digest('hex');
}
export function getAllTargets(config: ProjectConfig) {
    const allTargets: string[] = [];
    for (const targetName in config.targets) {
        const target = config.targets[targetName];
        if (target?.AbstractOnly)
            continue;
        allTargets.push(targetName);
    }
    return allTargets;
}
export function validateProjectFolder(externalProjectDir?: string): string {
    const cwd = process.cwd();
    const projectDir = externalProjectDir
        ? path.resolve(cwd, externalProjectDir)
        : (isFileAtSync(path.join(cwd, CommonFiles.Config)) ? cwd : path.resolve(cwd, CommonDirs.Project));
    if (!isFolderAtSync(projectDir))
        abort(externalProjectDir
            ? 'Externally referenced project folder does not exist!'
            : 'Project folder does not exist! Are you in a valid directory?');
    if (!isFileAtSync(path.join(projectDir, CommonFiles.Config)))
        abort(externalProjectDir
            ? `Externally referenced project folder does not have a ${CommonFiles.Config}!`
            : `Project folder does not have a ${CommonFiles.Config}!`);
    return projectDir;
}
interface FileConflict {
    srcPath: string;
    dstPath: string;
}
export function findFileConflicts(src: string, dst: string) {
    const conflicts: FileConflict[] = [];
    const scanDirectory = (srcDir: string, dstDir: string, basePath: string = '') => {
        const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const srcEntry of srcEntries) {
            const srcPath = path.join(srcDir, srcEntry.name);
            const dstPath = path.join(dstDir, srcEntry.name);
            const relativePath = path.join(basePath, srcEntry.name);
            if (srcEntry.isDirectory() && fs.existsSync(dstPath)) {
                scanDirectory(srcPath, dstPath, relativePath);
            }
            else if (srcEntry.isFile() && isFileAtSync(dstPath)) {
                conflicts.push({ srcPath, dstPath });
            }
        }
    };
    if (fs.existsSync(dst))
        scanDirectory(src, dst);
    return conflicts;
}
export async function confirm(prompt: string) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, historySize: 0 });
    while (true) {
        const answer = (await rl.question(prompt)).toLowerCase();
        if (answer === 'y') {
            rl.close();
            return true;
        }
        if (answer === 'n') {
            rl.close();
            return false;
        }
    }
}
export async function downloadFile(url: string, toPath: string, reqInit?: RequestInit, etagAware?: true): Promise<string | null>;
export async function downloadFile(url: string, toPath: string, reqInit?: RequestInit, etagAware?: false): Promise<void>;
export async function downloadFile(url: string, toPath: string, reqInit?: RequestInit, etagAware = false): Promise<string | null | void> {
    try {
        const res = await fetch(url, reqInit);
        if (etagAware && res.status === 304) {
            console.debug('ETag cache hit.');
            return null;
        }
        if (!res.ok)
            throw new Error(`Non-OK status code: ${res.status.toString()} (${res.statusText})`);
        if (!res.body)
            throw new Error(`No response body: ${res.status.toString()} (${res.statusText})`);
        // @ts-expect-error ----------                   
        const rstream = Readable.fromWeb(res.body);
        const wstream = fs.createWriteStream(toPath);
        await pipeline(rstream, wstream);
        if (etagAware) {
            const etag = res.headers.get('etag');
            if (!etag)
                throw new Error('ETag requested but none received.');
            return etag;
        }
    }
    catch (error) {
        console.debug(error);
        abort(`Failed to download ${url} (${(error as Error).message})`);
    }
}
export function randomLongUUID(): string {
    const bytes = nodeCrypto.randomBytes(16);
    bytes[6] = (bytes[6]! & 0x0F) | 0x40;
    bytes[8] = (bytes[8]! & 0x3F) | 0x80;
    const hex = bytes.toString('hex');
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join('-');
}
export function randomShortUUID(): string {
    return randomLongUUID().slice(-12);
}
