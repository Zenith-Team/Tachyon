import $ from 'chalk';
import fs from 'node:fs';
import util from 'node:util';
import path from 'node:path';
import { CommonFiles, validateProjectFolder } from '../../utils.js';
import { Lockfile } from '../../pkgmgr/lockfile.js';
import { reachableNames } from '../../pkgmgr/pkg-updater.js';
import type { DirectDependency, ResolvedDependency } from '../../pkgmgr/lockfile.js';
function printTree(deps: Record<string, DirectDependency>, resolved: Record<string, ResolvedDependency>, prefix: string): void {
    const entries = Object.entries(deps);
    const total = entries.length;
    for (const [i, [name, dep]] of entries.entries()) {
        const isLast = i === total - 1;
        const connector = $.gray(isLast ? '└──' : '├──');
        const version = resolved[name]?.Current ?? '?';
        const depColored = $.reset(name);
        console.info(prefix + connector + ' ' + depColored + $.gray('@') + $.green(version));
        if (dep.Dependencies) {
            const subEntries = Object.entries(dep.Dependencies);
            if (subEntries.length > 0) {
                const childPrefix = prefix + (isLast ? '    ' : '│   ');
                printTree(dep.Dependencies, resolved, childPrefix);
            }
        }
    }
}
export function cli_handler(args: string[]): void {
    void util.parseArgs({
        args,
        allowPositionals: true,
        options: {}
    });
    const projectDir = validateProjectFolder();
    const lockfilePath = path.join(projectDir, CommonFiles.Lockfile);
    if (!fs.existsSync(lockfilePath)) {
        return console.info('Project has no dependencies.');
    }
    const lockfile = Lockfile.load(lockfilePath);
    const directDeps = lockfile.DirectDependencies;
    const resolvedDeps = lockfile.ResolvedDependencies;
    const directCount = Object.keys(directDeps).length;
    const totalCount = Object.keys(resolvedDeps).length;
    console.info('Listing dependencies in ' + $.cyan(lockfilePath) +
        $.reset(` (${directCount} direct, ${totalCount} resolved)`));
    if (directCount > 0) {
        printTree(directDeps, resolvedDeps, '');
    }
    const stillNeeded = reachableNames(directDeps);
    const orphans = Object.keys(resolvedDeps).filter(name => !stillNeeded.has(name));
    if (orphans.length > 0) {
        console.info('');
        console.info($.yellow('Orphans:'));
        const totalOrphans = orphans.length;
        for (const [i, name] of orphans.entries()) {
            const isLast = i === totalOrphans - 1;
            const connector = $.gray(isLast ? '└──' : '├──');
            console.info('  ' + connector + ' ' + $.white(name) + $.gray('@') + $.green(resolvedDeps[name]!.Current));
        }
    }
}
