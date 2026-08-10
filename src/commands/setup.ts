import $ from 'chalk';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { abort, CommonFiles, confirm, downloadFile } from '../utils.js';
import { extract as extractZip } from 'zip-lib';
import which from 'which';
import semver from 'semver';
import { validateLinker } from './compile/toolchain-checks.js';
const PLATFORM_DOUBLE = `${process.platform}-${process.arch}` as const;
const SUPPORTED_DOUBLES: PlatformDouble[] = [
    'darwin-arm64',
    'darwin-x64',
    'win32-x64',
    'linux-x64',
];
const COMPILER_DOWNLOAD_URL = `https://github.com/Zenith-Team/RedHills/releases/latest/download/redhills-${PLATFORM_DOUBLE}.zip`;
type PlatformDouble = typeof PLATFORM_DOUBLE;
interface ToolchainLockfile {
    compiler: string;
    sysroot: string;
}
export async function cli_handler(args: string[]): Promise<void> {
    const { values: { reset, update, } } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {
            reset: { type: 'boolean', default: false },
            update: { type: 'boolean', default: false, short: 'u' },
        }
    });
    if (reset && update)
        abort('--reset and --update flags are mutually exclusive.');
    const setupState = checkCurrentSetup();
    if (!setupState.BLANK_SETUP) {
        if (!reset && !update) {
            console.warn('It looks like you already have a partial Tachyon setup on your system.');
            console.info(`To re-run the initial setup, please use the ${$.whiteBright('--reset')} flag.`);
            console.info(`To check for and install toolchain updates, please use the ${$.whiteBright('--update')} flag.`);
            return;
        }
        if (reset)
            return await resetConfiguration();
    }
    else {
        if (reset)
            console.warn($.dim('--reset flag ignored because you do not have an existing Tachyon setup.'));
        if (update)
            console.warn($.dim('--update flag ignored because you do not have an existing Tachyon setup.'));
    }
    if (!SUPPORTED_DOUBLES.includes(PLATFORM_DOUBLE))
        abort(`Your platform (${PLATFORM_DOUBLE}) is not currently supported by the RedHills compiler.\n` +
            `If you think this is a mistake, please open an issue at ${$.cyan('https://github.com/Zenith-Team/RedHills/issues')}`);
    const UPDATING = !setupState.BLANK_SETUP && update;
    const HOME = path.resolve(process.env.TACHYON_HOME!);
    const TOOLCHAIN_DIR = path.join(HOME, 'toolchain');
    fs.mkdirSync(TOOLCHAIN_DIR, { recursive: true });
    let toolchainLockfile: ToolchainLockfile = { compiler: '0.0.0', sysroot: '0' };
    if (UPDATING) {
        console.success('Checking for toolchain updates...');
        try {
            toolchainLockfile = JSON.parse(fs.readFileSync(path.join(HOME, CommonFiles.TachyonToolchainLock), 'utf8')) as ToolchainLockfile;
        }
        catch {
            abort('Failed to load toolchain lockfile. Please use --reset to repair your setup.');
        }
    }
    else
        console.success('Beginning first time setup...');
    const newConfig = {
        COMPILER: '',
        LINKER: '',
        SYSROOT: '',
    };
    if (!UPDATING) {
        console.info('Checking for linker...');
        const foundLinker = checkSystemLinkers();
        newConfig.LINKER = foundLinker;
    }
    const res = await fetch(COMPILER_DOWNLOAD_URL, { method: 'HEAD', redirect: 'manual', headers: { Cookie: process.env.__TDEV_GH_COOKIE__ ?? '' } });
    const compilerReleaseTag = res.headers.get('location')?.match(/\/releases\/download\/([^/]+)\//)?.[1];
    if (!compilerReleaseTag)
        abort('Failed to fetch latest version for compiler. Try again later or report this as a bug if it keeps happening.');
    let shouldInstallCompiler = true;
    if (UPDATING) {
        const currentVer = toolchainLockfile.compiler;
        const isNewerVer = semver.gt(compilerReleaseTag, currentVer);
        if (!isNewerVer) {
            shouldInstallCompiler = false;
            console.success($.dim('✓ No compiler update available.'));
        }
        else {
            console.success(`Compiler update available! ${$.red(currentVer)} -> ${$.green.bold(compilerReleaseTag)}`);
        }
    }
    if (shouldInstallCompiler) {
        console.info(UPDATING ? 'Updating compiler...' : 'Installing compiler...');
        const compilerBin = await downloadCompiler(TOOLCHAIN_DIR);
        if (fs.existsSync(compilerBin))
            console.success(UPDATING ? '✓ Compiler updated.' : '✓ Compiler installed.');
        else
            abort('Something has gone wrong while installing the compiler.');
        newConfig.COMPILER = path.resolve(compilerBin);
        toolchainLockfile.compiler = compilerReleaseTag;
    }
    if (!UPDATING)
        console.info('Installing sysroot...');
    const [sysrootDir, sysrootETag] = await downloadSysroot(TOOLCHAIN_DIR, UPDATING ? toolchainLockfile.sysroot : undefined);
    if (sysrootETag) {
        if (UPDATING)
            console.success('Sysroot update available!');
        if (fs.existsSync(sysrootDir))
            console.success(UPDATING ? '✓ Sysroot updated.' : '✓ Sysroot installed.');
        else
            abort('Something has gone wrong while installing the sysroot.');
        newConfig.SYSROOT = path.resolve(sysrootDir);
        toolchainLockfile.sysroot = sysrootETag;
    }
    else {
        console.success($.dim('✓ No sysroot update available.'));
    }
    console.debug('[setup-result]', newConfig, toolchainLockfile);
    fs.writeFileSync(path.join(HOME, CommonFiles.TachyonToolchainLock), JSON.stringify(toolchainLockfile));
    if (!UPDATING) {
        const NEW_CONFIG_TEXT = Object.entries(newConfig).map(([k, v]) => `${k}=${v}`).join('\n');
        fs.writeFileSync(path.join(HOME, CommonFiles.TachyonConfig), NEW_CONFIG_TEXT);
        console.success(`${$.greenBright.bold('[✓ SUCCESS]')} Initial setup complete! Your new configuration file has been saved to: ${$.cyan(path.join(HOME, CommonFiles.TachyonConfig))}`);
    }
    else
        console.success(`${$.greenBright.bold('[✓ SUCCESS]')} Toolchain update check complete.`);
}
function checkCurrentSetup() {
    const state = {
        hasCompiler: false,
        hasLinker: false,
        hasSysroot: false,
        hasConfigFile: false,
        BLANK_SETUP: true,
    };
    if (process.env.TACHYON_COMPILER)
        state.hasCompiler = true;
    if (process.env.TACHYON_LINKER)
        state.hasLinker = true;
    if (process.env.TACHYON_SYSROOT)
        state.hasSysroot = true;
    if (Number(process.env.TACHYON_CONFIG_KEYS_LOADED) > 0)
        state.hasConfigFile = true;
    for (const _k of Object.keys(state)) {
        const key = _k as keyof typeof state;
        if (key === 'BLANK_SETUP')
            continue;
        const bool = state[key];
        if (bool) {
            state.BLANK_SETUP = false;
            break;
        }
    }
    return state;
}
async function downloadCompiler(destFolder: string) {
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tachyondl-rhs'));
    const compilerTmpZip = path.join(TMP, 'redhills.zip');
    await downloadFile(COMPILER_DOWNLOAD_URL, compilerTmpZip, { headers: { Cookie: process.env.__TDEV_GH_COOKIE__ ?? '' } });
    await extractZip(compilerTmpZip, destFolder, { overwrite: false, forceFileMode: 0o744, safeSymlinksOnly: true });
    fs.rmSync(TMP, { recursive: true, force: true });
    const compilerBinName = 'clang-19' + (process.platform === 'win32' ? '.exe' : '');
    return path.join(destFolder, compilerBinName);
}
async function downloadSysroot(destFolder: string, prevETag?: string) {
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tachyondl-sys'));
    const sysrootTmpZip = path.join(TMP, 'sysroot.zip');
    const etag = await downloadFile("https://github.com/Zenith-Team/RedStandard/archive/refs/heads/main.zip", sysrootTmpZip, { headers: {
            ...(prevETag ? { 'If-None-Match': prevETag } : undefined),
            Cookie: process.env.__TDEV_GH_COOKIE__ ?? '',
        } }, true);
    if (etag)
        await extractZip(sysrootTmpZip, destFolder, { overwrite: false, forceFileMode: 0o644, safeSymlinksOnly: true });
    fs.rmSync(TMP, { recursive: true, force: true });
    return [path.join(destFolder, 'RedStandard-main'), etag] as const;
}
function checkSystemLinkers() {
    const LINKERS = ['ld.lld', 'lld'];
    let foundLinker: string | undefined;
    if (process.platform === 'win32' && fs.existsSync("C:\\Program Files\\LLVM\\bin\\ld.lld.exe")) {
        validateLinker("C:\\Program Files\\LLVM\\bin\\ld.lld.exe");
        foundLinker = "C:\\Program Files\\LLVM\\bin\\ld.lld.exe";
    }
    for (const linker of LINKERS) {
        if (foundLinker)
            break;
        const found = which.sync(linker, { nothrow: true });
        if (found) {
            validateLinker(found);
            foundLinker = found;
            break;
        }
    }
    if (foundLinker) {
        console.success('✓ Valid linker found on system.');
        return foundLinker;
    }
    let linkerInstallCommand = $.red('[unknown system package manager, please install your system\'s "lld" package]');
    switch (process.platform) {
        case 'win32':
            linkerInstallCommand = 'winget install -e --id LLVM.LLVM';
            break;
        case 'darwin':
            linkerInstallCommand = 'brew install lld';
            break;
        case 'linux': {
            const CMDS = {
                apt: 'apt install lld',
                dnf: 'dnf install lld',
                pacman: 'pacman -S lld',
            };
            for (const pkgmgr of Object.keys(CMDS)) {
                const found = which.sync(pkgmgr, { nothrow: true });
                if (found) {
                    linkerInstallCommand = CMDS[pkgmgr as keyof typeof CMDS];
                    break;
                }
            }
            break;
        }
    }
    console.info('No existing valid linker found, please run the following command to install it:');
    console.info(`${$.gray('$ >')} ${$.whiteBright(linkerInstallCommand)}\n`);
    if (process.platform === 'win32') {
        console.info(`Once you've run the above command, verify LLD is installed at "${"C:\\Program Files\\LLVM\\bin\\ld.lld.exe"}" and re-run the setup command.`);
    }
    else {
        console.info('Once you\'ve run the above command, verify LLD is in your PATH and re-run the setup command.');
        console.info('You may need to relaunch your terminal for Tachyon to detect the newly installed linker.');
    }
    process.exit();
}
async function resetConfiguration() {
    console.log(`${$.bgRedBright.whiteBright.bold('[IMPORTANT]')} ${$.red.bold('Using the --reset flag will DELETE all of your current configuration data!')}\n` +
        $.red.bold(`This is includes ${$.underline('ALL')} files in your TACHYON_HOME folder: ${$.cyan(path.resolve(process.env.TACHYON_HOME!))}\n`));
    const confirmed = await confirm($.red.italic.bold('Please confirm if you still want to proceed (y/n): '));
    if (!confirmed) {
        console.info('Configuration reset cancelled.');
        return;
    }
    fs.rmSync(path.resolve(CommonFiles.TachyonConfig), { force: true });
    fs.rmSync(path.resolve(process.env.TACHYON_HOME!), { recursive: true, force: true });
    console.warn("Please note that if you have set system-level environment variables for Tachyon settings, Tachyon cannot reset those for you.\nYou must manually unset/reset those environment variables to proceed if the setup command still blocks you even after this reset.");
    console.success('Configuration reset complete.');
}
