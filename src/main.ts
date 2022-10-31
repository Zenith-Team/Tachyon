#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const args = process.argv.slice(2);

try {
    // Process commands
    switch (args[0]) {
        case 'compile':
            await import('./compile.js');
            process.exit();
        case 'patch':
            await import('./patch.js');
            process.exit();
    }
} catch (err) {
    if (process.env.TACHYON_DEBUG) throw err;
    console.error(
        'Something has gone catastrophically wrong!\n' +
        `${(<Error>err).name}: ${(<Error>err).message}`
    );
    process.exit(1);
}

if (args.includes('-h') || args.includes('--help')) {
    console.info(
`Usage: tachyon [flags] <command> [command specific options]

Valid flags:
    -h, --help             Show this message.
    -v, --version          Show installed Tachyon version number.

Valid commands:
    compile                Compile a custom code project into an RPX/ELF.
    patch                  Patch an RPX with a precompiled patch file.

[Command specific options]
compile
    -R, --region <string>  Region of the vanilla RPX provided.
    -r, --rpx <path>       Path to vanilla RPX file to use as base.
    -p, --project <path>   Path to custom code project root folder. (default: "./") *
    -g, --ghs <path>       Path to Green Hills Software MULTI installation folder. (default: "C:/ghs/multi5327") *
    -o, --out <path>       Path to save the output file to. (default: next to vanilla rpx) *
    -b, --brand <string>   Cosmetic text to differ the output file from vanilla. (default: "custom") *
    -P, --prod             Output compressed RPX instead of uncompressed ELF, and generate a Tachyon patch file next to the RPX. *
                           

patch
    -p, --patch            Path to Tachyon patch file to apply.
    -r, --rpx              Path to input RPX file to patch.
    -o, --out              Path to save the output RPX to. *

* Flags or options with an asterisk at the end of the description are optional`);
    process.exit();
}

if (args.includes('-v') || args.includes('--version')) {
    try {
        const { version } = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
        console.info(`Tachyon v${version}`);
    } catch {
        console.error('Failed to get version.');
    }
    process.exit();
}

console.error('Unknown command or options, run "tachyon --help" for information.');
process.exit();
