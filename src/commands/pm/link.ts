import $ from 'chalk';
import JSON5 from 'json5';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import util from 'node:util';
import path from 'node:path';
import { abort, CommonDirs, CommonFiles, isFolderAt, validateProjectFolder } from '../../utils.js';
import { type ILockfile, Lockfile } from '../../pkgmgr/lockfile.js';
import { type ProjectConfigFile, ToolWURPLSVersion } from '../../shared/projectconfig.js';
import { installPackagesWithResolution } from '../../pkgmgr/pkg-installer.js';
export async function cli_handler(args: string[]): Promise<void> {
    const { positionals: [pkgDir], } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {}
    });
    const projectDir = validateProjectFolder();
    if (!pkgDir)
        abort.thrown('Missing argument: Please provide the path to the folder of a package to link.');
    if (!await isFolderAt(pkgDir))
        abort.thrown('The given path is not a folder or does not exist.');
    void validateProjectFolder(pkgDir);
    await fs.mkdir(path.join(projectDir, CommonDirs.Packages), { recursive: true });
    const lockfilePath = path.join(projectDir, CommonFiles.Lockfile);
    if (!existsSync(lockfilePath)) {
        await fs.writeFile(lockfilePath, JSON.stringify({
            WURPLSLockfileVersion: ToolWURPLSVersion,
            ResolvedDependencies: {},
            DirectDependencies: {},
        } satisfies ILockfile) + '\n');
    }
    const lockfile = Lockfile.load(lockfilePath);
    const tpkgConfig = JSON5.parse<ProjectConfigFile>(await fs.readFile(path.join(pkgDir, CommonFiles.Config), 'utf8'));
    if (typeof tpkgConfig.Name !== 'string')
        abort('Invalid non-string Name field at referenced project config.');
    const tpkgName = tpkgConfig.Name;
    console.debug('symlinking pkg', projectDir, pkgDir);
    await installPackagesWithResolution(lockfile, projectDir, [pkgDir]);
    console.success(`Successfully linked package ${$.yellow(tpkgName)} to folder: ${$.cyan(path.resolve(pkgDir))}`);
}
