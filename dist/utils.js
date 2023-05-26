import fs from 'fs';
import path from 'path';
/**
 * Print out an error and terminate execution.
 */
export function abort(msg, code = 0) {
    if (process.env.TACHYON_LIB_MODE) {
        const error = new Error(msg);
        error.name = 'TachyonAbortedError';
        Error.captureStackTrace(error, abort);
        Reflect.set(error, 'code', code);
        throw error;
    }
    else {
        console.error(msg);
        process.exit(code);
    }
}
/**
 * Format a number into a proper hexadecimal string.
 */
export function hex(num, pad = 8, prefix = '') {
    return prefix + num.toString(16).toUpperCase().padStart(pad, '0');
}
/**
 * Scan an Assembly file for `.include` directives and return a list of dependencies
 */
export function scanAssemlyFileDependencies(asmfilePath, includeDir) {
    const fd = fs.openSync(asmfilePath, 'r');
    let buf = Buffer.alloc(10);
    fs.readSync(fd, buf, 0, 10, 0);
    if (!buf.toString('utf8').trimStart().startsWith('.include'))
        return;
    const directives = fs.readFileSync(fd, 'utf8').match(/^\.include +?"(.+?)"/gm);
    if (!directives)
        return;
    const includes = [];
    for (let i = 0; i < directives.length; i++) {
        const include = directives[i].slice(9).trimStart().slice(1, -1);
        const absolute = path.resolve(includeDir, include);
        let resolved;
        if (fs.existsSync(absolute))
            resolved = absolute;
        else {
            const relative = path.resolve(path.dirname(asmfilePath), include);
            if (fs.existsSync(relative))
                resolved = relative;
            else
                abort(`Could not resolve included ASM file "${include}" from "${asmfilePath}"`);
        }
        includes.push(resolved);
        const subdeps = scanAssemlyFileDependencies(resolved, includeDir);
        if (subdeps)
            includes.push(...subdeps);
    }
    return includes;
}
