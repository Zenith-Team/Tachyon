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
import { abort, scanAssemlyFileDependencies } from './utils.js';

export let oFile: RPL;
export let symbolMap: SymbolMap;

const cwd = process.cwd();
const [target, ...args] = process.argv.slice(2);
if (!target || target[0] === '-') abort('No target specified! The target is a positional argument and must precede all options and flags.');

let projectPath: string | undefined;
let metaFolderName: string | undefined;
let ghsPath: string | undefined;
let outpath: string | undefined;
let prod: boolean = false;

args.forEach((arg, i) => {
    if      (arg === '--project' || arg === '-p') projectPath    = args[i + 1];
    else if (arg === '--meta'    || arg === '-m') metaFolderName = args[i + 1];
    else if (arg === '--ghs'     || arg === '-g') ghsPath        = args[i + 1];
    else if (arg === '--out'     || arg === '-o') outpath        = args[i + 1];
    else if (arg === '--prod'    || arg === '-P') prod           = true;
});
if (!projectPath) {
    console.warn(`--project option not provided! Assuming current folder as project folder: ${cwd}`);
    projectPath = cwd;
}
if (!metaFolderName) metaFolderName = 'project';
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
if (outpath) {
    if (path.extname(outpath)) abort('Output path may not contain the file extension, only the name.');
    outpath = path.resolve(cwd, outpath);
}
projectPath = path.resolve(cwd, projectPath);
ghsPath = path.resolve(cwd, ghsPath);
const metaPath = path.join(projectPath, metaFolderName);

if (!fs.existsSync(projectPath))                             abort('Project path folder does not exist!');
if (!fs.existsSync(metaPath))                                abort(`Project meta folder not found: ${metaPath}`);
if (!fs.existsSync(path.join(metaPath, 'project.yaml')))     abort('Project meta folder does not have a project.yaml!');
if (!fs.existsSync(path.join(metaPath, 'syms')))             abort('Project meta folder does not have a "syms" folder!');
if (!fs.existsSync(path.join(metaPath, 'syms', 'main.map'))) abort('Project symbols folder does not have a main.map file!');
if (!fs.existsSync(path.join(metaPath, 'conv')))             abort('Project meta folder does not have a "conv" folder!');
if (!fs.existsSync(path.join(metaPath, 'linker')))           fs.mkdirSync(path.join(metaPath, 'linker'));

const timer = performance.now();

//*--------------------
//* Step 1: Parse project
//*--------------------
console.info('Parsing project...');
const project = new Project(projectPath, metaPath, ghsPath, target);
const baseRpxPath = path.join(project.rpxDir, `${project.targetBaseRpx}.rpx`);

if (!fs.existsSync(project.rpxDir)) abort(`RPX folder ${project.rpxDir} does not exist!`);
if (!fs.existsSync(baseRpxPath)) abort(`Base RPX ${project.targetBaseRpx}.rpx for target ${target} does not exist!`);
if (!fs.existsSync(project.includeDir)) abort(`Include folder ${project.includeDir} does not exist!`);
if (!fs.existsSync(project.sourceDir)) abort(`Source folder ${project.sourceDir} does not exist!`);
if (!fs.existsSync(project.modulesDir)) abort(`Modules folder ${project.modulesDir} does not exist!`);

const rpxData = fs.readFileSync(baseRpxPath);
const rpx = new RPL(rpxData, { parseRelocs: true });

symbolMap = new SymbolMap(metaPath, project.targetAddrMap, rpx.sections);

project.createGPJ();

//*--------------------
//* Step 2: Compile
//*--------------------
console.info('Compiling...');

const objsPath = path.join(metaPath, 'objs');
if (!fs.existsSync(objsPath)) fs.mkdirSync(objsPath);

const gbuildCommand = path.join(project.ghsPath, 'gbuild.exe');
const gbuildArgs = [
    '-top', path.join(metaPath, 'project.gpj')
];
const gbuild = spawnSync(gbuildCommand, gbuildArgs, { cwd: projectPath, stdio: 'inherit' });
if (gbuild.error || gbuild.signal || gbuild.stderr || gbuild.status !== 0) abort('gbuild command failed!');

const asppcCommand = path.join(project.ghsPath, 'asppc.exe');
const asppcIncludeDir = project.includeDir;
const asmCachePath = path.join(objsPath, '.asm.cache');
const asmCache = fs.existsSync(asmCachePath) ? <Record<string, number>>JSON.parse(fs.readFileSync(asmCachePath, 'utf8')) : {};
const depCache: Record<string, number> = {};

for (const asmfile of project.asmFiles) {
    const asmfilePath = path.join(project.sourceDir, asmfile);
    const asmfileMtime = fs.statSync(asmfilePath).mtimeMs;
    const deps = scanAssemlyFileDependencies(asmfilePath, asppcIncludeDir);
    let modifiedDep: string = '';

    if (deps) for (const dep of deps) depCache[dep] = fs.statSync(dep).mtimeMs;

    if (asmfileMtime === asmCache[asmfilePath]) {
        if (!deps || deps.every(dep => (modifiedDep = dep, asmCache[dep] === depCache[dep]))) {
            continue;
        }
    }
    asmCache[asmfilePath] = asmfileMtime;

    console.info(
        'Assembling', asmfile,
        modifiedDep ? `because ${path.relative(project.sourceDir, modifiedDep)} has changed` : ''
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
project.link(symbolMap);

//*--------------------
//* Step 4: Patch
//*--------------------
console.info('Applying patches...');

const oFileData = fs.readFileSync(`${path.join(metaPath, project.name)}.o`);
oFile = new RPL(oFileData);
const patches: Patch[] = project.patches();

patchRPX(oFile, rpx, patches, project.name, symbolMap.converter);

//*--------------------
//* Step 5: Save RPX
//*--------------------
console.info('Saving RPX...');

const defaultSavePath = path.join(project.rpxDir, `${project.name}.${target}`);
const savedTo = rpx.save(outpath ?? defaultSavePath, prod);
console.info(`Saved RPX to: ${savedTo}`);

//*--------------------
//* Step 5.5: Generate PROD files
//*--------------------

if (prod) {
    console.info('[PROD] Generating patch file...');
    const encoder = new TextEncoder();
    const magic = new Uint8Array([0xC5, 0xFC, 0x50, 0x46]); // "CSFC" PF (Patch File)
    const projNameData = encoder.encode(project.name);
    const patchesData = encoder.encode(JSON.stringify(patches));
    const values = Buffer.allocUnsafe(28);
    values.writeUint32BE(symbolMap.converter.syms,             0); // 0x4
    values.writeUint32BE(symbolMap.converter.text,             4); // 0x8
    values.writeUint32BE(symbolMap.converter.data,             8); // 0xC
    values.writeUint32BE(patchesData.byteLength,              12); // 0x10
    values.writeUint32BE(projNameData.byteLength,             16); // 0x14
    values.writeUint32BE(crc.crc32(rpxData),                  20); // 0x18
    values.writeUint32BE(crc.crc32(fs.readFileSync(savedTo)), 24); // 0x1C

    const patchFileData = zlib.deflateSync(Buffer.concat([
        magic,        // 0x0: u32
        values,       // 0x4: u32, 0x8: u32, 0xC: u32, 0x10: u32, 0x14: u32, 0x18: u32, 0x1C: u32
        patchesData,  // 0x20: char[]
        projNameData, // 0x20 + (value at 0x10): char[]
        oFileData     // 0x20 + (value at 0x10) + (value at 0x14): u8[]
    ]), { memLevel: 9, level: 9 });

    const patchFilePath = path.join(path.dirname(savedTo), `${project.name}.${target}.typf`);
    fs.writeFileSync(patchFilePath, patchFileData);
    console.info('[PROD] Saved patch file to:', patchFilePath);
}

console.info(`Finished. Build took ${(performance.now() - timer).toFixed(3)}ms.`);
