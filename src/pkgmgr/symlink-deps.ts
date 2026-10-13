import fs from 'node:fs';
import path from 'node:path';
import { abort, CommonDirs } from '../utils.js';
export function checkSymlinkDependencies(projectDir: string, action: 'bundle' | 'package', allowSymlinkDeps: boolean): void {
    const packagesDir = path.join(projectDir, CommonDirs.Packages);
    if (!fs.existsSync(packagesDir))
        return;
    const linkedPackages = fs.readdirSync(packagesDir, { withFileTypes: true })
        .filter(entry => entry.isSymbolicLink())
        .map(entry => entry.name)
        .sort();
    if (linkedPackages.length === 0)
        return;
    const message = `Linked dependencies are installed: ${linkedPackages.join(', ')}.\n`
        + 'Linked packages are not suitable for production mod distribution and cannot be runtime-checked for compatibility.';
    if (!allowSymlinkDeps) {
        abort(`Cannot ${action} this project. ${message}\n`
            + `Replace these packages with pinned releases of them or use "--allow-symlink-deps" to proceed anyway for a private development ${action}.`);
    }
    console.warn(`${message} Continuing ${action} because "--allow-symlink-deps" was provided. Do not publish this!`);
}
