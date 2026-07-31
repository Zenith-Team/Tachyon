import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import util from 'node:util';
import path from 'node:path';
import { abort, CommonDirs, CommonFiles, validateProjectFolder } from '../../utils.js';
import { Lockfile } from '../../pkgmgr/lockfile.js';
import { updatePackagesWithResolution } from '../../pkgmgr/pkg-updater.js';
export async function cli_handler(args: string[]): Promise<void> {
    const { positionals: packages, values: { pre }, } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {
            pre: { type: 'boolean', default: false },
        },
    });
    const projectDir = validateProjectFolder();
    const lockfilePath = path.join(projectDir, CommonFiles.Lockfile);
    if (!existsSync(lockfilePath)) {
        abort.thrown('No lockfile found. Run `tachyon install` first to populate it.');
    }
    await fs.mkdir(path.join(projectDir, CommonDirs.Packages), { recursive: true });
    const lockfile = Lockfile.load(lockfilePath);
    await updatePackagesWithResolution(lockfile, projectDir, packages, pre);
}
