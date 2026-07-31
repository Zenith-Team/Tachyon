import getEnvPaths from 'env-paths';
import { abort, isFolderAtSync } from '../../utils.js';
import path from 'node:path';
import os from 'node:os';
import { CEMU_FLATPAK_ID } from './cemu-bin-handler.js';
export function findCemuFolders(cemuBinary: string): {
    root: string;
    config: string;
} {
    const portableDir = path.join(path.dirname(cemuBinary), 'portable');
    const isPortable = isFolderAtSync(portableDir);
    console.debug('Cemu/portable check:', portableDir, '=', isPortable);
    if (isPortable)
        return { root: portableDir, config: portableDir };
    const envPaths = getEnvPaths('Cemu', { suffix: '' });
    const { data, config } = envPaths;
    const folders = { root: '', config: '' };
    switch (process.platform) {
        case 'win32':
            folders.root = path.dirname(config);
            break;
        case 'darwin':
            folders.root = data;
            break;
        case 'linux': {
            if (cemuBinary === '\0flatpak') {
                const homedir = os.homedir();
                folders.root = path.join(homedir, '.var', 'app', CEMU_FLATPAK_ID, 'data', 'Cemu');
                folders.config = path.join(homedir, '.var', 'app', CEMU_FLATPAK_ID, 'config', 'Cemu');
            }
            else {
                folders.root = data;
                folders.config = config;
            }
            break;
        }
        default:
            abort(`Unsupported platform (${process.platform}).`);
    }
    if (!folders.root)
        abort('Failed to locate Cemu folders.');
    folders.config ||= folders.root;
    return folders;
}
