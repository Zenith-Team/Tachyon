import fs from 'fs';
import path from 'path';
import { CodeBaseAddress, DataBaseAddress, LoadBaseAddress, Section, Util } from 'rpxlib';
import { abort, hex, s32, u32 } from './utils.js';

export interface CSymbol {
    name: string;
    address: u32;
}

interface ConvOffset {
    from: u32;
    until: u32;
    value: u32;
}

interface ConvAddrs {
    TextAddr: u32 | null;
    DataAddr: u32 | null;
    SymsAddr: u32 | null;
}

export class ConvMap {
    constructor(offsets: ConvOffset[], addrs: ConvAddrs, rpxsections: readonly Section[]) {
        for (let i = 0; i < rpxsections.length; i++) {
            const section = rpxsections[i]!;
            if (+section.addr === 0) continue;
            const end = Util.roundUp(<number>section.addr + <number>section.size, +section.addrAlign);
            if      (end >= CodeBaseAddress && end < DataBaseAddress && end > this.text) this.text = end;
            else if (end >= DataBaseAddress && end < LoadBaseAddress && end > this.data) this.data = end;
            else if (end >= LoadBaseAddress && end > this.syms) this.syms = end;
        }
        // Console overrides
        if (addrs.TextAddr !== null) this.text = addrs.TextAddr;
        if (addrs.DataAddr !== null) this.data = addrs.DataAddr;
        if (addrs.SymsAddr !== null) this.syms = addrs.SymsAddr;

        this.#offsets = offsets;
    }

    public convert(address: u32): u32 {
        for (const offset of this.#offsets) {
            if (address >= offset.from && address < offset.until) {
                address += offset.value;
            }
        }
        return address;
    }

    public text: u32 = 0;
    public data: u32 = 0;
    public syms: u32 = 0;
    #offsets: ConvOffset[] = [];
}

export class SymbolMap {
    constructor(metaPath: string, targetAddrMap: string, rpxsections: readonly Section[]) {
        const lines: string[] = fs.readFileSync(path.join(metaPath, 'syms', 'main.map'), 'utf8').split('\n');
        let symbols: CSymbol[] = [];

        // Parse map
        let currentLine: s32 = 0;
        for (const iterline of lines) {
            currentLine++;
            let line: string = iterline.trim().replaceAll(' ', '').replaceAll('\t', '');

            if (line === '' || line[0] === '#') continue;
            if (line.includes('#')) line = line.split('#')[0] ?? '';
            if (!line.endsWith(';')) abort(`Error parsing syms/main.map at line ${currentLine}: Missing semicolon`);

            const parts: string[] = line.replaceAll(';', '').split('=');
            const sym: CSymbol = { name: parts[0]!, address: NaN };

            try {
                const num = Number(parts[1]);
                if (Number.isNaN(num)) throw null;
                sym.address = num;
            } catch { // Map it to a previous address
                let success: boolean = false;
                for (const entry of symbols) {
                    if (entry.name === parts[1]) {
                        success = true;
                        sym.address = entry.address;
                        break;
                    }
                }
                if (!success) abort(`Unable to locate literal address for symbol: ${parts[1]}`);
            }
            symbols.push(sym);
        }

        // Convert
        try {
            const offsetsFile = fs.readFileSync(path.join(metaPath, 'conv', targetAddrMap) + '.offs', 'utf8');
            const regex = /^([\dA-F]{1,8}) *- *([\dA-F]{1,8}) *: *([+-]) *(0x[\dA-F]{1,8}|\d{1,10})/;
            let addrs: ConvAddrs = { TextAddr: null, DataAddr: null, SymsAddr: null };
            let offsets: ConvOffset[] = [];
            let linenum: number = 0;
            for (const lineRaw of offsetsFile.split('\n')) {
                linenum++;
                const line = lineRaw.trim();
                if (!line || line[0] === '#' || line.startsWith('//')) continue;
                const split = line.split('=');
                if (split.length === 2) {
                    const label = split[0]!.trim();
                    const value = Number(split[1]!.trim());
                    if (label in addrs) {
                        if (Number.isNaN(value)) abort(`Invalid value for ${label} at line ${linenum} of ${targetAddrMap}.offs`);
                        addrs[label as keyof typeof addrs] = value;
                        continue;
                    } else abort(`Unknown label ${label} at line ${linenum} of ${targetAddrMap}.offs`);
                }
                const match = regex.exec(line);
                if (!match) abort(`Failed to parse line ${linenum} in ${targetAddrMap}.offs`);
                const [_, from, until, sign, value] = match;
                offsets.push({ from: Number('0x'+from), until: Number('0x'+until), value: sign === '-' ? -Number(value) : Number(value) });
            }
            this.converter = new ConvMap(offsets, addrs, rpxsections);
        } catch {
            abort(`Invalid conversion map: ${path.join(metaPath, 'conv', targetAddrMap)}`);
        }

        this.convertedLines.push('SECTIONS {');

        for (const symbol of symbols) {
            symbol.address = this.converter.convert(symbol.address!);
            this.convertedLines.push(`\t${symbol.name} = 0x${hex(symbol.address)};`);
            this.symbols.push({ name: symbol.name, address: symbol.address });
        }

        this.convertedLines.push('}');
        fs.writeFileSync(path.join(metaPath, 'syms', targetAddrMap) + '.x', this.convertedLines.join('\n'));
    }

    public getSymbol(name: string): CSymbol {
        for (const symbol of this.symbols) {
            if (symbol.name === name) return symbol;
        }
        abort(`Failed to find required symbol: ${name}`);
    }

    convertedLines: string[] = [];
    symbols: CSymbol[] = [];
    converter: ConvMap;
}
