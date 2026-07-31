import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { abort, CommonDirs, validateProjectFolder } from '../../utils.js';
import { compile } from './compile-pipeline.js';
import { validateCompiler, validateLinker, validateSysroot } from './toolchain-checks.js';
import type { RPL } from 'rpxlib';
export const OptLevelsNum = ['0', '1', '2', '3'] as const;
export const OptLevelsStr = ['s', 'z', 'g', 'none'] as const;
export type OptimizationLevel = 0 | 1 | 2 | 3 | typeof OptLevelsStr[number];
export async function cli_handler(args: string[]): Promise<void> {
    const availableParallelism = os.availableParallelism();
    const { positionals: targets, values: { threads: threadsRaw, compiler: compilerPathRaw, linker: linkerPathRaw, sysroot: sysrootRaw, 'exclude-cflag': excludeDefaultBuildOptsCLI, cflag, lflag, out: outPath, zlib: zlibLevelRaw, opt: optLevelRaw, 'no-cache': noCache, package: genPkg, compiledb, console: targetConsole, 'console-only': consoleOnly, } } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {
            threads: { type: 'string', short: 'T', default: availableParallelism.toString() },
            compiler: { type: 'string', short: 'c', default: process.env.TACHYON_COMPILER },
            linker: { type: 'string', short: 'l', default: process.env.TACHYON_LINKER },
            sysroot: { type: 'string', short: 's', default: process.env.TACHYON_SYSROOT },
            'exclude-cflag': { type: 'string', short: 'X', multiple: true, default: [] },
            cflag: { type: 'string', short: 'C', multiple: true },
            lflag: { type: 'string', short: 'L', multiple: true },
            zlib: { type: 'string', short: 'Z', default: '9' },
            opt: { type: 'string', short: 'O', default: '2' },
            out: { type: 'string', short: 'o' },
            'no-cache': { type: 'boolean', default: false },
            package: { type: 'boolean', short: 'P', default: false },
            compiledb: { type: 'boolean', default: false },
            console: { type: 'boolean', default: false },
            'console-only': { type: 'boolean', default: false },
        }
    });
    if (targets.length === 0 && genPkg)
        targets.push('*');
    const projectDir = validateProjectFolder();
    fs.mkdirSync(path.join(projectDir, CommonDirs.Linker), { recursive: true });
    const threads = Number(threadsRaw);
    if (!Number.isSafeInteger(threads) || threads <= 0)
        abort('Invalid number of threads.');
    if (threads > availableParallelism)
        abort(`Number of threads exceeds number of available CPU cores (${availableParallelism}).`);
    const zlibLevel = (zlibLevelRaw === 'x' ? false :
        zlibLevelRaw === 'd' ? true :
            Number(zlibLevelRaw)) as (RPL.ZlibCompressionLevel | boolean);
    if (typeof zlibLevel !== 'boolean' && (!Number.isSafeInteger(zlibLevel) || zlibLevel < 0 || zlibLevel > 9))
        abort('Invalid compression level. Must be either "x" (none), "d" (default), or number between 0 and 9.');
    const optLevel = OptLevelsNum.includes(optLevelRaw as typeof OptLevelsNum[number])
        ? Number(optLevelRaw) as 0 | 1 | 2 | 3
        : OptLevelsStr.includes(optLevelRaw as typeof OptLevelsStr[number])
            ? optLevelRaw as typeof OptLevelsStr[number]
            : null;
    if (optLevel === null)
        abort(`Invalid optimization level. Must be number 0-3 or one of: ${OptLevelsStr.join(', ')}`);
    if (optLevel === 3)
        console.warn(`Warning: Optimization level "${optLevel}" is untested and may not work properly, this is an unsupported configuration.`);
    optLevel satisfies OptimizationLevel;
    if (outPath && path.extname(outPath) !== '')
        abort('Output path must be a folder.');
    if (targetConsole && consoleOnly)
        abort('--console and --console-only are mutually exclusive.');
    await compile({
        targets: targets as [
            string,
            ...string[]
        ],
        projectDir,
        threads,
        compilerPath: validateCompiler(compilerPathRaw),
        linkerPath: validateLinker(linkerPathRaw),
        sysrootPath: validateSysroot(sysrootRaw),
        excludedCompilerFlags: excludeDefaultBuildOptsCLI,
        extraCompilerFlags: cflag ?? [],
        extraLinkerFlags: lflag ?? [],
        zlibLevel: zlibLevel,
        optLevel,
        outPath,
        noCache,
        package: genPkg,
        compiledb,
        targetConsole: consoleOnly ? true : targetConsole,
        consoleOnly,
    });
}
