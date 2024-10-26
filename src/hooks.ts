import { oFile, symbolMap } from './compile.js';
import { abort, hex, u32 } from './utils.js';
import { SymbolSection } from 'rpxlib';
import iconv from 'iconv-lite';

type DataTypes =
    | 'raw'
    | 'f32' | 'float'
    | 'f64' | 'double'
    | 'u8' | 'uchar'
    | 'u16' | 'ushort'
    | 'u32' | 'uint'
    | 'u64' | 'ulonglong'
    | 's8' | 'schar'
    | 's16' | 'short'
    | 's32' | 'int'
    | 's64' | 'longlong'
    | 'char' | 'wchar'
    | 'string' | 'wstring';
type PatchDataType = DataTypes | `${DataTypes}[]`;

type PatchEncoding =
    | 'UTF-8' | 'UTF8' | 'utf-8' | 'utf8' // ONLY valid for string datatype, throw error if not used with it
    | 'UCS-2' | 'UCS2' | 'ucs-2' | 'ucs2' // NOT valid for string datatype, throw error if used with it
    | 'Shift-JIS' | 'ShiftJIS' | 'shift-jis' | 'shiftjis' // valid for all 3 encoding-compatible datatypes

export interface HookYAML {
    type: string;
    addr: u32;
    count?: u32 | null; // Nop
    instr: 'b' | 'bl';  // Branch
    func: string;       // Branch and Funcptr
    data: string | number | number[]; // Patch
    datatype?: PatchDataType | null;  // Patch
    encoding?: PatchEncoding | null;  // Patch (only if datatype = string/wchar/wstring)
}

export interface Patch {
    address: u32;
    data: string;
}

export abstract class Hook {
    abstract get(): Patch;

    protected source(): u32 {
        return symbolMap.converter.convert(this.address);
    }
    protected address: u32 = 0;
}

export class NopHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;
        this.count = yaml.count ?? 1;
        if (!Number.isSafeInteger(this.count) || this.count < 1) abort(`Invalid count "${this.count}" for nop hook at address ${this.address}`);
    }
    public override get(): Patch {
        return { address: this.source(), data: '60000000'.repeat(this.count) };
    }
    count: u32;
}

export class ReturnHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;
    }
    public override get(): Patch {
        return { address: this.source(), data: '4E800020' };
    }
}

export class BranchHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;
        this.instr = yaml.instr;
        this.func = yaml.func;
        if (typeof this.func !== 'string' || !this.func) abort(`Invalid function name "${this.func}" for branch hook at address ${this.address}`);
    }

    public override get(): Patch {
        let instr: u32 = 0;
        let target: u32;

        try {
            const symtab = oFile.sections.find(section => section.name === '.symtab') as SymbolSection | undefined;
            if (symtab === undefined) throw null;
            const value = symtab.symbols.find(sym => sym.name === this.func)?.value;
            if (value === undefined) throw null;
            target = +value;
        } catch (err) {
            if (err !== null) throw err;
            target = symbolMap.getSymbol(this.func).address!;
        }

        instr = ((target) - this.source()) & 0x03FFFFFC;

        if      (this.instr === 'b')  instr |= 0x48000000;
        else if (this.instr === 'bl') instr |= 0x48000001;
        else abort(`Unknown branch instruction "${String(this.instr)}" in branch hook at address ${this.address} to function ${this.func}`);

        return {
            address: this.source(),
            data: hex(instr).slice(0, 8)
        };
    }
    instr: 'b' | 'bl';
    func: string;
}

export class FuncptrHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;
        this.func = yaml.func;
        if (typeof this.func !== 'string' || !this.func) abort(`Invalid function name "${this.func}" for funcptr hook at address ${this.address}`);
    }

    public override get(): Patch {
        let target: u32;

        try {
            const symtab = oFile.sections.find(section => section.name === '.symtab')! as SymbolSection;
            target = symtab.symbols.find(sym => sym.name === this.func)!.value.valueOf();
        } catch {
            target = symbolMap.getSymbol(this.func).address!;
        }
        return {
            address: this.source(),
            data: hex(target)
        };
    }
    func: string;
}

export class PatchHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;

        yaml.datatype ??= 'raw';
        let isArray = false;
        if (yaml.datatype.endsWith('[]')) {
            if (!(yaml.data instanceof Array)) abort(`Patch data of type ${yaml.datatype} is not an array for patch hook at address ${yaml.addr}`);
            yaml.datatype = yaml.datatype.slice(0, -2) as DataTypes;
            isArray = true;
        }
        let encoding: 'sjis' | 'utf16be' | 'utf8' = 'sjis';
        if ('encoding' in yaml && yaml.datatype !== 'string' && yaml.datatype !== 'wstring' && yaml.datatype !== 'wchar') {
            abort(`Encoding field is only valid for string/wstring/wchar datatypes for patch hook at address ${yaml.addr}`);
        } else {
            yaml.encoding ??= 'Shift-JIS';
            switch (yaml.encoding) {
                case 'Shift-JIS': case 'ShiftJIS':
                case 'shift-jis': case 'shiftjis':
                    // default value
                    break;
                case 'UCS-2': case 'UCS2':
                case 'ucs-2': case 'ucs2':
                    encoding = 'utf16be';
                    break;
                case 'UTF-8': case 'UTF8':
                case 'utf-8': case 'utf8':
                    encoding = 'utf8';
                    break;
                default: throw new Error(`Unknown encoding "${String(yaml.encoding)}" for patch hook at address ${yaml.addr}`);
            }
        }
        const tempbuf = Buffer.allocUnsafe(isArray ? 8 * (<never[]>yaml.data).length : 8);
        let i = 0;
        try {
            do {
                const value = isArray ? (<number[]>yaml.data)[i] : yaml.data;
                switch (yaml.datatype) {
                    case 'raw': {
                        if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string`);
                        const valueFmtd = value.replaceAll(/\s+/, '');
                        if (Buffer.from(valueFmtd, 'hex').byteLength !== valueFmtd.length / 2) {
                            abort(`Data of raw patch at address 0x${hex(yaml.addr)} is malformed: "${valueFmtd}"`);
                        }
                        this.data += valueFmtd;
                        break;
                    }
                    case 'float':
                    case 'f32':
                        if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                        tempbuf.writeFloatBE(value);
                        this.data += tempbuf.toString('hex', 0, 4);
                        break;
                    case 'double':
                    case 'f64':
                        if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                        tempbuf.writeDoubleBE(value);
                        this.data += tempbuf.toString('hex', 0, 8);
                        break;
                    case 'uchar':
                    case 'u8':
                        if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                        tempbuf.writeUint8(value);
                        this.data += tempbuf.toString('hex', 0, 1);
                        break;
                    case 'schar':
                    case 's8':
                        if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                        tempbuf.writeInt8(value);
                        this.data += tempbuf.toString('hex', 0, 1);
                        break;
                    case 'ushort':
                    case 'u16':
                        if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                        tempbuf.writeUint16BE(value);
                        this.data += tempbuf.toString('hex', 0, 2);
                        break;
                    case 'short':
                    case 's16':
                        if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                        tempbuf.writeInt16BE(value);
                        this.data += tempbuf.toString('hex', 0, 2);
                        break;
                    case 'uint':
                    case 'u32':
                        if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                        tempbuf.writeUint32BE(value);
                        this.data += tempbuf.toString('hex', 0, 4);
                        break;
                    case 'int':
                    case 's32':
                        if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                        tempbuf.writeInt32BE(value);
                        this.data += tempbuf.toString('hex', 0, 4);
                        break;
                    case 'ulonglong':
                    case 'u64':
                        if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string, 64-bit integers must be passed as strings to avoid truncation`);
                        tempbuf.writeBigUInt64BE(BigInt(value));
                        this.data += tempbuf.toString('hex', 0, 8);
                        break;
                    case 'longlong':
                    case 's64':
                        if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string, 64-bit integers must be passed as strings to avoid truncation`);
                        tempbuf.writeBigInt64BE(BigInt(value));
                        this.data += tempbuf.toString('hex', 0, 8);
                        break;
                    case 'char': {
                        if (value === null) {
                            this.data += '00';
                            break;
                        }
                        if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string`);
                        const written = tempbuf.write(value, 'ascii');
                        if (written !== 1) throw new Error(`The type of data #${i} is not a single ASCII character`);
                        this.data += tempbuf.toString('hex', 0, 1);
                        break;
                    }
                    case 'wchar': {
                        if (encoding === 'utf8') abort(`UTF-8 encoding is not valid for wchar datatypes for patch hook at address ${yaml.addr}`);
                        if (value === null) {
                            this.data += '0000';
                            break;
                        }
                        if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string`);
                        const charBuf = iconv.encode(value, encoding);
                        if (charBuf.byteLength > 2 || value.length !== 1) throw new Error(`The type of data #${i} is not a single ${encoding} character`);
                        this.data += charBuf.toString('hex', 0, 2).padStart(4, '0');
                        break;
                    }
                    case 'string':
                        if (encoding === 'utf16be') abort(`UCS-2 encoding is not valid for string datatypes for patch hook at address ${yaml.addr}`);
                        if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string`);
                        this.data += iconv.encode(value, encoding).toString('hex') + '00';
                        break;
                    case 'wstring':
                        if (encoding === 'utf8') abort(`UTF-8 encoding is not valid for wstring datatypes for patch hook at address ${yaml.addr}`);
                        if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string`);
                        for (const char of value) {
                            const encoded = iconv.encode(char, encoding);
                            if (encoded.byteLength > 2 || char.length !== 1) throw new Error(`The type of data #${i} is not a single ${encoding} character`);
                            this.data += encoded.toString('hex').padStart(4, '0');
                        }
                        this.data += '0000';
                        break;
                    default: abort(`Unknown datatype "${yaml.datatype}" for patch hook at address ${yaml.addr}`);
                }
                i++;
            } while (isArray && i < (<never[]>yaml.data).length);
        } catch (e) {
            if (e instanceof Error) abort(`Invalid data for patch hook at address ${yaml.addr}: ${e.message}`);
            else {
                console.error(`Unknown error for data of patch hook at address ${yaml.addr}, this is a bug!`);
                if (process.env.TACHYON_DEBUG) throw e;
                else process.exit(0);
            }
        }
        
    }

    public override get(): Patch {
        return { address: this.source(), data: this.data };
    }

    data: string = '';
}
