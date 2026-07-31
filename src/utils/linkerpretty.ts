import { spawnSync } from 'node:child_process';
import path from 'node:path';
import $ from 'chalk';
const DemangleCache = new Map<string, string>();
const SymbolCachePerFunction = new Set<string>();
function ldpretty(LD: string): void {
    let out = LD.trim().replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    out = out.replaceAll(/^[\w-]+-ld: /gm, '');
    const linesOut: string[] = [];
    const lines = out.split('\n');
    const STATE = {
        infunctionInnerLineNth: 0,
    };
    for (const line of lines) {
        let lineOut = line;
        const match = /^([^:]+)\.[oO]:(.+)/.exec(line);
        if (match) {
            const [_, filepath, rest] = match;
            let restOut = rest!;
            const infuncMatch = /^ in function `([^`']+)':$/.exec(restOut);
            if (infuncMatch) {
                const [_, mangledSym] = infuncMatch;
                restOut = $.gray(' in function ') + $.magenta(ld_demangle(mangledSym!)) + ':';
                STATE.infunctionInnerLineNth = 1;
                SymbolCachePerFunction.clear();
            }
            else {
                const infuncInnerMatch = /^\(([^+]+)\+0x([\dA-Fa-f]+)\): undefined reference to `([^`']+)'$/.exec(restOut);
                if (infuncInnerMatch) {
                    const [_, elfSectionOrSym, hexOffset, referencedSym] = infuncInnerMatch;
                    const prettied = prettySymRefLine(elfSectionOrSym!, hexOffset!, referencedSym!, true);
                    restOut = prettied;
                }
                else {
                    const moreRefsMatch = /^[^:\\/]+:\(([^+]+)\+0x([\dA-Fa-f]+)\): more undefined references to `([^`']+)' follow$/.exec(restOut);
                    if (moreRefsMatch) {
                        const [_, elfSectionOrSym, hexOffset, referencedSym] = moreRefsMatch;
                        const prettied = prettySymRefLine(elfSectionOrSym!, hexOffset!, referencedSym!, true, true);
                        restOut = prettied;
                    }
                }
            }
            const prefix = ($.blue(path.basename(filepath!)) + ':');
            linesOut.push(prefix + restOut);
            continue;
        }
        if (STATE.infunctionInnerLineNth > 0) {
            const infuncInnerMatch = /^[^:\\/]+:\(([^+]+)\+0x([\dA-Fa-f]+)\): undefined reference to `([^`']+)'$/.exec(lineOut);
            if (infuncInnerMatch) {
                const [_, elfSectionOrSym, hexOffset, referencedSym] = infuncInnerMatch;
                const prettied = prettySymRefLine(elfSectionOrSym!, hexOffset!, referencedSym!);
                lineOut = prettied;
                STATE.infunctionInnerLineNth++;
            }
            else {
                STATE.infunctionInnerLineNth = 0;
            }
        }
        linesOut.push(lineOut);
    }
    out = linesOut.join('\n');
    console.log(out);
}
function prettySymRefLine(elfSectionOrSym: string, hexOffset: string, referencedSym: string, standalone = false, multiRefMsg = false, lld = false, dupedSymMsg = false) {
    const hasSym = elfSectionOrSym.endsWith(']');
    const elfSection = hasSym ? elfSectionOrSym.slice(0, elfSectionOrSym.lastIndexOf('.')) : elfSectionOrSym;
    const prefix = lld ? '' : (multiRefMsg
        ? $.italic.gray(' from ')
        : (standalone ? ' ' : $.italic.gray('    at ')));
    const refDemangled = ld_demangle(referencedSym);
    const successfullyDemangled = refDemangled !== referencedSym;
    const refDemangledPretty = successfullyDemangled
        ? ($.gray(' = ') + $.dim.redBright(refDemangled))
        : '';
    const refSym = $.redBright(referencedSym) + refDemangledPretty;
    const location = lld ? '' : ($.white(elfSection) + $.gray('+0x' + hexOffset.toUpperCase().padStart(2, '0')) + ': ');
    const txtSingle = (dupedSymMsg ? 'duplicate' : 'undefined') + ' reference to ';
    const txtMulti = `one or more ${dupedSymMsg ? 'duplicate' : 'undefined'} references to `;
    const msg = multiRefMsg
        ? $[lld ? 'red' : 'italic']($.red(txtMulti) + refSym)
        : ($.red(txtSingle) + refSym);
    return prefix + location + msg;
}
let DEMANGLER_BIN: string | null = '';
let DEMANGLER_FLAGS: string[] = [];
function ld_demangle(mangled: string) {
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
            console.warn('(ldpretty) Could not find a suitable demangler in your system.\nIf you have one in a non-standard location, please provide it\'s path on the TACHYON_DEMANGLER env. variable.');
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
        console.warn(`(ldpretty) Your demangler has thrown an error while demangling "${mangled}". (${errorInfo})`);
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
        const proc = spawnSync(cppfilt, ['_Z1fv'], { encoding: 'utf8' });
        if (proc.status !== 0 || proc.signal || proc.error || proc.stderr)
            continue;
        const demangled = proc.stdout.trim();
        if (demangled === 'f()')
            return { cppfilt, flags: [] };
        const proc_n = spawnSync(cppfilt, ['-n', '_Z1fv'], { encoding: 'utf8' });
        if (proc_n.status !== 0 || proc_n.signal || proc_n.error || proc_n.stderr)
            continue;
        const demangled_n = proc_n.stdout.trim();
        if (demangled_n === 'f()')
            return { cppfilt, flags: ['-n'] };
    }
    return null;
}
function lldpretty(LLD: string): void {
    let out = LLD.trim().replaceAll('\r\n', '\n').replaceAll('\r', '\n');
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
                const suggestedDemangled = ld_demangle(suggestedSym);
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
                throw new Error('sad');
            lineOut = prettySymRefLine('', '', undefSymbol, true, true, true);
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
                throw new Error('sad sad');
            lineOut = prettySymRefLine('', '', dupeSymbol, true, true, true, true);
            STATE.currentRefdSymbolType = 'duped';
            STATE.currentRefdSymbol = dupeSymbol;
            linesOut.push(lineOut);
            continue;
        }
        const objFilePathLine = /^>>>\s+([^:]+)\.[oO]:(.+)/.exec(line);
        if (objFilePathLine) {
            const [_, filepath, rest] = objFilePathLine;
            let restOut = rest!;
            const infuncMatch = /^\(([^`'\s]+)\)$/.exec(restOut);
            if (infuncMatch) {
                const [_, mangledSym] = infuncMatch;
                const joiner = STATE.currentRefdSymbolType === 'duped' ? ' in ' : ' in function ';
                restOut = $.gray(joiner) + $.magenta(ld_demangle(mangledSym!));
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
export function linkerPrettier(text: string): void {
    const isLLD = process.env.TACHYON_LINKER_TYPE === 'ld.lld';
    if (isLLD)
        return lldpretty(text);
    else
        return ldpretty(text);
}
