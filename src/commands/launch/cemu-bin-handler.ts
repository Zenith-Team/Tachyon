import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { abort, isFileAtSync, isFolderAtSync } from '../../utils.js';
const homedir = os.homedir();
const CEMU_BIN_DEFAULT_SEARCH_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
    win32: [
        path.join(homedir, 'AppData/Local/Cemu/Cemu.exe'),
    ],
    darwin: [
        '/Applications/Cemu.app/Contents/MacOS/Cemu',
        path.join(homedir, 'Applications/Cemu.app/Contents/MacOS/Cemu'),
    ],
    linux: [],
};
export const CEMU_FLATPAK_ID = 'info.cemu.Cemu';
function validateCemuBinary(cemuBin: string, alreadyCheckedFlatpak = false) {
    if (cemuBin === '\0flatpak') {
        if (alreadyCheckedFlatpak || hasFlatpakCemu())
            return;
        else
            abort('You do not have Cemu installed on Flatpak.');
    }
    if (!fs.existsSync(cemuBin))
        abort(`Stored Cemu binary path does not exist! (Looking for: ${cemuBin})`);
    try {
        const cemuProc = spawnSync(cemuBin, ['-h'], { stdio: 'pipe' });
        const cemuOut = cemuProc.stdout.toString();
        if (cemuOut.includes('Displays the version of Cemu'))
            return;
    }
    catch (error) {
        if (process.env.TACHYON_DEBUG)
            throw error;
        abort(`Invalid used Cemu binary path, could not execute. (Using: ${cemuBin})`);
    }
    const extraPlatformHint = process.platform === 'win32'
        ? ("\nOn Windows, this may be caused by an outdated Cemu 2.6 (or older) installation.\nIf that is the case, you should update to a Cemu 2.7 nightly from https://cemu.info/ActionBuilds.php") : '';
    abort(`Invalid used Cemu binary path, not recognized as a Cemu executable. (Using: ${cemuBin})\n${extraPlatformHint}`);
}
function hasFlatpakCemu(): boolean {
    if (process.platform !== 'linux')
        return false;
    try {
        const flatpak = spawnSync('flatpak', ['list'], { stdio: 'pipe' });
        if (flatpak.stdout.toString('utf8').includes("info.cemu.Cemu"))
            return true;
        console.debug('linux user has flatpak but cemu not installed');
        return false;
    }
    catch {
        console.debug('linux user does not have flatpak');
        return false;
    }
}
function searchDefaultCemuLocations() {
    const searchPaths = CEMU_BIN_DEFAULT_SEARCH_PATHS[process.platform];
    if (!searchPaths) {
        console.debug(`No known Cemu search locations for this platform: ${process.platform}`);
        return null;
    }
    if (hasFlatpakCemu())
        return '\0flatpak';
    for (const searchPath of searchPaths) {
        if (!isFileAtSync(searchPath)) {
            console.debug(`CemuSearch > not found/invalid: ${searchPath}`);
            continue;
        }
        return searchPath;
    }
    return null;
}
export function findCemuBinary(userSetPath?: string): string {
    if (!userSetPath) {
        const foundDefault = searchDefaultCemuLocations();
        if (foundDefault) {
            validateCemuBinary(foundDefault, true);
            return foundDefault;
        }
        abort("No Cemu path provided, and no default Cemu installation could be found.\nThe CEMU_BIN variable is not set, and no path was provided with the --cemu option.");
    }
    const cemuBinPath = path.resolve(userSetPath);
    if (!fs.existsSync(cemuBinPath))
        abort('Cemu path not found: ' + cemuBinPath);
    let cemuBinary = cemuBinPath;
    if (process.platform === 'darwin') {
        if (isFolderAtSync(cemuBinPath)) {
            cemuBinary = path.join(cemuBinPath, 'Contents', 'MacOS', 'Cemu');
        }
        else {
            cemuBinary = cemuBinPath;
        }
    }
    validateCemuBinary(cemuBinary);
    return cemuBinary;
}
