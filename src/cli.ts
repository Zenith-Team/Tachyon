#!/usr/bin/env node
import './sideload.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const args = process.argv.slice(2);

const [nodeMajor, nodeMinor] = process.versions.node.split('.');
if (Number(nodeMajor) < 18 || (Number(nodeMajor) === 18 && Number(nodeMinor) < 11)) {
    console.error(`Outdated Node.js version (${process.versions.node}) detected. Please update to Node.js 18.11 or higher.`);
    process.exit(0);
}

let ranCommand = false;
try {
    // Process commands
    switch (args[0]) {
        case 'compile':
            await import('./compile.js');
            ranCommand = true;
            break;
        case 'patch':
            await import('./patch.js');
            ranCommand = true;
            break;
        case 'launch': {
            await (await import('./launch.js')).launch();
            ranCommand = true;
            break;
        }
    }
} catch (err) {
    const code = Reflect.get(err as object, 'code') as string | number | undefined;
    if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_')) {
        if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
            console.error('Invalid arguments: ' + (<Error>err).message.split(' To specify a ')[0]!);
        } else {
            console.error(`Invalid arguments: ${(<Error>err).message}`);
        }
        process.exit(1);
    }
    if (process.env.TACHYON_DEBUG) throw err;
    console.error(
        'Something has gone catastrophically wrong!\n' +
        `${(<Error>err).name}: ${(<Error>err).message}`
    );
    process.exit(1);
}

if (!ranCommand) {
    if (args.includes('-h') || args.includes('--help')) {
        const { default: $ } = await import('chalk');
        const b = $.blueBright;
        const c = $.cyanBright;
        const G = $.yellow;
        const y = $.yellowBright;
        const d = $.gray;
        const h = $.underline.bold;
        const C = $.gray(',');
        console.log(`${h('Usage')}${$.bold(': tachyon [flags] <command> [command specific options]')}

${h('Valid flags')}
    ${b('-h')}${C} ${b('--help')}              Show this message.
    ${b('-v')}${C} ${b('--version')}           Show installed Tachyon version number.

${h('Valid commands')}
    ${c('compile')}                 Compile a custom code project into an RPX/ELF.
    ${c('patch')}                   Patch an RPX with a precompiled patch file.

${h('Command specific options')}
${c('compile')} ${y('<target>')}
    ${b('-p')}${C} ${b('--project')} ${G('<path>')}    Path to custom code project root folder. ${d('(default: "./")')}
    ${b('-T')}${C} ${b('--threads')} ${G('<number>')}  Number of parallel threads to use for compilation. ${d('(default: 2)')}
    ${b('-g')}${C} ${b('--ghs')} ${G('<path>')}        Path to Green Hills Software MULTI installation folder. ${d('(default: "C:/ghs/multi5327")')}
    ${b('-o')}${C} ${b('--out')} ${G('<path>')}        Path to save the output file to. ${d('(default: next to base rpx)')}
    ${b('-m')}${C} ${b('--meta')} ${G('<string>')}     Name of the project metadata folder. ${d('(default: "project")')}
    ${b('-r')}${C} ${b('--rpx')}               Output compressed RPX instead of uncompressed ELF.
    ${b('-t')}${C} ${b('--typf')}              Output a Tachyon patch file next to the ELF/RPX.
    ${b('--no-cache')}              Clear the compilation cache before compiling.

${c('patch')} ${y('<base_rpx_path> <patch_file_path>')}
    ${b('-o')}${C} ${b('--out')} ${G('<path>')}        Path to save the output RPX to. ${d('(default: next to base RPX)')}
`);
        if (!process.env.TACHYON_LIB_MODE) process.exit();
    }

    if (args.includes('-v') || args.includes('--version')) {
        try {
            const { version } = JSON.parse(
                fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
            ) as { version: string; };
            if (!process.env.TACHYON_LIB_MODE) console.info(`Tachyon v${version}`);
            else process.env.TACHYON_LIB_RETURN = version;
        } catch (err) {
            if (process.env.TACHYON_LIB_MODE) throw err;
            else console.error('Failed to get version.');
        }
        if (!process.env.TACHYON_LIB_MODE) process.exit();
    }

    if (!process.env.TACHYON_LIB_MODE) {
        console.error('Unknown command or options, run "tachyon --help" for information.');
        process.exit();
    }
}
