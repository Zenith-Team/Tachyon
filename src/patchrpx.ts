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

        // Backtrack for overlapping relocation prior to the patch
        const prerel = targetRelocSection.relocations.get(address - 2);
        if (prerel && prerel.fieldSize === 4) abort(
            `Patch of data "${data}" at address 0x${
                hex(address)
            } of section ${targetSection.name} is partially overwritten by a 4-byte relocation at 0x${hex(address - 2)}.\n` +
            `To fix this problem, move the patch to 0x${
                hex(address - 2)
            } and prepend to the patch data the relocated value of the 2 bytes before the actual patched bytes.`
        );

        // Check for overlapping relocations mid-patch
        for (let i = 0; i <= dataBytes.byteLength - 2; i += 2) {
            const rel = targetRelocSection.relocations.get(address + i);
            if (!rel) continue;
            targetRelocSection.relocations.deleteAt(address + i);
            //console['debug'](
            //    `Deleted relocation at address 0x${hex(address + i)} of section ${targetSection.name} for patch at 0x${hex(address)}+${dataBytes.byteLength}`
            //);
        }

        // Check for relocation bleeding beyond the patch
        const postrel = targetRelocSection.relocations.get(address + dataBytes.byteLength - 2);
        if (postrel && postrel.fieldSize === 4) abort(
            `Patch of data "${data}" at address 0x${
                hex(address)
            } of section ${targetSection.name} deletes a 4-byte relocation at 0x${
                hex(address + dataBytes.byteLength - 2)
            } which partially relocated beyond the patch.\n` +
            `To fix this problem, append to the patch data the relocated value of the 2 bytes after the actual patched bytes.`
        );

        // Write the patch data
        targetSection.data!.set(dataBytes, address - <number>targetSection.addr);
    }

    baseRPX.shstrSection.addr = baseRPX.addressRanges.free.find(([start]) => start >= LoadBaseAddress)![0];
    baseRPX.fileinfoSection.adjustFileInfoSizes();
    // CEMU subtracts 0x90 from this value for some random reason (?)
    (<number>baseRPX.fileinfoSection.fileinfo.loadSize) += 0x90;
}
