﻿import { oFile, symbolMap } from './compile.js';
import { abort, hex, s32, u32 } from './utils.js';
import { SymbolSection } from 'rpxlib';

export interface HookYAML {
    type: string;
    addr: string;
    instr: string;    // Branch
    func: string;     // Branch and Funcptr
    count: s32;       // Multinop
    data: string | number | number[]; // Patch
    datatype: string; // Patch
    value: string;    // Return
}

export interface Patch {
    address: u32;
    data: string;
}

export abstract class Hook {
    abstract get(): Patch;

    protected source(): u32 {
        return symbolMap.converter.convert(Number(this.address));
    }

    protected address: string = '';
}

export class PatchHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;

        if (!yaml.datatype || yaml.datatype === 'raw') {
            if (typeof yaml.data !== 'string') return abort(`Patch data of type raw is not a string for patch hook at address ${yaml.addr}`);
            if (yaml.data.startsWith('0x')) {
                console.warn(
                    `Patch data is automatically considered to be hex bytes, ignoring unnecessary "0x" in data of patch at address ${yaml.addr}`
                );
                yaml.data = yaml.data.slice(2);
            }
            this.data = yaml.data;
        } else {
            let isArray = false;
            if (yaml.datatype.endsWith('[]')) {
                if (!(yaml.data instanceof Array)) abort(`Patch data of type ${yaml.datatype} is not an array for patch hook at address ${yaml.addr}`);
                yaml.datatype = yaml.datatype.slice(0, -2);
                isArray = true;
            }
            const tempbuf = Buffer.allocUnsafe(isArray ? 8 * (<never[]>yaml.data).length : 8);
            let i = 0;
            try {
                do {
                    const value = isArray ? (<number[]>yaml.data)[i] : yaml.data;
                    switch (yaml.datatype) {
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
                        case 'char':
                            if (value === null) {
                                this.data += '00';
                                break;
                            }
                            if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string`);
                            if (value.length !== 1) throw new Error(`The type of data #${i} is not a single character`);
                            tempbuf.write(value, 'ascii');
                            this.data += tempbuf.toString('hex', 0, 1);
                            break;
                        case 'ushort':
                        case 'u16':
                            if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                            tempbuf.writeUint16BE(value);
                            this.data += tempbuf.toString('hex', 0, 2);
                            break;
                        case 'sshort':
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
                        case 'sint':
                        case 'int':
                        case 's32':
                            if (typeof value !== 'number') throw new Error(`The type of data #${i} is not a number`);
                            tempbuf.writeInt32BE(value);
                            this.data += tempbuf.toString('hex', 0, 4);
                            break;
                        case 'unsigned-comically-large-integer':
                        case 'ulonglong':
                        case 'u64':
                            if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string, 64-bit integers must be passed as strings to avoid truncation`);
                            tempbuf.writeBigUInt64BE(BigInt(value));
                            this.data += tempbuf.toString('hex', 0, 8);
                            break;
                        case 'signed-comically-large-integer':
                        case 'comically-large-integer':
                        case 'slonglong':
                        case 'longlong':
                        case 's64':
                            if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string, 64-bit integers must be passed as strings to avoid truncation`);
                            tempbuf.writeBigInt64BE(BigInt(value));
                            this.data += tempbuf.toString('hex', 0, 8);
                            break;
                        case 'string':
                            if (typeof value !== 'string') throw new Error(`The type of data #${i} is not a string`);
                            this.data += Buffer.from(value, 'utf8').toString('hex') + '00';
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
    }

    public override get(): Patch {
        return { address: this.source(), data: this.data };
    }

    data: string = '';
}

export class NopHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;
    }

    public override get(): Patch {
        return { address: this.source(), data: '60000000' };
    }
}

export class MultiNopHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;
        this.count = yaml.count;
    }

    public override get(): Patch {
        return { address: this.source(), data: '60000000'.repeat(this.count) };
    }

    count: u32;
}

export class ReturnValueHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;
        this.returnValue = yaml.value!;
    }

    public override get(): Patch {
        return {
            address: this.source(),
            data: '386000' + this.returnValue.padStart(2, '0') + '4E800020'
        };
    }

    returnValue: string;
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
        else abort(`Unknown branch instruction "${this.instr}" in branch hook at address ${this.address} to function ${this.func}`);

        return {
            address: this.source(),
            data: hex(instr).slice(0, 8)
        };
    }

    instr: string;
    func: string;
}

export class FuncptrHook extends Hook {
    constructor(yaml: HookYAML) {
        super();
        this.address = yaml.addr;
        this.func = yaml.func;
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
