import fs from 'node:fs';
import { abort, TitleID, type u32 } from '../utils.js';
import { type ConvMap, ConvPlatform } from './convmap.js';
export interface CSymbol {
    name: string;
    address: u32;
}
export class SymbolMap {
    readonly symbols: CSymbol[] = [];
    readonly addrsFromTitleID: bigint = 0n;
    constructor(filepath?: string, converter?: ConvMap, convPlatform = ConvPlatform.GLOBAL) {
        if (!filepath)
            return;
        const fileContent: string = fs.readFileSync(filepath, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');
        if (converter && !convPlatform)
            throw new Error('Dev assertion fail: convPlatform should be given to SymMap ctor.');
        let currentLine = 0;
        for (const iterline of fileContent.split('\n')) {
            currentLine++;
            const line = iterline.trim().replaceAll(' ', '').replaceAll('\t', '').split('//')[0];
            if (!line)
                continue;
            if (line[0] === '@') {
                const directiveKeyword = /^@(\w+)/.exec(line)?.[1];
                switch (directiveKeyword) {
                    case 'addresses_from': {
                        if (this.addrsFromTitleID)
                            abort(`Error parsing symbol map "${filepath}" at line ${currentLine}: Illegal duplicate @${directiveKeyword} directive.`);
                        const directiveArgs = /^"(.+)"$/.exec(line.slice(1 + directiveKeyword.length));
                        const tidParsed = TitleID.parse(directiveArgs?.[1] ?? '');
                        if (!tidParsed)
                            abort(`Error parsing symbol map "${filepath}" at line ${currentLine}: Invalid Title ID value for @${directiveKeyword} directive.`);
                        this.addrsFromTitleID = tidParsed;
                        break;
                    }
                    default: abort(`Error parsing symbol map "${filepath}" at line ${currentLine}: Invalid @ directive`);
                }
                continue;
            }
            if (line.at(-1) !== ';')
                abort(`Error parsing symbol map "${filepath}" at line ${currentLine}: Missing semicolon`);
            const [symName, symValue]: string[] = line.replaceAll(';', '').split('=');
            const sym: CSymbol = { name: symName!, address: NaN };
            sym.address = Number(symValue);
            if (Number.isNaN(sym.address)) {
                for (const prev of this.symbols) {
                    if (symValue === prev.name) {
                        sym.address = prev.address;
                        break;
                    }
                }
                if (Number.isNaN(sym.address))
                    abort(`Unable to locate literal address for symbol: ${symValue!}`);
            }
            else if (converter)
                sym.address = converter.convert(sym.address, convPlatform);
            this.symbols.push(sym);
        }
        if (!this.addrsFromTitleID)
            abort(`Symbol map "${filepath}" needs an \`@addresses_from "TITLE-ID"\` directive.`);
    }
    public toConverted(converter: ConvMap, convPlatform: ConvPlatform) {
        const converted = new SymbolMap();
        Reflect.set(converted, 'addrsFromTitleID', this.addrsFromTitleID);
        for (const symbol of this.symbols) {
            converted.symbols.push({
                name: symbol.name,
                address: converter.convert(symbol.address, convPlatform),
            });
        }
        return converted;
    }
}
