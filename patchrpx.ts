import {
    RPL, Util, Section, NoBitsSection, RelocationSection, StringSection, SymbolSection, LoadBaseAddress
} from 'rpxlib';
import { u32, s32 } from './utils';
import { Patch } from './hooks';

export interface PatchFile {
    patches: Patch[],
    addrs: {
        syms: u32,
        text: u32,
        data: u32
    }
}

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
        const data: string = patch.data;

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
                console.warn(
                    `Patch of data "${data}" at address 0x${
                        address.toString(16).toUpperCase().padStart(8, '0')
                    } is within the data sections bounds but outside all known patchable data sections (.data & .rodata)`
                );
                continue;
            }
        } else {
            console.warn(`Patch of data "${data}" at address 0x${address.toString(16).toUpperCase().padStart(8, '0')} is out of bounds.`);
            continue;
        }

        const relocSize = +targetRelocSection.entSize;
        const relocData = targetRelocSection.data;
        let offsets: number[] = [];
        let low: s32 = 0;
        let high: s32 = relocData.byteLength / (<number>targetRelocSection.entSize) - 1;
        while (low <= high) {
            const mid: s32 = ~~((low + high) / 2);
            const at: number = mid * relocSize;
            const val: u32 = (relocData[at] << 24 | relocData[at+1] << 16 | relocData[at+2] << 8 | relocData[at+3]) >>> 0;
            if (val < address) low = mid + 1;
            else if (val > address + 4) high = mid - 1;
            else {
                offsets.push(mid * relocSize);
                break;
            }
        }
        let start = 0;
        const sink = new Util.ArrayBufferSink();
        sink.start({ asUint8Array: true });
        for (const offset of offsets.sort((a, b) => a - b)) {
            sink.write(relocData.subarray(start, offset));
            start = offset + 12;
        }
        sink.write(relocData.subarray(start));
        targetRelocSection.data = sink.end() as Uint8Array;

        if (data.length % 2) {
            console.error(`Data of patch at ${address} of section ${targetSection.name} is not byte aligned: ${data}`);
            process.exit();
        }

        const dataBytes = Buffer.from(data, 'hex');
        for (let i = 0; i < dataBytes.byteLength; i++) {
            targetSection.data![(address - <number>targetSection.addr) + i] = dataBytes[i];
        }
    }

    destRPX.shstrSection.addr = destRPX.addressRanges.free.find(([start]) => start >= LoadBaseAddress)![0];
    destRPX.fileinfoSection.adjustFileInfoSizes();
    // CEMU subtracts 0x90 from this value for some random reason (?)
    (<number>destRPX.fileinfoSection.fileinfo.loadSize) += 0x90;
}
