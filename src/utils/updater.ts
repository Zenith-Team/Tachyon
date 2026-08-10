import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { CommonFiles } from '../utils.js';
import type { GitHubRelease } from '../pkgmgr/github-release.js';
export async function checkForUpdate(): Promise<boolean> {
    try {
        if (process.env.TACHYON_NO_UPDATE_CHECK)
            return false;
        const now = Date.now();
        let prev = 0;
        const updateCheckPath = path.join(os.tmpdir(), CommonFiles.TachyonUpdateCheck);
        if (fs.existsSync(updateCheckPath)) {
            prev = Number(fs.readFileSync(updateCheckPath, 'utf8'));
            if (Number.isNaN(prev)) {
                fs.rmSync(updateCheckPath, { force: true });
                return false;
            }
        }
        const UPDATE_CHECK_INTERVAL = Number(process.env.TACHYON_UPDATE_CHECK_INTERVAL) || (7200000);
        const shouldCheckUpdate = (now - prev) > UPDATE_CHECK_INTERVAL;
        if (shouldCheckUpdate) {
            fs.writeFileSync(updateCheckPath, now.toString());
            const latest = await getLatestMetadata();
            const latestVersion = parseReleaseVersion(latest.tag_name);
            const localVersion = getLocalVersion();
            return semver.gt(latestVersion, localVersion);
        }
        return false;
    }
    catch (error) {
        if (process.env.TACHYON_DEBUG)
            throw error;
        else
            return false;
    }
}
function parseReleaseVersion(tag: string): string {
    const version = semver.valid(tag.startsWith('v') ? tag.slice(1) : tag);
    if (!version)
        throw new Error(`Updater received invalid release tag: ${JSON.stringify(tag)}`);
    return version;
}
function getLocalVersion(): string {
    const { version } = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8')) as {
        version: string;
    };
    const validVersion = semver.valid(version);
    if (!validVersion)
        throw new Error(`Invalid local Tachyon version: ${JSON.stringify(version)}`);
    return validVersion;
}
async function getLatestMetadata() {
    const req = await fetch('https://api.github.com/repos/Zenith-Team/Tachyon/releases/latest', {
        headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!req.ok || !req.body)
        throw new Error(`Updater metadata request failed: ${req.status} ${req.statusText}`);
    const json = await req.json() as GitHubRelease;
    return json;
}
