import fs from 'fs';
import path from 'path';
import syslib from './syslib';
import { SymbolMap } from './symbolmap';
import { Project } from './project';
import { UnixPath, ResolveDrive, WindowsPath, hex, abort } from './utils';
import { RPL, Util, WSLSafePath } from 'rpxlib';
import { patchRPX } from './patchrpx';
import { Patch } from './hooks';

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

if (!region) abort('No region specified! The --region option is required.');
if (!vanillaRpxPath) abort(`No RPX provided! The --rpx option is required.`);
if (!projectPath) {
    console.warn(`--project option not provided! Assuming current folder as project folder: ${cwd}`);
    projectPath = cwd;
}
if (!ghsPath) {
    if (process.env.GHS_ROOT) {
        if (process.env.GHS_ROOT.endsWith('/') || process.env.GHS_ROOT.endsWith('\\')) process.env.GHS_ROOT = process.env.GHS_ROOT.slice(0, -1);
        console.warn(`--ghs option not provided! Using path found in GHS_ROOT environment variable: ${process.env.GHS_ROOT}`);
        ghsPath = WSLSafePath(process.env.GHS_ROOT);
    } else {
        const defaultGhsPath = WSLSafePath('C:/ghs/multi5327');
        console.warn(`--ghs option not provided! Searching for GHS on its default install location: ${WindowsPath(defaultGhsPath)}`);
        ghsPath = defaultGhsPath;
    }
}
if (
    !vanillaRpxPath.endsWith('.rpx') && !vanillaRpxPath.endsWith('.elf')
) abort('The given RPX path is invalid. File must have extension .rpx or .elf');
if (outpath) {
    if (path.extname(outpath)) abort('Output path may not contain the file extension, only the name.');
    outpath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(outpath))));
}
vanillaRpxPath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(vanillaRpxPath))));
projectPath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(projectPath))));
ghsPath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(ghsPath))));

if (!fs.existsSync(vanillaRpxPath))                                   abort('Path to vanilla RPX does not exist!');
if (!fs.existsSync(projectPath))                                      abort('Project path folder does not exist!');
if (!fs.existsSync(path.join(projectPath, 'project.yaml')))           abort('Project folder does not have a project.yaml!');
if (!fs.existsSync(path.join(projectPath, 'syms')))                   abort('Project folder does not have a "syms" folder!');
if (!fs.existsSync(path.join(projectPath, 'syms', 'main.map')))       abort('Project symbols folder does not have a main.map file!');
if (!fs.existsSync(path.join(projectPath, 'conv')))                   abort('Project folder does not have a "conv" folder!');
if (!fs.existsSync(path.join(projectPath, 'conv', `${region}.yaml`))) abort(`Conversion map for region ${region} not found!`);
if (!fs.existsSync(path.join(projectPath, 'linker')))                 fs.mkdirSync(path.join(projectPath, 'linker'));

const timer = performance.now();

//*--------------------
//* Step 1: Parse project
//*--------------------
console.info('Parsing project...');
symbolMap = new SymbolMap(projectPath, region);

const project = new Project(projectPath, ghsPath);
project.defines.push('DATA_ADDR=0x' + hex(symbolMap.converter.data));
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
if (!gbuild.isExecuted || gbuild.exitCode || gbuild.stderr) abort('gbuild command failed!');

for (const asmfile of project.asmFiles) {
    console.info('Assembling', asmfile);

    const asppcCommand = [
        path.join(project.ghsPath, 'asppc.exe'), `-I${WindowsPath(path.join(projectPath, 'include'))}/`, '-o',
        `${WindowsPath(path.join(objsPath, path.basename(asmfile)))}.o`, WindowsPath(path.join(projectPath, 'source', asmfile))
    ];
    const asppc = syslib.exec(asppcCommand, { cwd: projectPath, stdout: 'inherit', stderr: 'inherit' });
    if (!asppc.isExecuted || asppc.exitCode || asppc.stderr) abort('asppc command failed!');
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

const oFileData = fs.readFileSync(`${path.join(projectPath, project.name)}.o`);
oFile = new RPL(oFileData);
const rpxData = fs.readFileSync(vanillaRpxPath);
const rpx = new RPL(rpxData);
const patches: Patch[] = project.patches();

patchRPX(oFile, rpx, patches, brand, symbolMap.converter);

//*--------------------
//* Step 5: Save RPX
//*--------------------
console.info('Saving RPX...');

const defaultSavePath = vanillaRpxPath.split('.').slice(0, -1).join('.');
const savePath = outpath ? path.join(outpath, path.basename(defaultSavePath)) : defaultSavePath;
const savedTo = rpx.save(`${savePath}.${brand}`, prod);
console.info(`Saved RPX to: ${savedTo}`);

if (prod) {
    console.info('[PROD] Generating patch file...');
    const encoder = new TextEncoder();
    const magic = new Uint8Array([0xC5, 0xFC, 0x50, 0x46]); // CSFC PF
    const brandData = encoder.encode(brand);
    const patchesData = encoder.encode(JSON.stringify(patches));
    const values = Buffer.allocUnsafe(28);
    values.writeUint32BE(symbolMap.converter.syms,              0); // 0x4
    values.writeUint32BE(symbolMap.converter.text,              4); // 0x8
    values.writeUint32BE(symbolMap.converter.data,              8); // 0xC
    values.writeUint32BE(patchesData.byteLength,               12); // 0x10
    values.writeUint32BE(brandData.byteLength,                 16); // 0x14
    values.writeUint32BE(Util.crc32(rpxData),                  20); // 0x18
    values.writeUint32BE(Util.crc32(fs.readFileSync(savedTo)), 24); // 0x1C

    const patchFileData = Bun.deflateSync(Buffer.concat([
        magic,       // 0x0: u32
        values,      // 0x4: u32, 0x8: u32, 0xC: u32, 0x10: u32, 0x14: u32, 0x18: u32, 0x1C: u32
        patchesData, // 0x20: char[]
        brandData,   // 0x20 + (value at 0x10): char[]
        oFileData    // 0x20 + (value at 0x10) + (value at 0x14): u8[]
    ]), { windowBits: -15, memLevel: 9, level: 9 });

    const patchFilePath = path.join(outpath || path.dirname(vanillaRpxPath), `${project.name}-${region}.typf`);
    fs.writeFileSync(patchFilePath, patchFileData);
    console.info('[PROD] Saved patch file to:', patchFilePath);
}

console.info(`Finished. Build took ${(performance.now() - timer).toFixed(3)}ms.`);
