import fs from 'node:fs';
import util from 'node:util';
import path from 'node:path';
import { CommonDirs, CommonFiles, validateProjectFolder } from '../../utils.js';
import { ToolWURPLSVersion } from '../../shared/projectconfig.js';
import { type ILockfile, Lockfile } from '../../pkgmgr/lockfile.js';
import { installAllLockfileDeps, installPackagesWithResolution } from '../../pkgmgr/pkg-installer.js';
export function cli_handler(args: string[]): Promise<void> {
    const { positionals: packages, values: { pre }, } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {
            pre: { type: 'boolean', default: false },
        }
    });
    const projectDir = validateProjectFolder();
    fs.mkdirSync(path.join(projectDir, CommonDirs.Packages), { recursive: true });
    const lockfilePath: string = path.join(projectDir, CommonFiles.Lockfile);
    if (!fs.existsSync(lockfilePath)) {
        fs.writeFileSync(lockfilePath, JSON.stringify({
            WURPLSLockfileVersion: ToolWURPLSVersion,
            ResolvedDependencies: {},
            DirectDependencies: {},
        } satisfies ILockfile) + '\n');
    }
    const lockfile = Lockfile.load(lockfilePath);
    if (packages.length === 0) {
        console.info('Installing project dependencies from lockfile...');
        return installAllLockfileDeps(lockfile, projectDir);
    }
    else {
        console.info(`Preparing to install ${packages.length}+ new packages...`);
        return installPackagesWithResolution(lockfile, projectDir, packages, pre);
    }
}
