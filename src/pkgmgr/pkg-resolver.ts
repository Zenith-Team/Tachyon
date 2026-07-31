import { abort } from '../utils.js';
import fs from 'node:fs/promises';
export enum PkgInstallSourceLocationType {
    GitHubRepo,
    RemoteLocation,
    LocalFile
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
        const [username, reponame] = pkgRef.split('/') as [
            string,
            string
        ];
        const ghUserRegex = /^(?:[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}|[a-zA-Z\d]+(-[a-zA-Z\d]+)*(_[a-zA-Z\d]+))$/i;
        const ghRepoRegex = /^[\w.-]+$/;
        if (!ghUserRegex.test(username) || !ghRepoRegex.test(reponame))
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
