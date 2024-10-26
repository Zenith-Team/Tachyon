import $ from 'chalk';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';
import zlib from 'zlib';
import crc from '@foxglove/crc';
import { Patch } from './hooks.js';
import { Project } from './project.js';
import { spawnSync } from 'child_process';
import { RPL } from 'rpxlib';
import { patchRPX } from './patchrpx.js';
import { SymbolMap } from './symbolmap.js';
import { generateCafeloaderFiles } from './cafeloader.js';
import { abort, scanAssemlyFileDependencies } from './utils.js';

export let oFile: RPL;
export let symbolMap: SymbolMap;
const cwd = process.cwd();

const {
    positionals: targets, values: {
        project: projectDirRaw,
        threads: threadsRaw,
        ghs: ghsPathRaw,
        out: outPathRaw,
        aflag, cflag, bflag, lflag,
        rpx: produceRPXFlag,
        typf: produceTYPF,
        console: consoleFlag,
        'no-cache': noCache
    }
} = util.parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: {
        project:    { type: 'string',  short: 'p', default: cwd },
        threads:    { type: 'string',  short: 'T', default: '2' },
        ghs:        { type: 'string',  short: 'g', default: process.env.GHS_ROOT ?? 'C:/ghs/multi5327' },
        out:        { type: 'string',  short: 'o' },
        aflag:      { type: 'string',  short: 'A', multiple: true },
        cflag:      { type: 'string',  short: 'C', multiple: true },
        bflag:      { type: 'string',  short: 'B', multiple: true },
        lflag:      { type: 'string',  short: 'L', multiple: true },
        rpx:        { type: 'boolean', default: false, short: 'r' },
        typf:       { type: 'boolean', default: false, short: 't' },
        console:    { type: 'string',  default: 'none' },
        'no-cache': { type: 'boolean', default: false },
    }
});
if (targets.length === 0) abort('No targets specified.');
if (targets.length > 1) abort('Multiple targets are not yet supported.');
const target = targets[0]!;
const extraAssemblerFlagsCLI = aflag ?? [];
const extraCompilerFlagsCLI = cflag ?? [];
const extraBuilderFlagsCLI = bflag ?? [];
const extraLinkerFlagsCLI = lflag ?? [];

const threads = Number(threadsRaw);
if (!Number.isSafeInteger(threads) || threads <= 0) abort('Invalid number of threads.');
if (threads > os.cpus().length) abort(`Number of threads exceeds number of available CPU cores (${os.cpus().length}).`);

const outPath = outPathRaw ? (
    ['.rpx', '.rpl', '.elf'].includes(path.extname(outPathRaw).toLowerCase()) ?
        abort('Output path may not contain the file extension, only the name.') : path.resolve(cwd, outPathRaw)
) : null;
const projectDir = path.resolve(cwd, projectDirRaw!);
const ghsPath = path.resolve(cwd, ghsPathRaw!);

if (!fs.existsSync(projectDir))                                abort('Project folder does not exist!');
if (!fs.existsSync(path.join(projectDir, 'project.yaml')))     abort('Project folder does not have a project.yaml!');
if (!fs.existsSync(path.join(projectDir, 'conv')))             abort('Project folder does not have a "conv" folder!');
if (!fs.existsSync(path.join(projectDir, 'maps')))             abort('Project folder does not have a "maps" folder!');
if (!fs.existsSync(path.join(projectDir, 'maps', 'main.map'))) abort('Project maps folder does not have a main.map file!');
if (!fs.existsSync(path.join(projectDir, 'linker')))           fs.mkdirSync(path.join(projectDir, 'linker'));

let produceRPX = produceRPXFlag;
if (produceTYPF && !produceRPX) {
    console.warn('TYPF generation requires RPX output, implicitly enabling --rpx flag.');
    produceRPX = true;
}

const validConsoleOutputs = ['cafeloader', 'cf', 'none'] as const;
let consoleOutput: Exclude<typeof validConsoleOutputs[number], 'cf'> = 'none';
switch (consoleFlag!.toLowerCase() as typeof validConsoleOutputs[number]) {
    case 'cf':
    case 'cafeloader':
        console.warn('Selected console output mode: CafeLoader');
        consoleOutput = 'cafeloader';
        break;
    case 'none': break;
    default: abort(`Unsupported console output mode, must be one of: ${validConsoleOutputs.join(', ')}`);
}
if (consoleOutput !== 'none') console.warn('Console output enabled, this is experimental!');

const timer = performance.now();

//*--------------------
//* Step 1: Parse project
//*--------------------
console.info('Parsing project...');
const project = new Project(projectDir, ghsPath, target, consoleOutput);
const baseRpxPath = path.join(project.rpxDir, `${project.targetBaseRpx}.rpx`);

if (!fs.existsSync(project.rpxDir)) abort(`RPX folder ${project.rpxDir} does not exist!`);
if (!fs.existsSync(baseRpxPath)) abort(`Base RPX ${project.targetBaseRpx}.rpx for target ${target} does not exist!`);
if (!project.includeDirs.some(dir => !fs.existsSync(dir))) abort('One or more include folders do not exist!');
if (project.sourcesBaseDir && !fs.existsSync(project.sourcesBaseDir)) abort(`Source folders base path "${project.sourcesBaseDir}" does not exist!`);
if (!fs.existsSync(project.modulesBaseDir)) abort(`Modules folders base path "${project.modulesBaseDir}" does not exist!`);

const rpxData = fs.readFileSync(baseRpxPath);
const rpx = new RPL(rpxData, { parseRelocs: true });

symbolMap = new SymbolMap(projectDir, project.targetAddrMap, rpx.sections);

project.createGPJ(consoleOutput, extraCompilerFlagsCLI);

//*--------------------
//* Step 2: Compile
//*--------------------
console.info('Compiling...');

const objsPath = path.join(projectDir, 'objs');
if (noCache) {
    fs.rmSync(objsPath, { recursive: true, force: true });
    fs.mkdirSync(objsPath);
    console.warn('Compilation cache cleared.');
}
else if (!fs.existsSync(objsPath)) fs.mkdirSync(objsPath);

const gbuildCommand = path.join(project.ghsPath, 'gbuild.exe');
const gbuildArgs = [
    '-top', path.join(projectDir, 'project.gpj'), `-parallel=${threads}`, ...extraBuilderFlagsCLI
];
const gbuild = spawnSync(gbuildCommand, gbuildArgs, { cwd: projectDir, stdio: 'inherit' });
if (gbuild.error || gbuild.signal || gbuild.stderr || gbuild.status !== 0) abort('gbuild command failed!');

const asppcCommand = path.join(project.ghsPath, 'asppc.exe');
const asppcIncludeDirs = project.includeDirs;
const asmCachePath = path.join(objsPath, '.asm.cache');
const asmCache = fs.existsSync(asmCachePath) ? <Record<string, number>>JSON.parse(fs.readFileSync(asmCachePath, 'utf8')) : {};
const depCache: Record<string, number> = {};

for (const asmfile of project.asmFiles) {
    const asmfilePath = /*path.join(project.sourcesBaseDir,*/ asmfile;//);
    const asmfileMtime = fs.statSync(asmfilePath).mtimeMs;
    const deps = scanAssemlyFileDependencies(asmfilePath, asppcIncludeDirs);
    let modifiedDep: string = '';

    if (deps) for (const dep of deps) depCache[dep] = fs.statSync(dep).mtimeMs;

    if (asmfileMtime === asmCache[asmfilePath]) {
        if (!deps || deps.every(dep => (modifiedDep = dep, asmCache[dep] === depCache[dep]))) {
            continue;
        }
    }
    asmCache[asmfilePath] = asmfileMtime;

    console.log(
        'Assembling', asmfile,
        modifiedDep ? `because ${path.relative(project.path, modifiedDep)} has changed` : ''
    );
    const asppcArgs = [
        ...asppcIncludeDirs.map(dir => `-I${dir}/`), '-o', `${path.join(objsPath, path.basename(asmfile))}.o`,
        '-cpu=espresso', '-regs', ...extraAssemblerFlagsCLI, path.relative(projectDir, asmfilePath)
    ];
    const asppc = spawnSync(asppcCommand, asppcArgs, { cwd: projectDir, stdio: 'inherit' });
    if (asppc.error || asppc.signal || asppc.stderr || asppc.status !== 0) abort('asppc command failed!');
}
fs.writeFileSync(asmCachePath, JSON.stringify(Object.assign(asmCache, depCache)));

//*--------------------
//* Step 3: Link
//*--------------------
console.info('Linking...');
project.link(symbolMap, extraLinkerFlagsCLI);

//*--------------------
//* Step 4: Patch
//*--------------------
console.info('Generating patches...');

const oFileData = fs.readFileSync(`${path.join(projectDir, project.name)}.o`);
oFile = new RPL(oFileData);
const patches: Patch[] = project.patches();

//? Attempt to branch off to console output
handleConsoleOutput();
//? Resume patching if no console output
console.info('Applying patches...');
patchRPX(oFile, rpx, patches, project.name, symbolMap.converter);

//*--------------------
//* Step 5: Save RPX
//*--------------------
console.info('Saving...');

const defaultSavePath = path.join(project.rpxDir, `${project.name}.${target}`);
const saved = rpx.save(outPath ?? defaultSavePath, produceRPX);
console.success(`Saved ${produceRPX ? 'RPX' : 'ELF'} to: ${$.cyanBright(saved.filepath)}`);

//*--------------------
//* Step 5+: Generate TYPF file
//*--------------------
if (produceTYPF) {
    console.info('Generating Tachyon patch file...');
    const encoder = new TextEncoder();
    const magic = new Uint8Array([0xC5, 0xFC, 0x9F, 0x01]); // "CS FC PF" <format version>
    const patchesData = encoder.encode(JSON.stringify(patches));
    const projNameAndTargetData = encoder.encode(`${project.name}\v${target}`); // Separated by \v (charcode 0x0B)
    const values = Buffer.allocUnsafe(28);
    values.writeUint32BE(symbolMap.converter.text,             0); // 0x4
    values.writeUint32BE(symbolMap.converter.data,             4); // 0x8
    values.writeUint32BE(symbolMap.converter.syms,             8); // 0xC
    values.writeUint32BE(patchesData.byteLength,              12); // 0x10
    values.writeUint32BE(projNameAndTargetData.byteLength,    16); // 0x14
    values.writeUint32BE(crc.crc32(rpxData),                  20); // 0x18
    values.writeUint32BE(crc.crc32(saved.filedata),           24); // 0x1C

    const patchFileData = zlib.deflateSync(Buffer.concat([
        magic,        // 0x0: u32
        values,       // 0x4: u32, 0x8: u32, 0xC: u32, 0x10: u32, 0x14: u32, 0x18: u32, 0x1C: u32
        patchesData,  // 0x20: char[(value at 0x10)]
        projNameAndTargetData, // 0x20 + (value at 0x10): char[(value at 0x14)]
        oFileData     // 0x20 + (value at 0x10) + (value at 0x14): u8[(until EOF)]
    ]), { memLevel: 9, level: 9 });

    const patchFilePath = path.join(path.dirname(saved.filepath), `${project.name}.${target}.typf`);
    fs.writeFileSync(patchFilePath, patchFileData);
    console.success('Saved TYPF to:', $.cyanBright(patchFilePath));
}

//*--------------------
//* Step 4.5: Console Output
//*--------------------
function handleConsoleOutput(): void {
    switch (consoleOutput) {
        case 'none': return; // Return to non-console procedure
        case 'cafeloader':
            console.info('Generating CafeLoader files...');
            generateCafeloaderFiles(oFile, patches, symbolMap);
            break;
    }
    skipToEnd(); // TODO: Allow for simultaneous console and non-console output, currently only one can be used due to clashing address conversions
}

skipToEnd();
function skipToEnd() {
    console.success($.bold('Finished.'), 'Build took', $.yellow((performance.now() - timer).toFixed(3) + 'ms'));
    process.exit(0);
}