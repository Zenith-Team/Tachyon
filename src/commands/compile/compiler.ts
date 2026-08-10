import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { abort, CommonFiles, fs_move, randomLongUUID, tryStatSync } from '../../utils.js';
import { CPP_EXTS, type Project } from '../../shared/project.js';
function isFileDirty(cppFile: string, depsFile: string, objFile: string): boolean {
    const objMtime = tryStatSync(objFile)?.mtimeMs;
    if (!objMtime) {
        return true;
    }
    const cppMtime = tryStatSync(cppFile)?.mtimeMs ?? 0;
    if (cppMtime > objMtime) {
        return true;
    }
    let dFileContent: string;
    try {
        dFileContent = fs.readFileSync(depsFile, 'utf-8');
    }
    catch {
        return true;
    }
    const singleLine = dFileContent.replaceAll(/\\\r?\n/g, ' ');
    const separatorMatch = /:\s+/.exec(singleLine);
    if (!separatorMatch) {
        console.warn('Recompiling due to: Malformed .d file (no target separator)');
        return true;
    }
    const dependenciesPart = singleLine.slice(separatorMatch.index + separatorMatch[0].length).trim();
    if (!dependenciesPart) {
        return true;
    }
    const deps = dependenciesPart.split(/(?<!\\)\s+/).filter(Boolean);
    for (let dep of deps) {
        dep = dep.replaceAll('\\ ', ' ');
        const depMtime = tryStatSync(dep)?.mtimeMs ?? 0;
        if (depMtime > objMtime) {
            return true;
        }
    }
    return false;
}
export async function compileProject(proj: Project, threads: number, extraCompilerFlags: string[], noCache: boolean, dumpCompileDB: boolean): Promise<boolean> {
    const objsDir = proj.activeObjsDir;
    if (dumpCompileDB && !noCache) {
        noCache = true;
        console.warn('Flag --compiledb implies --no-cache');
    }
    if (noCache) {
        fs.rmSync(objsDir, { recursive: true, force: true });
        console.warn('Compilation cache cleared.');
    }
    fs.mkdirSync(objsDir, { recursive: true });
    const compilerArgs = [
        ...proj.config.buildOptions,
        ...proj.config.includeDirs.map(dir => `-I${dir}`),
        `-DMOD_VERSION="${proj.config.version}"`,
        ...extraCompilerFlags,
    ] as const;
    const pch = await compilePCH(proj, compilerArgs);
    const allFiles = [...proj.cppFiles, ...proj.asmFiles];
    const filesToCompile = noCache ? allFiles : allFiles.filter(filepath => {
        const filename = path.basename(filepath);
        if (filename === CommonFiles.Redirects)
            return true;
        if (filename === CommonFiles.Initializer)
            return true;
        const objFile = path.resolve(path.join(objsDir, filename + '.o'));
        const depsFile = objFile.slice(0, -2) + '.d';
        return isFileDirty(filepath, depsFile, objFile);
    });
    if (filesToCompile.length === 0)
        return false;
    console.info('Compiling sources...');
    if (filesToCompile.length < threads)
        threads = filesToCompile.length;
    const compiledFilesNum = filesToCompile.length;
    const compilerThreads: Promise<void>[] = [];
    for (let t = 0; t < threads; t++) {
        const thread = compilerThread(proj, compilerArgs, filesToCompile, pch, dumpCompileDB);
        if (!thread)
            continue;
        compilerThreads.push(thread);
    }
    await Promise.all(compilerThreads);
    if (dumpCompileDB)
        mergeCompileDB(proj);
    console.info(`✓ Finished compiling ${compiledFilesNum} files.`);
    return true;
}
async function clang(cwd: string, command: string, args: string[]) {
    const clangCXX = spawn(command, args, { cwd, stdio: 'inherit' });
    await new Promise<void>(resolve => {
        clangCXX.on('error', error => {
            abort(`clang++ command failed! (${error.message})`);
        });
        clangCXX.on('close', code => {
            if (code !== 0) {
                abort('clang++ command failed!', code || 1);
            }
            return resolve();
        });
    });
}
async function compilePCH(proj: Project, compilerArgs: readonly string[]): Promise<string | null> {
    if (!proj.config.precompiledHeader)
        return null;
    const objsDir = proj.activeObjsDir;
    const depsFile = path.resolve(path.join(objsDir, path.basename(proj.config.precompiledHeader) + '.d'));
    const output = depsFile.slice(0, -2) + '.pch';
    const inputFull = path.resolve(proj.path, proj.config.precompiledHeader);
    if (!isFileDirty(proj.config.precompiledHeader, depsFile, output))
        return output;
    const fullCompilerArgs = [
        ...compilerArgs,
        '-x', 'c++-header',
        '-o', output,
        inputFull,
    ];
    console.info('Compiling PCH', inputFull);
    await clang(proj.path, proj.compilerCommand, fullCompilerArgs);
    return output;
}
function compilerThread(proj: Project, compilerArgs: readonly string[], fileQueue: string[], pch: string | null, dumpCompileDB: boolean) {
    if (fileQueue.length === 0)
        return null;
    return (async (): Promise<void> => {
        const objsDir = proj.activeObjsDir;
        while (fileQueue.length !== 0) {
            const codeFile = fileQueue.pop();
            if (!codeFile)
                break;
            const baseName = path.basename(codeFile);
            const tmpDir = path.join(os.tmpdir(), `tachyon-${randomLongUUID()}`);
            fs.mkdirSync(tmpDir, { recursive: true });
            const tmpOutputObj = path.resolve(path.join(tmpDir, baseName + '.o'));
            const finalOutputObj = path.resolve(path.join(objsDir, baseName + '.o'));
            const codeFileFullPath = path.resolve(proj.path, codeFile);
            const fullCompilerArgs = [
                ...compilerArgs,
                codeFileFullPath,
                '-o', tmpOutputObj,
            ];
            if (pch && CPP_EXTS.includes(path.extname(codeFile).toLowerCase())) {
                fullCompilerArgs.push('-include-pch', pch);
            }
            if (dumpCompileDB)
                fullCompilerArgs.push('-MJ', tmpOutputObj + '.cdb.json');
            console.info('Compiling', codeFileFullPath);
            await clang(proj.path, proj.compilerCommand, fullCompilerArgs);
            fs_move(tmpOutputObj, finalOutputObj, true);
            const osTmpDepFile = tmpOutputObj.slice(0, -2) + '.d';
            const finalDepFile = finalOutputObj.slice(0, -2) + '.d';
            fs_move(osTmpDepFile, finalDepFile, true);
            if (dumpCompileDB)
                fs_move(tmpOutputObj + '.cdb.json', finalOutputObj + '.cdb.json', true);
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    })();
}
function mergeCompileDB(proj: Project) {
    interface CompileDBEntry {
        directory: string;
        file: string;
        output: string;
        arguments: string[];
    }
    const wstream = fs.createWriteStream(path.join(proj.path, CommonFiles.CompileDB), { encoding: 'utf8' });
    wstream.write('[\n  ');
    let first = true;
    for (const file of fs.readdirSync(proj.activeObjsDir)) {
        if (!file.endsWith('.cdb.json'))
            continue;
        if (!first)
            wstream.write(',\n  ');
        else
            first = false;
        const cdbEntryPath = path.join(proj.activeObjsDir, file);
        let cdbEntryData = fs.readFileSync(cdbEntryPath).subarray(0, -2).toString('utf8');
        if (process.platform === 'win32') {
            cdbEntryData = cdbEntryData.slice(0, -1);
        }
        const cdbEntry = JSON.parse(cdbEntryData) as CompileDBEntry;
        cdbEntry.arguments = cdbEntry.arguments.filter(arg => !arg.startsWith('-ferror-limit='));
        cdbEntry.arguments.push('-ferror-limit=0');
        cdbEntry.arguments.push('-D', '__clangd__');
        wstream.write(JSON.stringify(cdbEntry));
    }
    wstream.write('\n]\n');
    wstream.end();
    console.warn(`Compilation database dumped to ${path.resolve(CommonFiles.CompileDB)}`);
}
