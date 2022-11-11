import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crc from '@foxglove/crc';
import { Patch } from './hooks.js';
import { Project } from './project.js';
import { spawnSync } from 'child_process';
import { RPL } from 'rpxlib';
import { patchRPX } from './patchrpx.js';
import { SymbolMap } from './symbolmap.js';
import { hex, abort, scanAssemlyFileDependencies } from './utils.js';

export let oFile: RPL;
export let symbolMap: SymbolMap;

const cwd = process.cwd();
const args = process.argv.slice(2);
let vanillaRpxPath: string | undefined;
let projectPath: string | undefined;
let ghsPath: string | undefined;
let region: string | undefined;
let outpath: string | undefined;
let brand: string = 'custom';
let prod: boolean = false;

args.forEach((arg, i) => {
    if      (arg === '--rpx'     || arg === '-r') vanillaRpxPath = args[i + 1];
    else if (arg === '--project' || arg === '-p') projectPath    = args[i + 1];
    else if (arg === '--ghs'     || arg === '-g') ghsPath        = args[i + 1];
    else if (arg === '--region'  || arg === '-R') region         = args[i + 1];
    else if (arg === '--out'     || arg === '-o') outpath        = args[i + 1];
    else if (arg === '--brand'   || arg === '-b') brand          = args[i + 1] ?? 'custom';
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
        ghsPath = process.env.GHS_ROOT;
    } else {
        const defaultGhsPath = 'C:/ghs/multi5327';
        console.warn(`--ghs option not provided! Searching for GHS on its default install location: ${defaultGhsPath}`);
        ghsPath = defaultGhsPath;
    }
}
if (
    !vanillaRpxPath.endsWith('.rpx') && !vanillaRpxPath.endsWith('.elf')
) abort('The given RPX path is invalid. File must have extension .rpx or .elf');
if (outpath) {
    if (path.extname(outpath)) abort('Output path may not contain the file extension, only the name.');
    outpath = path.resolve(cwd, outpath);
}
vanillaRpxPath = path.resolve(cwd, vanillaRpxPath);
projectPath = path.resolve(cwd, projectPath);
ghsPath = path.resolve(cwd, ghsPath);

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

const gbuildCommand = path.join(project.ghsPath, 'gbuild.exe');
const gbuildArgs = [
    '-top', path.join(projectPath, 'project.gpj')
];
const gbuild = spawnSync(gbuildCommand, gbuildArgs, { cwd: projectPath, stdio: 'inherit' });
if (gbuild.error || gbuild.signal || gbuild.stderr || gbuild.status !== 0) abort('gbuild command failed!');

const asppcCommand = path.join(project.ghsPath, 'asppc.exe');
const asppcIncludeDir = path.join(projectPath, 'include');
const asmCachePath = path.join(objsPath, '.asm.cache');
const asmCache: Record<string, number> = fs.existsSync(asmCachePath) ? JSON.parse(fs.readFileSync(asmCachePath, 'utf8')) : {};
const depCache: Record<string, number> = {};

for (const asmfile of project.asmFiles) {
    const asmfilePath = path.join(projectPath, 'source', asmfile);
    const asmfileMtime = fs.statSync(asmfilePath).mtimeMs;
    const deps = scanAssemlyFileDependencies(asmfilePath, asppcIncludeDir);
    let modifiedDep: string = '';

    if (deps) for (const dep of deps) depCache[dep] = fs.statSync(dep).mtimeMs;

    if (asmfileMtime === asmCache[asmfilePath]) {
        if (!deps || deps.every(dep => (modifiedDep = dep, asmCache[dep] === depCache[dep]))) {
            if (process.env.TACHYON_DEBUG) console.debug(`Skipping assembly of ${asmfile} (no changes)`);
            continue;
        }
    }
    asmCache[asmfilePath] = asmfileMtime;

    console.info(
        'Assembling', asmfile,
        modifiedDep ? `because ${path.relative(path.join(projectPath, 'source'), modifiedDep)} has changed` : ''
    );
    const asppcArgs = [
        `-I${asppcIncludeDir}/`, '-o',
        `${path.join(objsPath, path.basename(asmfile))}.o`, asmfilePath
    ];
    const asppc = spawnSync(asppcCommand, asppcArgs, { cwd: projectPath, stdio: 'inherit' });
    if (asppc.error || asppc.signal || asppc.stderr || asppc.status !== 0) abort('asppc command failed!');
}
fs.writeFileSync(asmCachePath, JSON.stringify(Object.assign(asmCache, depCache)));

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
const rpx = new RPL(rpxData, { parseRelocs: true });
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
    values.writeUint32BE(crc.crc32(rpxData),                  20); // 0x18
    values.writeUint32BE(crc.crc32(fs.readFileSync(savedTo)), 24); // 0x1C

    const patchFileData = zlib.deflateSync(Buffer.concat([
        magic,       // 0x0: u32
        values,      // 0x4: u32, 0x8: u32, 0xC: u32, 0x10: u32, 0x14: u32, 0x18: u32, 0x1C: u32
        patchesData, // 0x20: char[]
        brandData,   // 0x20 + (value at 0x10): char[]
        oFileData    // 0x20 + (value at 0x10) + (value at 0x14): u8[]
    ]), { memLevel: 9, level: 9 });

    const patchFilePath = path.join(outpath || path.dirname(vanillaRpxPath), `${project.name}-${region}.typf`);
    fs.writeFileSync(patchFilePath, patchFileData);
    console.info('[PROD] Saved patch file to:', patchFilePath);
}

console.info(`Finished. Build took ${(performance.now() - timer).toFixed(3)}ms.`);
