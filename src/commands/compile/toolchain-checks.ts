import path from 'node:path';
import which from 'which';
import { abort, isFileAtSync, isFolderAtSync } from '../../utils.js';
import { spawnSync } from 'node:child_process';
export function validateCompiler(compilerPathRaw: string | undefined) {
    if (!compilerPathRaw)
        abort('No compiler specified! Please run "tachyon setup" or use the --compiler option.');
    const compilerIsPath = path.isAbsolute(compilerPathRaw) || compilerPathRaw.startsWith('.');
    const compilerPath = compilerIsPath ? path.resolve(compilerPathRaw) : which.sync(compilerPathRaw, { nothrow: true });
    if (!compilerPath)
        abort(`Compiler command could not be found in your PATH: "${compilerPathRaw}"`);
    if (compilerIsPath && !isFileAtSync(compilerPath))
        abort(`Compiler path does not point to a file: "${compilerPath}"`);
    const compilerCheck = spawnSync(compilerPath, ['--version'], { encoding: 'utf8' });
    if (compilerCheck.error || compilerCheck.signal || compilerCheck.status === null) {
        if (compilerIsPath)
            abort(`Could not spawn compiler binary at "${compilerPath}".`);
        else
            abort(`Could not find compiler "${compilerPath}" in PATH.`);
    }
    let supported = true;
    const output = (compilerCheck.stdout || compilerCheck.stderr || '').trim().toLowerCase();
    if (!output.includes('clang')) {
        console.warn(`Compiler "${compilerPath}" does not appear to be a clang binary (it may not even be a compiler).`);
        supported = false;
    }
    if (!output.includes('powerpc') && !output.includes('ppc')) {
        console.warn(`Compiler "${compilerPath}" does not appear to support PowerPC targets (it may not even be a compiler).`);
        supported = false;
    }
    if (!output.includes('redhills')) {
        console.warn(`Compiler "${compilerPath}" does not appear to be Red Hills clang.`);
        supported = false;
    }
    if (!supported) {
        console.error('Compatibility issues were detected with the compiler provided, therefore it is an unsupported configuration.');
        console.error('Compilation will almost certainly fail or produce broken output.');
        if (!process.env.TACHYON_NO_TOOLCHAIN_CHECK) {
            abort('If you REALLY know what you are doing, at your own risk, you can set the TACHYON_NO_TOOLCHAIN_CHECK=1 environment variable to bypass this. Aborting.');
        }
        console.warn('TACHYON_NO_TOOLCHAIN_CHECK is set, so proceeding anyway... (THIS IS A VERY BAD IDEA!)');
        console.warn("Note that you are on your own if compilation fails or produces broken output, and you alone are responsible for any issues that arise, including but not limited to bricked consoles, data loss, or damage to the host computer. Proceeding at your own risk.");
    }
    console.debug('Resolved COMPILER path:', compilerPath);
    return compilerPath;
}
export function validateLinker(linkerPathRaw: string | undefined) {
    if (!linkerPathRaw)
        abort('No linker specified! Please run "tachyon setup" or use the --linker option.');
    const linkerIsPath = path.isAbsolute(linkerPathRaw) || linkerPathRaw.startsWith('.');
    const linkerPath = linkerIsPath ? path.resolve(linkerPathRaw) : which.sync(linkerPathRaw, { nothrow: true });
    if (!linkerPath)
        abort(`Linker command could not be found in your PATH: "${linkerPathRaw}"`);
    if (linkerIsPath && !isFileAtSync(linkerPath))
        abort(`Linker path does not point to a file: "${linkerPath}"`);
    const linkerCheck = spawnSync(linkerPath, ['--version'], { encoding: 'utf8' });
    if (linkerCheck.error || linkerCheck.signal || linkerCheck.status === null) {
        abort(`Could not find linker "${linkerPath}" in PATH.`);
    }
    const output = (linkerCheck.stdout || linkerCheck.stderr || '').trim().toLowerCase();
    let isValidLinker = false;
    if (output.includes('lld')) {
        if (output.includes('compatible with gnu')) {
            const lld_version = /lld (\d+)\.(\d+)\.(\d+)/.exec(output);
            if (!lld_version) {
                console.warn('Could not verify your LLD version from this output:\n"' + output + '"');
                console.warn('This likely signals a wrong LLD variant or extremely old or unseen version.');
            }
            else {
                isValidLinker = true;
                const [lld_major, lld_minor] = lld_version.slice(1).map(Number) as [
                    number,
                    number,
                    number
                ];
                if (lld_major < 21 || (lld_major === 21 && lld_minor < 1)) {
                    isValidLinker = false;
                    console.warn(`Linker ${linkerPath} was identified as LLD, but an incorrect (outdated) version.\n` +
                        'Please update your LLD to version 21.1.x or newer.');
                    if (process.platform === 'win32') {
                        console.info('[?] Try running: winget upgrade LLVM.LLVM');
                    }
                    else if (process.platform === 'darwin') {
                        console.info('[?] Try running: brew upgrade lld');
                    }
                }
            }
        }
        else {
            console.warn(`Linker ${linkerPath} was identified as LLD, but an incorrect variant (likely one of: ld64.lld, lld-link, wasm-ld).\n` +
                'Please use the GNU-compatible (usually called "ld.lld") binary of LLD, as it is the only one supported by Tachyon.');
        }
    }
    else if (output.includes('ld')) {
        abort(`LD linker "${linkerPath}" is not supported, LLD is required.`);
    }
    if (!isValidLinker) {
        console.error('Compatibility issues were detected with the linker provided, therefore it is an unsupported configuration.');
        console.error('Linking will almost certainly fail or produce broken output.');
        if (!process.env.TACHYON_NO_TOOLCHAIN_CHECK) {
            abort('If you REALLY know what you are doing, at your own risk, you can set the TACHYON_NO_TOOLCHAIN_CHECK=1 environment variable to bypass this. Aborting.');
        }
        console.warn('TACHYON_NO_TOOLCHAIN_CHECK is set, so proceeding anyway... (THIS IS A VERY BAD IDEA!)');
        console.warn("Note that you are on your own if linking fails or produces broken output, and you alone are responsible for any issues that arise, including but not limited to bricked consoles, data loss, or damage to the host computer. Proceeding at your own risk.");
    }
    console.debug('Resolved LINKER path:', linkerPath);
    return linkerPath;
}
export function validateSysroot(sysrootPathRaw: string | undefined): string {
    if (!sysrootPathRaw)
        abort('Sysroot was undefined, this is an unsupported configuration. (Do you need to run "tachyon setup"?)');
    const sysrootPath = path.resolve(sysrootPathRaw);
    if (!isFolderAtSync(sysrootPath))
        abort('Sysroot path does not exist.');
    if (!isFolderAtSync(path.resolve(sysrootPath, 'lib')) ||
        !isFolderAtSync(path.resolve(sysrootPath, 'cxx')) ||
        !isFolderAtSync(path.resolve(sysrootPath, 'c'))) {
        abort('Invalid sysroot path.');
    }
    console.debug('Resolved SYSROOT path:', sysrootPath);
    return sysrootPath;
}
