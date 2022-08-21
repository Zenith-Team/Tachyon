import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { s32, u32 } from './utils';

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
    TextSection: string;
    DataSection: string;
    SymsSection: string;
    Offsets: OffsetYAML[];
}

interface Offset {
    from: u32;
    until: u32;
    add: u32;
}

export class ConvMap {
    constructor(yaml: ConvMapYAML) {
        this.text = Number(yaml.TextSection);
        this.data = Number(yaml.DataSection);
        this.syms = Number(yaml.SymsSection);

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

    public text: u32;
    public data: u32;
    public syms: u32;
    private offsets: Offset[] = [];
}

export class SymbolMap {
    constructor(projectPath: string, region: string) {
        const lines: string[] = fs.readFileSync(path.join(projectPath, 'syms', 'main.map'), 'utf8').split('\n');
        let symbols: CSymbol[] = [];

        // Parse map
        let currentLine: s32 = 0;
        for (const iterline of lines) {
            currentLine++;
            let line: string = iterline.trim().replaceAll(' ', '').replaceAll('\t', '');

            if (line === '' || line[0] === '#') continue;
            if (line.includes('#')) line = line.split('#')[0] ?? '';
            if (!line.endsWith(';')) {
                console.error(`Error parsing syms/main.map at line ${currentLine}: Missing semicolon`);
                process.exit();
            }

            const parts: string[] = line.replaceAll(';', '').split('=');
            const sym: CSymbol = { name: parts[0], address: NaN };

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
                if (!success) {
                    console.error(`Unable to locate literal address for symbol: ${parts[1]}`);
                    process.exit();
                }
            }
            symbols.push(sym);
        }

        // Convert
        try {
            const convyaml: ConvMapYAML = yaml.parse(fs.readFileSync(path.join(projectPath, 'conv', region) + '.yaml', 'utf8'));
            this.converter = new ConvMap(convyaml);
        } catch {
            console.error(`Invalid conversion map: ${path.join(projectPath, 'conv', region)}.yaml`);
            process.exit();
        }

        this.convertedLines.push('SECTIONS {');

        for (const symbol of symbols) {
            symbol.address = this.converter.convert(symbol.address!);
            
            this.convertedLines.push('\t' + symbol.name + ' = 0x' + symbol.address!.toString(16).toUpperCase() + ';');
            this.symbols.push({ name: symbol.name!, address: symbol.address! });
        }

        this.convertedLines.push('}');
        fs.writeFileSync(path.join(projectPath, 'syms', region) + '.x', this.convertedLines.join('\n'));
    }

    public getSymbol(name: string): CSymbol {
        for (const symbol of this.symbols) {
            if (symbol.name === name) return symbol;
        }
        console.error(`Failed to find required symbol: ${name}`);
        process.exit();
    }

    convertedLines: string[] = [];
    symbols: CSymbol[] = [];
    converter: ConvMap;
}
