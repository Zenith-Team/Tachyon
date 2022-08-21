import fs from 'fs';
import path from 'path';
import syslib from './syslib';
import { SymbolMap } from './symbolmap';
import { Project } from './project';
import { UnixPath, ResolveDrive, WindowsPath } from './utils';
import { RPL, WSLSafePath } from 'rpxlib';
import { PatchFile, patchRPX } from './patchrpx';
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
const patches: Patch[] = project.patches();

patchRPX(oFile, rpx, patches, brand, symbolMap.converter);

if (prod) {
    const patchFile: PatchFile = {
        patches: patches,
        addrs: {
            syms: symbolMap.converter.syms,
            text: symbolMap.converter.text,
            data: symbolMap.converter.data
        }
    }
    fs.writeFileSync(`${path.join(projectPath, region)}.json`, JSON.stringify(patchFile))
}

//*--------------------
//* Step 5: Save RPX
//*--------------------
console.info('Saving RPX...');

const defaultSavePath = vanillaRpxPath.split('.').slice(0, -1).join('.');
const savedTo = rpx.save(`${outpath || defaultSavePath}.${brand}`, prod);
console.info(`Saved RPX to: ${savedTo}`);
console.info(`Finished. Build took ${(performance.now() - timer).toFixed(3)}ms.`);
