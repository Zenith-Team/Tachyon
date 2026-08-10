import { spawnSync } from 'node:child_process';
import path from 'node:path';
import $ from 'chalk';
const DemangleCache = new Map<string, string>();
const SymbolCachePerFunction = new Set<string>();
let DEMANGLER_BIN: string | null = '';
let DEMANGLER_FLAGS: string[] = [];
function lld_demangle(mangled: string) {
    if (DEMANGLER_BIN === null)
        return mangled;
    if (DEMANGLER_BIN === '') {
        const found = findDemangler();
        if (found) {
            DEMANGLER_BIN = found.cppfilt;
            DEMANGLER_FLAGS = found.flags;
        }
        else {
            DEMANGLER_BIN = null;
            console.warn("(lldpretty) Could not find a suitable demangler in your system.\nIf you have one in a non-standard location, please provide it's path on the TACHYON_DEMANGLER env. variable.");
            return mangled;
        }
    }
    if (mangled[0] !== '_')
        return mangled;
    const cached = DemangleCache.get(mangled);
    if (cached)
        return cached;
    const proc = spawnSync(DEMANGLER_BIN, [...DEMANGLER_FLAGS, mangled], { encoding: 'utf8' });
    if (proc.status !== 0 || proc.signal || proc.error || proc.stderr) {
        const errorInfo = proc.error?.message || proc.stderr.trim() || proc.signal || `exit code ${String(proc.status)}`;
        console.warn(`(lldpretty) Your demangler has thrown an error while demangling "${mangled}". (${errorInfo})`);
        return mangled;
    }
    const demangled = proc.stdout.trim();
    DemangleCache.set(mangled, demangled);
    return demangled;
}
function findDemangler() {
    const candidates: string[] = [
        'c++filt',
        'ppc-linux-c++filt',
        'powerpc64-linux-gnu-c++filt',
    ];
    if (process.env.TACHYON_DEMANGLER)
        candidates.unshift(process.env.TACHYON_DEMANGLER);
    for (const cppfilt of candidates) {
        const proc = spawnSync(cppfilt, ["_Z1fv"], { encoding: 'utf8' });
        if (proc.status !== 0 || proc.signal || proc.error || proc.stderr)
            continue;
        const demangled = proc.stdout.trim();
        if (demangled === "f()")
            return { cppfilt, flags: [] };
        const proc_n = spawnSync(cppfilt, ['-n', "_Z1fv"], { encoding: 'utf8' });
        if (proc_n.status !== 0 || proc_n.signal || proc_n.error || proc_n.stderr)
            continue;
        const demangled_n = proc_n.stdout.trim();
        if (demangled_n === "f()")
            return { cppfilt, flags: ['-n'] };
    }
    return null;
}
function prettySymRefLine(referencedSym: string, dupedSymMsg: boolean) {
    const refDemangled = lld_demangle(referencedSym);
    const didDemangle = refDemangled !== referencedSym;
    const refDemangledPretty = didDemangle ? ($.gray(' = ') + $.dim.redBright(refDemangled)) : '';
    const refSym = $.redBright(referencedSym) + refDemangledPretty;
    const txtMulti = `one or more ${dupedSymMsg ? 'duplicate' : 'undefined'} references to `;
    const msg = $.red(txtMulti + refSym);
    return msg;
}
export function lldpretty(lld_output: string): void {
    let out = lld_output.trim().replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const linesOut: string[] = [];
    const lines = out.split('\n');
    const STATE = {
        currentRefdSymbol: '',
        currentRefdSymbolType: '' as ('' | 'undef' | 'duped' | 'didyoumean'),
    };
    let undefSymCount = 0;
    for (const line of lines) {
        let lineOut = line;
        if (line.startsWith('>>> referenced by '))
            continue;
        if (line.startsWith('>>> defined at '))
            continue;
        if (line.startsWith('>>> the vtable symbol may be undefined because the class is missing its key function')) {
            linesOut.push($.dim.gray('    💡 The vtable symbol may be undefined because the class is missing its key function' +
                ` (see ${$.blue('https://lld.llvm.org/missingkeyfunction')})`));
            continue;
        }
        const symRefMoreTimesLine = /^>>> referenced (\d+) more times?$/.exec(line);
        if (symRefMoreTimesLine) {
            const [_, refCount] = symRefMoreTimesLine;
            if (!refCount)
                throw new Error('Internal Regex Failure [sRMTL]');
            linesOut.push($.gray(`    ... (${refCount} more reference${refCount !== '1' ? 's' : ''})`));
            continue;
        }
        if (line.startsWith('>>> did you mean: ')) {
            STATE.currentRefdSymbolType = 'didyoumean';
            STATE.currentRefdSymbol = line.slice(18).trim();
            continue;
        }
        if (line.startsWith('>>> defined in: ')) {
            const filepath = line.slice(16).trim();
            let suggestedPretty: string;
            if (STATE.currentRefdSymbolType !== 'didyoumean') {
                suggestedPretty = $.red('<lldpretty-error>');
            }
            else {
                const suggestedSym = STATE.currentRefdSymbol;
                const suggestedDemangled = lld_demangle(suggestedSym);
                const successfullyDemangled = suggestedDemangled !== suggestedSym;
                const refDemangledPretty = successfullyDemangled
                    ? ($.gray(' = ') + $.dim.redBright(suggestedDemangled))
                    : '';
                suggestedPretty = $.redBright(suggestedSym) + refDemangledPretty;
            }
            lineOut = $.gray(`    ${$.cyan.italic('Did you mean:')} ${suggestedPretty} (defined in ${$.blue(path.basename(filepath, '.o'))})`);
            linesOut.push(lineOut);
            continue;
        }
        const undefSymbolStartLine = /^(?:[\w-]+\.)?lld: error: undefined symbol: ([^`'\s]+)$/.exec(line);
        if (undefSymbolStartLine) {
            const [_, undefSymbol] = undefSymbolStartLine;
            if (!undefSymbol)
                throw new Error('Internal Regex Failure [uSSL]');
            lineOut = prettySymRefLine(undefSymbol, false);
            STATE.currentRefdSymbolType = 'undef';
            STATE.currentRefdSymbol = undefSymbol;
            linesOut.push(lineOut);
            undefSymCount++;
            continue;
        }
        const dupedSymbolStartLine = /^(?:[\w-]+\.)?lld: error: duplicate symbol: ([^`'\s]+)$/.exec(line);
        if (dupedSymbolStartLine) {
            const [_, dupeSymbol] = dupedSymbolStartLine;
            if (!dupeSymbol)
                throw new Error('Internal Regex Failure [dSSL]');
            lineOut = prettySymRefLine(dupeSymbol, true);
            STATE.currentRefdSymbolType = 'duped';
            STATE.currentRefdSymbol = dupeSymbol;
            linesOut.push(lineOut);
            continue;
        }
        const objFilePathLine = /^>>>\s+(.+)\.o:(\(.+\))/i.exec(line);
        if (objFilePathLine) {
            const [_, filepath, rest] = objFilePathLine;
            let restOut = rest!;
            const infuncMatch = /^\(([^`'\s]+)\)$/.exec(restOut);
            if (infuncMatch) {
                const [_, mangledSym] = infuncMatch;
                const joiner = STATE.currentRefdSymbolType === 'duped' ? ' in ' : ' in function ';
                restOut = $.gray(joiner) + $.magenta(lld_demangle(mangledSym!));
                SymbolCachePerFunction.clear();
            }
            const prefix = $.italic.gray('    at ') + $.blue(path.basename(filepath!));
            linesOut.push(prefix + restOut);
            continue;
        }
        STATE.currentRefdSymbolType = '';
        STATE.currentRefdSymbol = '';
        linesOut.push(lineOut);
    }
    out = linesOut.join('\n');
    console.log(out + '\n');
    if (undefSymCount > 1)
        console.warn(`${undefSymCount} symbols are missing`);
    else if (undefSymCount === 1)
        console.warn('1 symbol is missing');
}
