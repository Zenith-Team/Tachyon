import {
    RPL, Util, Section, NoBitsSection, RelocationSection, StringSection, SymbolSection, LoadBaseAddress
} from 'rpxlib';
import { u32, hex, abort } from './utils.js';
import { Patch } from './hooks.js';

export function patchRPX(sourceRPX: RPL, destRPX: RPL, patches: Patch[], brand: string, addrs: { syms: u32, text: u32, data: u32 }) {
    interface SectionMap {
        text: Section, rodata: Section, data: Section, bss: NoBitsSection,
        symtab: SymbolSection, strtab: StringSection,
        relatext: RelocationSection,
        relarodata: RelocationSection,
        reladata: RelocationSection
    }

    const rpxSections = {} as SectionMap;
    for (const section of destRPX.sections) {
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
    const sourceRPXSections = {} as Partial<SectionMap> & { text: Section };
    for (const section of sourceRPX.sections) {
        switch (section.name) {
            case '.text': sourceRPXSections.text = section; break;
            case '.rodata': sourceRPXSections.rodata = section; break;
            case '.data': sourceRPXSections.data = section; break;
            case '.bss': sourceRPXSections.bss = section as NoBitsSection; break;
            case '.symtab': sourceRPXSections.symtab = section as SymbolSection; break;
            case '.strtab': sourceRPXSections.strtab = section as StringSection; break;
            case '.rela.text': sourceRPXSections.relatext = section as RelocationSection; break;
            case '.rela.rodata': sourceRPXSections.relarodata = section as RelocationSection; break;
            case '.rela.data': sourceRPXSections.reladata = section as RelocationSection; break;
        }
    }

    sourceRPXSections.text.nameOffset = destRPX.shstrSection.strings.add(`.text.${brand}`);
    sourceRPXSections.text.flags = rpxSections.text.flags;
    destRPX.pushSection(sourceRPXSections.text);

    if (sourceRPXSections.rodata) {
        sourceRPXSections.rodata.nameOffset = destRPX.shstrSection.strings.add(`.rodata.${brand}`);
        sourceRPXSections.rodata.flags = rpxSections.rodata.flags;
        destRPX.pushSection(sourceRPXSections.rodata);
    }
    if (sourceRPXSections.data) {
        sourceRPXSections.data.nameOffset = destRPX.shstrSection.strings.add(`.data.${brand}`);
        sourceRPXSections.data.flags = rpxSections.data.flags;
        destRPX.pushSection(sourceRPXSections.data);
    }
    if (sourceRPXSections.bss) {
        sourceRPXSections.bss.nameOffset = destRPX.shstrSection.strings.add(`.bss.${brand}`);
        sourceRPXSections.bss.flags = rpxSections.bss.flags;
        destRPX.pushSection(sourceRPXSections.bss);
    }
    if (sourceRPXSections.relatext) {
        sourceRPXSections.relatext.nameOffset = destRPX.shstrSection.strings.add(`.rela.text.${brand}`);
        sourceRPXSections.relatext.flags = rpxSections.relatext.flags;
        destRPX.pushSection(sourceRPXSections.relatext);
    }
    if (sourceRPXSections.relarodata) {
        sourceRPXSections.relarodata.nameOffset = destRPX.shstrSection.strings.add(`.rela.rodata.${brand}`);
        sourceRPXSections.relarodata.flags = rpxSections.relarodata.flags;
        destRPX.pushSection(sourceRPXSections.relarodata);
    }
    if (sourceRPXSections.reladata) {
        sourceRPXSections.reladata.nameOffset = destRPX.shstrSection.strings.add(`.rela.data.${brand}`);
        sourceRPXSections.reladata.flags = rpxSections.reladata.flags;
        destRPX.pushSection(sourceRPXSections.reladata);
    }
    if (sourceRPXSections.symtab) {
        sourceRPXSections.symtab.nameOffset = destRPX.shstrSection.strings.add(`.symtab.${brand}`);
        sourceRPXSections.symtab.flags = rpxSections.symtab.flags;
        sourceRPXSections.symtab.addr = Util.roundUp(addrs.syms, +sourceRPXSections.symtab.addrAlign);
        destRPX.pushSection(sourceRPXSections.symtab);
    }
    if (sourceRPXSections.strtab) {
        sourceRPXSections.strtab.nameOffset = destRPX.shstrSection.strings.add(`.strtab.${brand}`);
        sourceRPXSections.strtab.flags = rpxSections.strtab.flags;
        sourceRPXSections.strtab.addr = Util.roundUp(
            addrs.syms + (sourceRPXSections.symtab ? +sourceRPXSections.symtab.size : 0),
            +sourceRPXSections.strtab.addrAlign
        );
        destRPX.pushSection(sourceRPXSections.strtab);
    }
    if (sourceRPXSections.symtab && sourceRPXSections.strtab) {
        sourceRPXSections.symtab.link = sourceRPXSections.strtab.index;
    }
    destRPX.crcSection.nameOffset = destRPX.shstrSection.strings.add(`.rplcrcs`);
    destRPX.fileinfoSection.nameOffset = destRPX.shstrSection.strings.add(`.rplfileinfo`);

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
                console.error(
                    `Patch of data "${data}" at address 0x${
                        hex(address)
                    } is within the data sections bounds but outside all known patchable data sections (.data & .rodata)`
                );
                continue;
            }
        } else {
            console.error(`Patch of data "${data}" at address 0x${hex(address)} is out of bounds.`);
            continue;
        }

        const dataBytes = Buffer.from(data, 'hex');
        if (dataBytes.byteLength !== data.length / 2) {
            console.error(`Data of patch at address 0x${hex(address)} of section ${targetSection.name} is malformed: "${data}"`);
            continue;
        }
        if (dataBytes.byteLength % 2) {
            console.error(`Data of patch at address 0x${hex(address)} of section ${targetSection.name} is not 2-byte aligned: ${data}`);
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
            //if (process.env.TACHYON_DEBUG) console.debug(
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

    destRPX.shstrSection.addr = destRPX.addressRanges.free.find(([start]) => start >= LoadBaseAddress)![0];
    destRPX.fileinfoSection.adjustFileInfoSizes();
    // CEMU subtracts 0x90 from this value for some random reason (?)
    (<number>destRPX.fileinfoSection.fileinfo.loadSize) += 0x90;
}
