import $ from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function cli_handler(args: string[]): void {
    if (args.includes('-v') || args.includes('--version') ||
        args.includes('-i') || args.includes('--info'))
        return version();
    if (args.length === 0 || args.includes('-h') || args.includes('--help'))
        return help();
    console.error('Unknown command or options, run "tachyon --help" for information.');
    process.exitCode = 1;
}
function version(): void {
    try {
        const { version } = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8')) as {
            version: string;
        };
        console.info(`Tachyon v${version} by Zenith Team`);
        console.info('TACHYON_HOME: ' + $.cyan(process.env.TACHYON_HOME!));
    }
    catch {
        console.error('Failed to get version.');
        process.exitCode = 1;
    }
}
function help(): void {
    const b = $.blueBright;
    const c = $.cyanBright;
    const g = $.yellow;
    const y = $.yellowBright;
    const d = $.gray;
    const H = $.underline.bold;
    const C = $.gray(',');
    console.log(`${H('Usage')}${$.bold(': tachyon [flags] <command> [command specific options]')}

${H('Valid flags')}
    ${b('-h')}${C} ${b('--help')}              Show this message.
    ${b('-v')}${C} ${b('--version')}           Show installed Tachyon version number.

${H('Valid commands')}
    ${c('setup')}                   Initialize or manage your Tachyon configuration setup.
    ${c('compile')}                 Compile a custom code project into an RPL.
    ${c('package')}                 Compile every target and generate a library package.
    ${c('clean')}                   Clear the build cache of the generated files.
    ${c('launch')}                  Launch this project's modded environment with Cemu.
    ${c('bundle')}                  Bundle a project and its dependencies into a playable mod.
    ${c('pm')}                      Manage packages and dependencies. See subcommands for more information.
        ${c('pm install')}          Install this project's dependencies or add new packages.
        ${c('pm link')}             Install a local package by symlinking it into the project.
        ${c('pm list')}             List all installed packages.
        ${c('pm uninstall')}        Uninstall a package.
        ${c('pm update')}           Update one or all packages to their latest versions.

${H('Command specific options')}
${c('compile')} ${y('<targets...>')}
    ${b('-T')}${C} ${b('--threads')} ${g('<number>')}       Number of parallel threads to use for compilation. ${d('(default: 2)')}
    ${b('-c')}${C} ${b('--compiler')} ${g('<path>')}        Path to Red Hills clang++ binary to use. ${d('(default: TACHYON_COMPILER env. variable)')}
    ${b('-l')}${C} ${b('--linker')} ${g('<path>')}          Path to PowerPC linker binary to use. ${d('(default: TACHYON_LINKER env. variable)')}
    ${b('-s')}${C} ${b('--sysroot')} ${g('<path>')}         Path to the sysroot folder to use. ${d('(default: TACHYON_SYSROOT env. variable)')}
    ${b('-X')}${C} ${b('--exclude-cflag')} ${g('<string>')} Default compiler flag(s) to disable. Multiple use. ${d('(Unique value "all" disables all default flags)')}
    ${b('-C')}${C} ${b('--cflag')} ${g('<string>')}         Additional flag(s) to pass directly to the compiler. Multiple use.
    ${b('-L')}${C} ${b('--lflag')} ${g('<string>')}         Additional flag(s) to pass directly to the linker. Multiple use.
    ${b('-O')}${C} ${b('--opt')} ${g('<path>')}             Optimization level to pass to the compiler. ${d('(default: "2")')}
    ${b('-o')}${C} ${b('--out')} ${g('<path>')}             Path to save the output file to. ${d('(default: "<project>/out/<name>_<target>.rpl")')}
    ${b('-Z')}${C} ${b('--zlib')} ${g('<number|"x"|"d">')}  Compression level for the output RPL file, 0-9. ${d('(default: 9)')}
    (x = no compression, d = default compression)
    ${b('--no-cache')}                   Clear the compilation cache before compiling.
    ${b('--package')}                    Generate a distributable Tachyon dependency package file after compiling.
    ${b('--compiledb')}                  Generate a compilation database (compile_commands.json) for the project.
    ${b('--console')}                    Build both the emulator and console variants of this target.
    ${b('--console-only')}               Build only the console variant of this target.

${c('launch')} ${y('<target_name>')}
    ${b('-c')}${C} ${b('--cemu')} ${g('<path>')}            Path to Cemu installation folder. ${d('(default: CEMU_BIN env. variable)')}
    ${b('-A')}${C} ${b('--allow')} ${g('<string>')}         Types of logs allowed to print. Multiple use. ${d('(default: "all")')}
    ${b('-B')}${C} ${b('--block')} ${g('<string>')}         Types of logs blocked from printing. Multiple use.
    ${b('-f')}${C} ${b('--fullscreen')}             Launch in fullscreen.
    ${b('-i')}${C} ${b('--interpreter')}            Launch with interpreter mode. ${d('(default mode: multi-core recompiler)')}
    ${b('-I')}${C} ${b('--multicore-interpreter')}  Launch with multi-core interpreter mode. ${d('(default mode: multi-core recompiler)')}
    ${b('-m')}${C} ${b('--manual')}                 Only launch Cemu and configure graphic pack, but don't auto-run the game/app.
`.trimEnd());
}
