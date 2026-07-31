import fs from 'node:fs';
import path from 'node:path';
import { CodeBaseAddress, DataBaseAddress, LoadBaseAddress } from 'rpxlib';
import { ConvPlatform, type ConvMap } from '../../shared/convmap.js';
import type { Project } from '../../shared/project.js';
import { SymbolMap, type CSymbol } from '../../shared/symbolmap.js';
import { CommonFiles, TitleID, abort, hex, CommonDirs } from '../../utils.js';
export function loadSymbolMapsAndGetCodeSyms(project: Project, convMap: ConvMap) {
    const mainMapPath = path.join(project.path, CommonFiles.MainSymbolMap);
    const hasOwnSymbolMap = fs.existsSync(mainMapPath);
    const targetPlatform = TitleID.isConsoleTagged(project.config.targetTitleID!) ? ConvPlatform.CONSOLE : ConvPlatform.EMULATOR;
    const mainMap = hasOwnSymbolMap
        ? new SymbolMap(mainMapPath, convMap, targetPlatform)
        : new SymbolMap();
    const allSymbols: CSymbol[] = mainMap.symbols;
    let projectSymAddrsCommonTID = mainMap.addrsFromTitleID;
    for (const [depName, maps] of project.dependenciesSymbolAndConvMaps) {
        if (!hasOwnSymbolMap) {
            projectSymAddrsCommonTID = maps.syms.addrsFromTitleID;
            console.debug(`Using "${depName}"'s @addresses_from "${TitleID.format(projectSymAddrsCommonTID)}" as this project's symbol addresses common Title ID.`);
        }
        if (maps.syms.addrsFromTitleID !== projectSymAddrsCommonTID)
            abort(`Dependency "${depName}"'s symbol map is incompatible with yours due to using addresses from a different base title ID `
                + `(${TitleID.format(maps.syms.addrsFromTitleID)} vs ${TitleID.format(projectSymAddrsCommonTID)}).\n` +
                '  Support for mixing symbol maps with addresses of different base title IDs will be added at a later date.');
        const convertedMap = maps.syms.toConverted(convMap, targetPlatform);
        allSymbols.push({ name: depName, address: Infinity }, ...convertedMap.symbols);
    }
    const codeSymbols: CSymbol[] = [];
    const dataSymbolMap: string[] = ['SECTIONS {'];
    const seenNames = new Map<string, Map<string, number>>();
    let currentMapSource = project.config.name;
    NEXT_SYMBOL: for (const symbol of allSymbols) {
        if (symbol.address === Infinity) {
            currentMapSource = symbol.name;
            continue;
        }
        for (const [seenSource, seenNameMap] of seenNames) {
            const seenAddr = seenNameMap.get(symbol.name);
            if (seenAddr !== undefined) {
                if (currentMapSource === seenSource)
                    abort(`Symbol "${symbol.name}" (${hex(seenAddr)}${seenAddr !== symbol.address ? (' / ' + hex(symbol.address)) : ''}) is defined more than once in ` +
                        (seenSource === project.config.name
                            ? 'your symbol map. You should de-duplicate it.'
                            : `package "${seenSource}"'s symbol map. Contact that package's author.`));
                else if (seenAddr !== symbol.address)
                    abort(`Symbol "${symbol.name}" was found in two different packages symbol maps with conflicting addresses:\n` +
                        `  "${seenSource}" address -> ${hex(seenAddr)}\n` +
                        `  "${currentMapSource}" address -> ${hex(symbol.address)}`);
                else
                    continue NEXT_SYMBOL;
            }
        }
        if (!seenNames.get(currentMapSource))
            seenNames.set(currentMapSource, new Map());
        seenNames.get(currentMapSource)!.set(symbol.name, symbol.address);
        if (symbol.address >= CodeBaseAddress && symbol.address < DataBaseAddress) {
            codeSymbols.push(symbol);
        }
        else if (symbol.address >= DataBaseAddress && symbol.address < LoadBaseAddress) {
            dataSymbolMap.push(`  ${symbol.name} = ${hex(symbol.address, 8, '0x')};`);
        }
        else {
            abort(`Symbol ${symbol.name} is in an unknown section`);
        }
    }
    dataSymbolMap.push('}');
    const mapsDir = path.join(project.path, CommonDirs.SymbolMaps);
    fs.mkdirSync(mapsDir, { recursive: true });
    fs.writeFileSync(path.join(mapsDir, project.config.activeTargetName!) + '.syms.ld', dataSymbolMap.join('\n'));
    return codeSymbols;
}
