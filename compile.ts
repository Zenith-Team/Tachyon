import fs from 'fs';
import path from 'path';
import syslib from './syslib';
import { SymbolMap } from './symbolmap';
import { Project } from './project';
import { UnixPath, ResolveDrive, u32, s32, WindowsPath } from './utils';
import {
    RPL, WSLSafePath, Util, Section, NoBitsSection, RelocationSection, StringSection, SymbolSection
} from 'rpxlib';

export let oFile: RPL;
export let symbolMap: SymbolMap;

const cwd = process.cwd();
const args = process.argv.slice(2);
let vanillaRpxPath: string = '';
let projectPath: string = '';
let ghsPath: string = '';
let region: string = '';
let outpath: string = '';
let brand: string = 'custom';
let prod: boolean = false;

args.forEach((arg, i) => {
    if      (arg === '--rpx'     || arg === '-r') vanillaRpxPath = args[i + 1];
    else if (arg === '--project' || arg === '-p') projectPath    = args[i + 1];
    else if (arg === '--ghs'     || arg === '-g') ghsPath        = args[i + 1];
    else if (arg === '--region'  || arg === '-R') region         = args[i + 1];
    else if (arg === '--out'     || arg === '-o') outpath        = args[i + 1];
    else if (arg === '--brand'   || arg === '-b') brand          = args[i + 1];
    else if (arg === '--prod'    || arg === '-P') prod           = true;
});

if (!vanillaRpxPath) {
    console.warn(`--rpx option not provided! Searching for vanilla RPX on current folder: ${cwd}/red-pro2.rpx`);
    vanillaRpxPath = './red-pro2.rpx';
}
if (!projectPath) {
    console.warn(`--project option not provided! Assuming current folder as project folder: ${cwd}`);
    projectPath = cwd;
}
if (!ghsPath) {
    const defaultGhsPath = WSLSafePath('C:/ghs/multi5327');
    console.warn(`--ghs option not provided! Searching for GHS on its default install location: ${defaultGhsPath}`);
    ghsPath = defaultGhsPath;
}
if (!region) {
    console.warn('--region option not provided! Defaulting to USv130.');
    region = 'USv130';
}
if (!vanillaRpxPath.endsWith('.rpx') && !vanillaRpxPath.endsWith('.elf')) {
    console.error('The given RPX path is invalid. File must have extension .rpx or .elf');
    process.exit();
}
if (outpath) {
    if (path.extname(outpath)) {
        console.error('Output path may not contain the file extension, only the name.');
        process.exit()
    }
    outpath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(outpath))));
}
vanillaRpxPath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(vanillaRpxPath))));
projectPath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(projectPath))));
ghsPath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(ghsPath))));

if (!fs.existsSync(vanillaRpxPath)) {
    console.error('Could not locate vanilla RPX!');
    process.exit();
}
if (!fs.existsSync(projectPath)) {
    console.error('Project path folder does not exist!');
    process.exit();
}
if (!fs.existsSync(path.join(projectPath, 'project.yaml'))) {
    console.error('Project folder does not have a project.yaml!');
    process.exit();
}
if (!fs.existsSync(path.join(projectPath, 'syms'))) {
    console.error('Project folder does not have a "syms" folder!');
    process.exit();
}
if (!fs.existsSync(path.join(projectPath, 'syms', 'main.map'))) {
    console.error('Project symbols folder does not have a main.map file!');
    process.exit();
}
if (!fs.existsSync(path.join(projectPath, 'conv'))) {
    console.error('Project folder does not have a "conv" folder!');
    process.exit();
}
if (!fs.existsSync(path.join(projectPath, 'conv', `${region}.yaml`))) {
    console.error(`Conversion map for region ${region} not found!`);
    process.exit();
}
if (!fs.existsSync(path.join(projectPath, 'linker'))) {
    fs.mkdirSync(path.join(projectPath, 'linker'));
}

const timer = performance.now();

//*--------------------
//* Step 1: Parse project
//*--------------------
console.info('Parsing project...');
symbolMap = new SymbolMap(projectPath, region);

const project = new Project(projectPath, ghsPath);
project.defines.push('DATA_ADDR=0x' + symbolMap.converter.data.toString(16).toUpperCase().padStart(8, '0'));
project.createGPJ();

//*--------------------
//* Step 2: Compile
//*--------------------
console.info('Compiling...');

const objsPath = path.join(projectPath, 'objs');
if (!fs.existsSync(objsPath)) fs.mkdirSync(objsPath);

const gbuildCommand = [
    path.join(project.ghsPath, 'gbuild.exe'), '-top', path.join(projectPath, 'project.gpj')
];
const gbuild = syslib.exec(gbuildCommand, { cwd: projectPath, stdout: 'inherit', stderr: 'inherit' });
if (!gbuild.isExecuted || gbuild.exitCode || gbuild.stderr) {
    console.error('gbuild command failed!');
    process.exit();
}

for (const asmfile of project.asmFiles) {
    console.info('Assembling', asmfile);

    const asppcCommand = [
        path.join(project.ghsPath, 'asppc.exe'), `-I${WindowsPath(path.join(projectPath, 'include'))}/`, '-o',
        `${WindowsPath(path.join(objsPath, path.basename(asmfile)))}.o`, WindowsPath(path.join(projectPath, 'source', asmfile))
    ];
    const asppc = syslib.exec(asppcCommand, { cwd: projectPath, stdout: 'inherit', stderr: 'inherit' });
    if (!asppc.isExecuted || asppc.exitCode || asppc.stderr) {
        console.error('asppc command failed!');
        process.exit();
    }
}

//*--------------------
//* Step 3: Link
//*--------------------
console.info('Linking...');
project.link(region, symbolMap);

//*--------------------
//* Step 4: Patch
//*--------------------
console.info('Applying patches...');

oFile = new RPL(fs.readFileSync(`${path.join(projectPath, project.name)}.o`));
const rpx = new RPL(fs.readFileSync(vanillaRpxPath));

interface SectionMap {
    text: Section, rodata: Section, data: Section, bss: NoBitsSection,
    symtab: SymbolSection, strtab: StringSection,
    relatext: RelocationSection,
    relarodata: RelocationSection,
    reladata: RelocationSection
}
const rpxSections = {} as SectionMap;
for (const section of rpx.sections) {
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
const oFileSections = {} as Partial<SectionMap> & { text: Section };
for (const section of oFile.sections) {
    switch (section.name) {
        case '.text': oFileSections.text = section; break;
        case '.rodata': oFileSections.rodata = section; break;
        case '.data': oFileSections.data = section; break;
        case '.bss': oFileSections.bss = section as NoBitsSection; break;
        case '.symtab': oFileSections.symtab = section as SymbolSection; break;
        case '.strtab': oFileSections.strtab = section as StringSection; break;
        case '.rela.text': oFileSections.relatext = section as RelocationSection; break;
        case '.rela.rodata': oFileSections.relarodata = section as RelocationSection; break;
        case '.rela.data': oFileSections.reladata = section as RelocationSection; break;
    }
}

const patches = project.patches();

oFileSections.text.nameOffset = rpx.shstrSection.strings.add(`.text.${brand}`);
oFileSections.text.flags = rpxSections.text.flags;
rpx.pushSection(oFileSections.text);

if (oFileSections.rodata) {
    oFileSections.rodata.nameOffset = rpx.shstrSection.strings.add(`.rodata.${brand}`);
    oFileSections.rodata.flags = rpxSections.rodata.flags;
    rpx.pushSection(oFileSections.rodata);
}
if (oFileSections.data) {
    oFileSections.data.nameOffset = rpx.shstrSection.strings.add(`.data.${brand}`);
    oFileSections.data.flags = rpxSections.data.flags;
    rpx.pushSection(oFileSections.data);
}
if (oFileSections.bss) {
    oFileSections.bss.nameOffset = rpx.shstrSection.strings.add(`.bss.${brand}`);
    oFileSections.bss.flags = rpxSections.bss.flags;
    rpx.pushSection(oFileSections.bss);
}
if (oFileSections.relatext) {
    oFileSections.relatext.nameOffset = rpx.shstrSection.strings.add(`.rela.text.${brand}`);
    oFileSections.relatext.flags = rpxSections.relatext.flags;
    rpx.pushSection(oFileSections.relatext);
}
if (oFileSections.relarodata) {
    oFileSections.relarodata.nameOffset = rpx.shstrSection.strings.add(`.rela.rodata.${brand}`);
    oFileSections.relarodata.flags = rpxSections.relarodata.flags;
    rpx.pushSection(oFileSections.relarodata);
}
if (oFileSections.reladata) {
    oFileSections.reladata.nameOffset = rpx.shstrSection.strings.add(`.rela.data.${brand}`);
    oFileSections.reladata.flags = rpxSections.reladata.flags;
    rpx.pushSection(oFileSections.reladata);
}
if (oFileSections.symtab) {
    oFileSections.symtab.nameOffset = rpx.shstrSection.strings.add(`.symtab.${brand}`);
    oFileSections.symtab.flags = rpxSections.symtab.flags;
    oFileSections.symtab.addr = Util.roundUp(symbolMap.converter.syms, +oFileSections.symtab.addrAlign);
    rpx.pushSection(oFileSections.symtab);
}
if (oFileSections.strtab) {
    oFileSections.strtab.nameOffset = rpx.shstrSection.strings.add(`.strtab.${brand}`);
    oFileSections.strtab.flags = rpxSections.strtab.flags;
    oFileSections.strtab.addr = Util.roundUp(
        symbolMap.converter.syms + (oFileSections.symtab ? +oFileSections.symtab.size : 0),
        +oFileSections.strtab.addrAlign
    );
    rpx.pushSection(oFileSections.strtab);
}
if (oFileSections.symtab && oFileSections.strtab) {
    oFileSections.symtab.link = oFileSections.strtab.index;
}
rpx.crcSection.nameOffset = rpx.shstrSection.strings.add(`.rplcrcs`);
rpx.fileinfoSection.nameOffset = rpx.shstrSection.strings.add(`.rplfileinfo`);

for (const patch of patches) {
    let targetSection: Section;
    let targetRelocSection: RelocationSection;

    const address: u32 = patch.address;
    const data: string = patch.data;

    if (rpxSections.text.addr <= address && address < symbolMap.converter.text) {
        targetSection = rpxSections.text;
        targetRelocSection = rpxSections.relatext;
    } else if (Math.min(+rpxSections.rodata.addr, +rpxSections.data.addr, +rpxSections.bss.addr) <= address && address < symbolMap.converter.data) {
        if (rpxSections.rodata.addr <= address && address < (<number>rpxSections.rodata.addr + <number>rpxSections.rodata.size)) {
            targetSection = rpxSections.rodata;
            targetRelocSection = rpxSections.relarodata;
        } else if (rpxSections.data.addr <= address && address < (<number>rpxSections.data.addr + <number>rpxSections.data.size)) {
            targetSection = rpxSections.data;
            targetRelocSection = rpxSections.reladata;
        } else {
            console.warn(`Address 0x${address.toString(16).toUpperCase().padStart(8, '0')} is out of range. (1)`);
            continue;
        }
    } else {
        console.warn(`Address 0x${address.toString(16).toUpperCase().padStart(8, '0')} is out of range. (2)`);
        continue;
    }

    function getUint32At(buf: Uint8Array, at: number): number {
        const v = buf[at] << 24 | buf[at+1] << 16 | buf[at+2] << 8 | buf[at+3];
        return v >>> 0;
    }

    const relocSize = +targetRelocSection.entSize;
    const relocData = targetRelocSection.data;
    let offsets: number[] = [];
    let low: s32 = 0;
    let high: s32 = relocData.byteLength / (<number>targetRelocSection.entSize) - 1;
    while (low <= high) {
        const mid: s32 = ~~((low + high) / 2);
        const val: u32 = getUint32At(relocData, mid * relocSize);
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

//*--------------------
//* Step 5: Save RPX
//*--------------------
console.info('Saving RPX...');
rpx.shstrSection.addr = rpx.addressRanges.free.find(([start]) => start >= 0xC0000000)![0];
rpx.fileinfoSection.adjustFileInfoSizes();
// CEMU subtracts 0x90 from this value for some random reason (?)
(<number>rpx.fileinfoSection.fileinfo.loadSize) += 0x90;

const defaultSavePath = vanillaRpxPath.split('.').slice(0, -1).join('.');
const savedTo = rpx.save(`${outpath || defaultSavePath}.${brand}`, prod);
console.info(`Saved RPX to: ${savedTo}`);
console.info(`Finished. Build took ${(performance.now() - timer).toFixed(3)}ms.`);
