import {
    RPL, Util, Section, NoBitsSection, RelocationSection, StringSection, SymbolSection, LoadBaseAddress
} from 'rpxlib';
import { u32, hex, abort } from './utils.js';
import { Patch } from './hooks.js';

export function patchRPX(compiledRPX: RPL, baseRPX: RPL, patches: Patch[], brand: string, addrs: { syms: u32, text: u32, data: u32 }) {
    interface SectionMap {
        text: Section, rodata: Section, data: Section, bss: NoBitsSection,
        symtab: SymbolSection, strtab: StringSection,
        relatext: RelocationSection,
        relarodata: RelocationSection,
        reladata: RelocationSection
    }

    const rpxSections = {} as SectionMap;
    for (const section of baseRPX.sections) {
        switch (section.name) {
            case '.text': rpxSections.text = section; break;
            case '.rodata': rpxSections.rodata = section; break;
            case '.data': rpxSections.data = section; break;
            case '.bss': rpxSections.bss = section as NoBitsSection; break;
            case '.symtab': rpxSections.symtab = section as SymbolSection; break;
            case '.strtab': rpxSections.strtab = section as StringSection; break;
            case '.rela.text': rpxSections.relatext = section as RelocationSection; break;
            case '.rela.rodata': rpxSections.relarodata = section as RelocationSection; break;
            case '.rela.data': rpxSections.reladata = section as RelocationSection; break;
        }
    }
    const compiledRPXSections = {} as Partial<SectionMap> & { text: Section };
    for (const section of compiledRPX.sections) {
        switch (section.name) {
            case '.text': compiledRPXSections.text = section; break;
            case '.rodata': compiledRPXSections.rodata = section; break;
            case '.data': compiledRPXSections.data = section; break;
            case '.bss': compiledRPXSections.bss = section as NoBitsSection; break;
            case '.symtab': compiledRPXSections.symtab = section as SymbolSection; break;
            case '.strtab': compiledRPXSections.strtab = section as StringSection; break;
            case '.rela.text': compiledRPXSections.relatext = section as RelocationSection; break;
            case '.rela.rodata': compiledRPXSections.relarodata = section as RelocationSection; break;
            case '.rela.data': compiledRPXSections.reladata = section as RelocationSection; break;
        }
    }

    compiledRPXSections.text.nameOffset = baseRPX.shstrSection.strings.add(`.text.${brand}`);
    compiledRPXSections.text.flags = rpxSections.text.flags;
    baseRPX.pushSection(compiledRPXSections.text);

    if (compiledRPXSections.rodata) {
        compiledRPXSections.rodata.nameOffset = baseRPX.shstrSection.strings.add(`.rodata.${brand}`);
        compiledRPXSections.rodata.flags = rpxSections.rodata.flags;
        baseRPX.pushSection(compiledRPXSections.rodata);
    }
    if (compiledRPXSections.data) {
        compiledRPXSections.data.nameOffset = baseRPX.shstrSection.strings.add(`.data.${brand}`);
        compiledRPXSections.data.flags = rpxSections.data.flags;
        baseRPX.pushSection(compiledRPXSections.data);
    }
    if (compiledRPXSections.bss) {
        compiledRPXSections.bss.nameOffset = baseRPX.shstrSection.strings.add(`.bss.${brand}`);
        compiledRPXSections.bss.flags = rpxSections.bss.flags;
        baseRPX.pushSection(compiledRPXSections.bss);
    }
    if (compiledRPXSections.relatext) {
        compiledRPXSections.relatext.nameOffset = baseRPX.shstrSection.strings.add(`.rela.text.${brand}`);
        compiledRPXSections.relatext.flags = rpxSections.relatext.flags;
        baseRPX.pushSection(compiledRPXSections.relatext);
    }
    if (compiledRPXSections.relarodata) {
        compiledRPXSections.relarodata.nameOffset = baseRPX.shstrSection.strings.add(`.rela.rodata.${brand}`);
        compiledRPXSections.relarodata.flags = rpxSections.relarodata.flags;
        baseRPX.pushSection(compiledRPXSections.relarodata);
    }
    if (compiledRPXSections.reladata) {
        compiledRPXSections.reladata.nameOffset = baseRPX.shstrSection.strings.add(`.rela.data.${brand}`);
        compiledRPXSections.reladata.flags = rpxSections.reladata.flags;
        baseRPX.pushSection(compiledRPXSections.reladata);
    }
    if (compiledRPXSections.symtab) {
        compiledRPXSections.symtab.nameOffset = baseRPX.shstrSection.strings.add(`.symtab.${brand}`);
        compiledRPXSections.symtab.flags = rpxSections.symtab.flags;
        compiledRPXSections.symtab.addr = Util.roundUp(addrs.syms, +compiledRPXSections.symtab.addrAlign);
        baseRPX.pushSection(compiledRPXSections.symtab);
    }
    if (compiledRPXSections.strtab) {
        compiledRPXSections.strtab.nameOffset = baseRPX.shstrSection.strings.add(`.strtab.${brand}`);
        compiledRPXSections.strtab.flags = rpxSections.strtab.flags;
        compiledRPXSections.strtab.addr = Util.roundUp(
            addrs.syms + (compiledRPXSections.symtab ? +compiledRPXSections.symtab.size : 0),
            +compiledRPXSections.strtab.addrAlign
        );
        baseRPX.pushSection(compiledRPXSections.strtab);
    }
    if (compiledRPXSections.symtab && compiledRPXSections.strtab) {
        compiledRPXSections.symtab.link = compiledRPXSections.strtab.index;
    }
    baseRPX.crcSection.nameOffset = baseRPX.shstrSection.strings.add(`.rplcrcs`);
    baseRPX.fileinfoSection.nameOffset = baseRPX.shstrSection.strings.add(`.rplfileinfo`);

    let checks = 0;
    for (const patch of patches) {
        let targetSection: Section;
        let targetRelocSection: RelocationSection;

        const address: u32 = patch.address;
        const data: string = patch.data.toUpperCase();

        if (rpxSections.text.addr <= address && address < addrs.text) {
            targetSection = rpxSections.text;
            targetRelocSection = rpxSections.relatext;
        } else if (Math.min(+rpxSections.rodata.addr, +rpxSections.data.addr) <= address && address < addrs.data) {
            if (rpxSections.rodata.addr <= address && address < (<number>rpxSections.rodata.addr + <number>rpxSections.rodata.size)) {
                targetSection = rpxSections.rodata;
                targetRelocSection = rpxSections.relarodata;
            } else if (rpxSections.data.addr <= address && address < (<number>rpxSections.data.addr + <number>rpxSections.data.size)) {
                targetSection = rpxSections.data;
                targetRelocSection = rpxSections.reladata;
            } else {
                abort(
                    `Patch of data "${data}" at address 0x${
                        hex(address)
                    } is within the data sections bounds but outside all known patchable data sections (.data & .rodata)`
                );
                continue;
            }
        } else {
            abort(`Patch of data "${data}" at address 0x${hex(address)} is out of bounds.`);
            continue;
        }

        const dataBytes = Buffer.from(data, 'hex');
        if (dataBytes.byteLength !== data.length / 2) {
            abort(`Data of patch at address 0x${hex(address)} of section ${targetSection.name} is malformed: "${data}"`);
            continue;
        }
        if (dataBytes.byteLength % 2) {
            abort(`Data of patch at address 0x${hex(address)} of section ${targetSection.name} is not 2-byte aligned: "${data}"`);
            continue;
        }

        // Backtrack for overlapping relocations starting prior to the patch
        for (let i = 1; i <= 3; i++) {
            checks++;
            const relAddr = address - i;
            //console.debug(`[PREREL] Checking for relocation at 0x${hex(relAddr)} for patch at 0x${hex(address)}+${dataBytes.byteLength}`);
            const rel = targetRelocSection.relocations.get(relAddr);
            if (rel && (i === 1 || rel.fieldSize === 4)) abort(
                `Patch of data "${data}" at address 0x${
                    hex(address)
                } of section ${targetSection.name} is partially overwritten by a ${rel.fieldSize}-byte relocation at 0x${hex(relAddr)}.\n` +
                `To fix this problem, move the patch to 0x${
                    hex(relAddr)
                } and prepend to the patch data the relocated value of the ${i} bytes before the actual patched bytes.`
            );
        }

        // Check for relocations bleeding beyond the patch
        const bleedableBytesN = dataBytes.byteLength >= 4 ? 3 : dataBytes.byteLength - 1;
        for (let i = 1; i <= bleedableBytesN; i++) {
            checks++;
            const relAddr = address + dataBytes.byteLength - i;
            //console.debug(`[POSTREL] Checking for relocation at 0x${hex(relAddr)} for patch at 0x${hex(address)}+${dataBytes.byteLength}`);
            const rel = targetRelocSection.relocations.get(relAddr);
            if (!rel) continue;
            if (i === 1 || rel.fieldSize === 4) abort(
                `Patch of data "${data}" at address 0x${
                    hex(address)
                } of section ${targetSection.name} deletes a ${rel.fieldSize}-byte relocation at 0x${hex(relAddr)} which partially relocates beyond the patch.\n` +
                `To fix this problem, append to the patch data the relocated value of the ${rel.fieldSize - i} bytes after the actual bytes being patched.`
            );
            else {
                targetRelocSection.relocations.deleteAt(relAddr);
                //console.debug(
                //    `Deleted relocation size ${rel.fieldSize} at address 0x${hex(relAddr)} of section ${targetSection.name} for patch at 0x${hex(address)}+${dataBytes.byteLength}`
                //);
            }
        }

        // Check for overlapping relocations mid-patch
        const bytesToCheckN = dataBytes.byteLength - bleedableBytesN;
        for (let i = 0; i < bytesToCheckN; i++) {
            checks++;
            const relAddr = address + i;
            //console.debug(`[REL] Checking for relocation at 0x${hex(relAddr)} for patch at 0x${hex(address)}+${dataBytes.byteLength}`);
            const rel = targetRelocSection.relocations.get(relAddr);
            if (!rel) continue;
            targetRelocSection.relocations.deleteAt(relAddr);
            //console.debug(
            //    `Deleted relocation size ${rel.fieldSize} at address 0x${hex(relAddr)} of section ${targetSection.name} for patch at 0x${hex(address)}+${dataBytes.byteLength}`
            //);
        }

        // Write the patch data
        //console.debug(`Patching data "${data}" at address 0x${hex(address)} of section ${targetSection.name}`);
        targetSection.data!.set(dataBytes, address - <number>targetSection.addr);
    }
    console.log(`Checked all possible relocation conflicts in ${checks} checks for ${patches.length} patches.`);

    baseRPX.shstrSection.addr = baseRPX.addressRanges.free.find(([start]) => start >= LoadBaseAddress)![0];
    baseRPX.fileinfoSection.adjustFileInfoSizes();
    // CEMU subtracts 0x90 from this value for some random reason (?)
    (<number>baseRPX.fileinfoSection.fileinfo.loadSize) += 0x90;
}
