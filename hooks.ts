import { oFile, symbolMap } from './compile';
import { SymbolSection } from 'rpxlib';
import { hex, s32, u32 } from './utils';

export interface HookYAML {
    type: string;
    addr: string;
    instr: string; // Branch
    func: string;  // Branch and Funcptr
    count: s32;    // Multinop
    data: string;  // Patch
    value: string; // Return
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

        if (yaml.data.includes('0x')) {
            console.warn('Warning: patch data is considered to be hex bytes, ignoring unnecessary "0x"');
        }

        this.data = yaml.data.replaceAll('0x', '');
    }

    public override get(): Patch {
        return { address: this.source(), data: this.data };
    }

    data: string;
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
};

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
        else console.warn('Unknown branch instruction:', this.instr);

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
