import fs from 'fs';
import path from 'path';
const args = process.argv.slice(2);

try {
    // Process commands
    switch (args[0]) {
        case 'compile':
            await import('./compile');
            process.exit();
        case 'patch':
            await import('./patch');
            process.exit();
    }
} catch (err) {
    //? Uncomment line below for debugging
    //throw err;
    const lines = Bun.inspect(err).split('\n').map(l => l.trimEnd()).filter(Boolean);
    const line = lines.filter(ln => ln.match(/^\d+? \|/)).at(-1);
    const arrow = lines[lines.indexOf(line!) + 1];
    const stack = lines.slice(lines.indexOf(arrow) + 1);
    console.error(
        'Something has gone catastrophically wrong!\n' +
        `${line ? `${line}\n${arrow}\n${stack.join('\n')}`
                : `${(<Error>err).name}: ${(<Error>err).message}`
        }`
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
    patch                  Patch an RPX with a precompiled patch file. (NOT IMPLEMENTED)

[Command specific options]
compile
    -r, --rpx <path>       Path to vanilla RPX file to use as base. *
    -p, --project <path>   Path to custom code project root folder. *
    -g, --ghs <path>       Path to Green Hills Software MULTI installation folder. *
    -R, --region <string>  Region of the vanilla RPX provided. *
    -o, --out <path>       Path to save the output file to. *
    -b, --brand <string>   Cosmetic text to differ the output file from vanilla. *
    -P, --prod             By default an uncompressed ELF is output for fast development,
                           use this flag to output a proper compressed RPX. *

patch
    NOT IMPLEMENTED

* Flags or options with an asterisk at the end of the description are optional`);
    process.exit();
}

if (args.includes('-v') || args.includes('--version')) {
    try {
        const { version } = JSON.parse(fs.readFileSync(path.join(import.meta.dir, 'package.json'), 'utf8'));
        console.info(`Tachyon v${version}`);
    } catch {
        console.error('Failed to get version.');
    }
    process.exit();
}

console.error('Unknown command or options, run "tachyon --help" for information.');
process.exit();
