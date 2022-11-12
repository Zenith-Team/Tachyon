import fs from 'fs';
import path from 'path';
import { CodeBaseAddress, DataBaseAddress, LoadBaseAddress, Section, Util } from 'rpxlib';
import yaml from 'yaml';
import { abort, hex, s32, u32 } from './utils.js';

export interface CSymbol {
    name: string;
    address: u32;
}

interface OffsetYAML {
    from?: string;
    until?: string;
    add?: string;
}

interface ConvMapYAML {
    Offsets: OffsetYAML[];
}

interface Offset {
    from: u32;
    until: u32;
    add: u32;
}

export class ConvMap {
    constructor(yaml: ConvMapYAML, rpxsections: readonly Section[]) {
        for (let i = 0; i < rpxsections.length; i++) {
            const section = rpxsections[i]!;
            if (+section.addr === 0) continue;
            const end = Util.roundUp(<number>section.addr + <number>section.size, +section.addrAlign);
            if      (end >= CodeBaseAddress && end < DataBaseAddress && end > this.text) this.text = end;
            else if (end >= DataBaseAddress && end < LoadBaseAddress && end > this.data) this.data = end;
            else if (end >= LoadBaseAddress && end > this.syms) this.syms = end;
        }

        for (const offsetyml of yaml.Offsets) {
            (<Offset><unknown>offsetyml).from = Number(offsetyml.from);
            (<Offset><unknown>offsetyml).until = Number(offsetyml.until);
            (<Offset><unknown>offsetyml).add = Number(offsetyml.add);
            this.offsets.push(<Offset><unknown>offsetyml);
        }
    }

    public convert(address: u32): u32 {
        for (const offset of this.offsets) {
            if (address >= offset.from && address < offset.until) {
                return address + offset.add;
            }
        }
        return address;
    }

    public text: u32 = 0;
    public data: u32 = 0;
    public syms: u32 = 0;
    private offsets: Offset[] = [];
}

export class SymbolMap {
    constructor(projectPath: string, region: string, rpxsections: readonly Section[]) {
        const lines: string[] = fs.readFileSync(path.join(projectPath, 'syms', 'main.map'), 'utf8').split('\n');
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
            const convyaml: ConvMapYAML = yaml.parse(fs.readFileSync(path.join(projectPath, 'conv', region) + '.yaml', 'utf8'));
            this.converter = new ConvMap(convyaml, rpxsections);
        } catch {
            abort(`Invalid conversion map: ${path.join(projectPath, 'conv', region)}.yaml`);
        }

        this.convertedLines.push('SECTIONS {');

        for (const symbol of symbols) {
            symbol.address = this.converter.convert(symbol.address!);
            this.convertedLines.push(`\t${symbol.name} = 0x${hex(symbol.address)};`);
            this.symbols.push({ name: symbol.name, address: symbol.address });
        }

        this.convertedLines.push('}');
        fs.writeFileSync(path.join(projectPath, 'syms', region) + '.x', this.convertedLines.join('\n'));
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
