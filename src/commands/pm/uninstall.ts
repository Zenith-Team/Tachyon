import $ from 'chalk';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import util from 'node:util';
import path from 'node:path';
import { abort, CommonDirs, CommonFiles, fs_rmrf_unlink, validateProjectFolder } from '../../utils.js';
import { Lockfile } from '../../pkgmgr/lockfile.js';
import { reachableNames } from '../../pkgmgr/pkg-updater.js';
export async function cli_handler(args: string[]): Promise<void> {
    const { positionals: packages, } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {}
    });
    const projectDir = validateProjectFolder();
    if (packages.length === 0)
        abort('Must specify package(s) to uninstall.');
    const lockfilePath = path.join(projectDir, CommonFiles.Lockfile);
    if (!existsSync(lockfilePath))
        abort('This project has no dependencies, nothing to uninstall.');
    const lockfile = Lockfile.load(lockfilePath);
    const directDepsNames = Object.keys(lockfile.DirectDependencies);
    if (directDepsNames.length === 0)
        abort('This project has no dependencies, nothing to uninstall.');
    await fs.mkdir(path.join(projectDir, CommonDirs.Packages), { recursive: true });
    for (const packageName of packages) {
        if (!directDepsNames.includes(packageName)) {
            const isSubDep = Object.keys(lockfile.ResolvedDependencies).includes(packageName);
            abort(isSubDep
                ? `Package "${$.yellow(packageName)}" is not a direct dependency of this project and cannot be uninstalled directly.`
                : `Package "${$.yellow(packageName)}" is not installed in this project.`);
        }
        Reflect.deleteProperty(lockfile.DirectDependencies, packageName);
    }
    const stillNeeded = reachableNames(lockfile.DirectDependencies);
    const orphans = Object.keys(lockfile.ResolvedDependencies).filter(n => !stillNeeded.has(n));
    if (orphans.length > 0) {
        for (const orphan of orphans) {
            const packageDir = path.join(projectDir, CommonDirs.Packages, orphan);
            await fs_rmrf_unlink(packageDir);
            Reflect.deleteProperty(lockfile.ResolvedDependencies, orphan);
            console.success(`✓ Uninstalled package ${$.yellow(orphan)}`);
        }
        const s = orphans.length === 1 ? '' : 's';
        console.info(`Uninstalled ${$.green(orphans.length)} package${s}`);
    }
    else {
        console.info(`Uninstalled ${$.red('0')} packages\n` +
            'The requested package(s) have been removed from your direct dependencies, but are still required by other installed packages.');
    }
    lockfile.save();
}
