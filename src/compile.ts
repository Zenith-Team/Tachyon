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
import { abort, scanAssemlyFileDependencies } from './utils.js';

export let oFile: RPL;
export let symbolMap: SymbolMap;
const cwd = process.cwd();

const {
    positionals: targets, values: {
        project: projectPathRaw,
        threads: threadsRaw,
        meta: metaFolderName,
        ghs: ghsPathRaw,
        out: outPathRaw,
        aflag, cflag, lflag,
        rpx: produceRPXFlag,
        typf: produceTYPF,
        'no-cache': noCache
    }
} = util.parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: {
        project:    { type: 'string',  short: 'p', default: cwd },
        threads:    { type: 'string',  short: 'T', default: '2' },
        meta:       { type: 'string',  short: 'm', default: 'project' },
        ghs:        { type: 'string',  short: 'g', default: process.env.GHS_ROOT ?? 'C:/ghs/multi5327' },
        out:        { type: 'string',  short: 'o' },
        aflag:      { type: 'string',  short: 'A', multiple: true },
        cflag:      { type: 'string',  short: 'C', multiple: true },
        lflag:      { type: 'string',  short: 'L', multiple: true },
        rpx:        { type: 'boolean', default: false, short: 'r' },
        typf:       { type: 'boolean', default: false, short: 't' },
        'no-cache': { type: 'boolean', default: false },
    }
});
if (targets.length === 0) abort('No targets specified.');
if (targets.length > 1) abort('Multiple targets are not yet supported.');
const target = targets[0]!;
const extraAssemblerFlags = aflag ?? [];
const extraCompilerFlags = cflag ?? [];
const extraLinkerFlags = lflag ?? [];

const threads = Number(threadsRaw);
if (!Number.isSafeInteger(threads) || threads <= 0) abort('Invalid number of threads.');
if (threads > os.cpus().length) abort(`Number of threads exceeds number of available CPU cores (${os.cpus().length}).`);

const outPath = outPathRaw ? (
    ['.rpx', '.rpl', '.elf'].includes(path.extname(outPathRaw).toLowerCase()) ?
        abort('Output path may not contain the file extension, only the name.') : path.resolve(cwd, outPathRaw)
) : null;
const projectPath = path.resolve(cwd, projectPathRaw!);
const ghsPath = path.resolve(cwd, ghsPathRaw!);
const metaPath = path.join(projectPath, metaFolderName!);

if (!fs.existsSync(projectPath))                             abort('Project path folder does not exist!');
if (!fs.existsSync(metaPath))                                abort(`Project meta folder not found: ${metaPath}`);
if (!fs.existsSync(path.join(metaPath, 'project.yaml')))     abort('Project meta folder does not have a project.yaml!');
if (!fs.existsSync(path.join(metaPath, 'syms')))             abort('Project meta folder does not have a "syms" folder!');
if (!fs.existsSync(path.join(metaPath, 'syms', 'main.map'))) abort('Project symbols folder does not have a main.map file!');
if (!fs.existsSync(path.join(metaPath, 'conv')))             abort('Project meta folder does not have a "conv" folder!');
if (!fs.existsSync(path.join(metaPath, 'linker')))           fs.mkdirSync(path.join(metaPath, 'linker'));

let produceRPX = produceRPXFlag;
if (produceTYPF && !produceRPX) {
    console.warn('TYPF generation requires RPX output, implicitly enabling --rpx flag.');
    produceRPX = true;
}

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
if (noCache) {
    fs.rmSync(objsPath, { recursive: true, force: true });
    fs.mkdirSync(objsPath);
    console.warn('Compilation cache cleared.');
}
else if (!fs.existsSync(objsPath)) fs.mkdirSync(objsPath);

const gbuildCommand = path.join(project.ghsPath, 'gbuild.exe');
const gbuildArgs = [
    '-top', path.join(metaPath, 'project.gpj'), `-parallel=${threads}`, ...extraCompilerFlags
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

    console.log(
        'Assembling', asmfile,
        modifiedDep ? `because ${path.relative(project.sourceDir, modifiedDep)} has changed` : ''
    );
    const asppcArgs = [
        `-I${asppcIncludeDir}/`, '-o', `${path.join(objsPath, path.basename(asmfile))}.o`,
        '-cpu=espresso', '-regs', ...extraAssemblerFlags, path.relative(projectPath, asmfilePath)
    ];
    const asppc = spawnSync(asppcCommand, asppcArgs, { cwd: projectPath, stdio: 'inherit' });
    if (asppc.error || asppc.signal || asppc.stderr || asppc.status !== 0) abort('asppc command failed!');
}
fs.writeFileSync(asmCachePath, JSON.stringify(Object.assign(asmCache, depCache)));

//*--------------------
//* Step 3: Link
//*--------------------
console.info('Linking...');
project.link(symbolMap, extraLinkerFlags);

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

console.success($.bold('Finished.'), 'Build took', $.yellow((performance.now() - timer).toFixed(3) + 'ms'));
