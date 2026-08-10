import { abort } from '../utils.js';
import fs from 'node:fs/promises';
export enum PkgInstallSourceLocationType {
    GitHubRepo,
    RemoteLocation,
    LocalFile
}
const ghUserRegex = /^(?:[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}|[a-zA-Z\d]+(-[a-zA-Z\d]+)*(_[a-zA-Z\d]+))$/i;
const ghRepoRegex = /^[\w.-]+$/;
export function isGitHubRepoRef(pkgRef: string): boolean {
    const parts = pkgRef.split('/');
    if (parts.length !== 2)
        return false;
    const [username, reponame] = parts as [
        string,
        string
    ];
    return ghUserRegex.test(username) && ghRepoRegex.test(reponame);
}
export function normalizeGitHubRepoRef(pkgRef: string): string {
    return pkgRef.toLowerCase();
}
export function githubRepoFromReleaseURL(source: string): string | null {
    const parsed = URL.parse(source);
    if (parsed?.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port || parsed.username || parsed.password) {
        return null;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 6 || parts[2] !== 'releases' || parts[3] !== 'download' || parts.at(-1) !== 'package.zip') {
        return null;
    }
    let repoRef: string;
    try {
        repoRef = `${decodeURIComponent(parts[0]!)}/${decodeURIComponent(parts[1]!)}`;
    }
    catch {
        return null;
    }
    return isGitHubRepoRef(repoRef) ? normalizeGitHubRepoRef(repoRef) : null;
}
export function normalizeGitHubReleaseURL(source: string): string {
    const repoRef = githubRepoFromReleaseURL(source);
    if (!repoRef)
        return source;
    const match = /^(https:\/\/github\.com\/)[^/]+\/[^/]+(\/.*)$/i.exec(source);
    if (!match)
        return source;
    const [, prefix, suffix] = match;
    if (!prefix || !suffix)
        return source;
    return `${prefix}${repoRef}${suffix}`;
}
export async function locationType(name: string, pkgRef: string): Promise<PkgInstallSourceLocationType> {
    if (pkgRef.startsWith('https://')) {
        if (!URL.canParse(pkgRef))
            abort.thrown(`Invalid source URL for package ${name}`);
        return PkgInstallSourceLocationType.RemoteLocation;
    }
    else if (isLikelyFilePath(pkgRef)) {
        try {
            await fs.access(pkgRef, fs.constants.R_OK);
        }
        catch (err) {
            const code = (err as NodeJS.ErrnoException).code ?? 'Unknown';
            const msg = code === 'EACCES' ? 'Unreadable' : (code === 'ENOENT' ? 'Not Found' : code);
            abort.thrown(`Invalid local package path (${msg}): ${pkgRef}`);
        }
        return PkgInstallSourceLocationType.LocalFile;
    }
    else if (pkgRef.split('/').length === 2) {
        if (!isGitHubRepoRef(pkgRef))
            abort.thrown(`Invalid GitHub repository for package ${name}`);
        return PkgInstallSourceLocationType.GitHubRepo;
    }
    else {
        abort.thrown(`Invalid source location for package ${name}`);
    }
}
function isLikelyFilePath(str: string): boolean {
    if (/^\.\.?[/\\]/.test(str))
        return true;
    if (process.platform === 'win32') {
        if (/^[A-Z]:[/\\]/i.test(str))
            return true;
    }
    else {
        if (str[0] === '/')
            return true;
    }
    return false;
}
