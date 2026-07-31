import { type RPL, DataBaseAddress, LoadBaseAddress, RPLCrcSection, RPLFileInfoSection, SymbolSection, Version, ABI, ISA, type RelocationSection, RelocationType, SectionFlags, SectionType, Type, uint32, Util, RPLFileInfoFlags, } from 'rpxlib';
import { abort, hex } from '../utils.js';
export function convertToRPL(rpl: RPL, moduleName: string) {
    rpl.version = Version.Current;
    rpl.abi = ABI.CafeOS;
    rpl.abiVersion = 0xFE;
    rpl.type = Type.RPL;
    rpl.isa = ISA.PPC;
    rpl.isaVersion = 1;
    rpl.isaFlags = 0;
    for (const section of rpl.sections) {
        if (+section.addr >= DataBaseAddress && +section.addr < LoadBaseAddress) {
            const isWritable = (+section.flags & SectionFlags.Write) !== 0;
            if (!isWritable) {
                section.flags = new uint32(+section.flags | SectionFlags.Write);
            }
        }
    }
    validateRelocs(rpl);
    setSymStrTabAddresses(rpl);
    const crcs = new RPLCrcSection({
        addrAlign: 4,
        entSize: 4,
        info: 0,
        link: 0,
        addr: 0,
        flags: 0,
        nameOffset: rpl.shstrSection.strings.add('.rplcrcs'),
    }, rpl);
    const fileinfo = createFileInfoSection(rpl, moduleName);
    rpl.type = Type.None;
    rpl.pushSection(crcs);
    rpl.pushSection(fileinfo);
    rpl.type = Type.RPL;
}
function validateRelocs(rpl: RPL) {
    for (const sectionRaw of rpl.sections) {
        if (+sectionRaw.type !== SectionType.Rela)
            continue;
        const section = sectionRaw as RelocationSection;
        const linkedTargetSection = rpl.sections[+section.info];
        const linkedSymbolSection = rpl.sections[+section.link];
        if (!linkedTargetSection)
            throw new Error('(rplconv) Rela section missing info linked section');
        if (!linkedSymbolSection)
            throw new Error('(rplconv) Rela section missing link linked section');
        if (!(linkedSymbolSection instanceof SymbolSection))
            throw new Error('(rplconv) Rela section link is not a symbol section');
        section.flags = new uint32(0);
        let foundInvalidReloc = false;
        for (const reloc of section.relocations) {
            switch (+reloc.type) {
                case RelocationType.None:
                case RelocationType.PPCAddr32:
                case RelocationType.PPCAddr16Lo:
                case RelocationType.PPCAddr16Hi:
                case RelocationType.PPCAddr16Ha:
                case RelocationType.PPCRel24:
                case RelocationType.PPCRel14:
                case RelocationType.PPC_DTPMOD32:
                case RelocationType.PPC_DTPREL32: {
                    break;
                }
                default:
                    foundInvalidReloc = true;
                    console.error(`Unsupported "${RelocationType[+reloc.type] ?? `unknown_type_${+reloc.type}`}" relocation found at addr: ${hex(reloc.addr)}`);
            }
        }
        if (foundInvalidReloc)
            abort('The RPL cannot be created because the compiled ELF contains unsupported relocations, see errors above.\nIf you know this relocation type should be supported, please file a bug report: https://github.com/Zenith-Team/Tachyon/issues');
    }
}
function setSymStrTabAddresses(rpl: RPL) {
    let nextFreeLoadAddr: number = LoadBaseAddress;
    for (const section of rpl.sections) {
        if (+section.addr >= nextFreeLoadAddr)
            nextFreeLoadAddr = +section.addr + +section.size;
    }
    for (const section of rpl.sections) {
        const type = +section.type;
        if (type !== SectionType.SymTab && type !== SectionType.StrTab)
            continue;
        nextFreeLoadAddr = Util.roundUp(nextFreeLoadAddr, +section.addrAlign);
        section.addr = nextFreeLoadAddr;
        nextFreeLoadAddr += +section.size;
        section.flags = new uint32(+section.flags | SectionFlags.Alloc);
    }
}
function createFileInfoSection(rpl: RPL, moduleName: string): RPLFileInfoSection {
    const section = new RPLFileInfoSection({
        addrAlign: 4,
        entSize: 0,
        info: 0,
        link: 0,
        addr: 0,
        flags: 0,
        nameOffset: rpl.shstrSection.strings.add('.rplfileinfo'),
    }, rpl);
    section.fileinfo.loadAlign = 0x20;
    section.fileinfo.flags = RPLFileInfoFlags.None;
    section.strings.add(moduleName);
    section.adjustFileInfoSizes();
    return section;
}
