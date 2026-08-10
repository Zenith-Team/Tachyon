import $ from 'chalk';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectConfig, type ProjectConfig } from './projectconfig.js';
import { abort, TitleID, CommonDirs, CommonFiles, hex, randomShortUUID } from '../utils.js';
import { Lockfile } from '../pkgmgr/lockfile.js';
import { SymbolMap } from './symbolmap.js';
export const CPP_EXTS: readonly string[] = ['.c', '.cpp', '.cxx', '.c++', '.cc'];
export const ASM_EXTS: readonly string[] = ['.s', '.asm', '.ppc'];
export class Project {
    constructor(projectDir: string, public readonly compilerCommand: string, public readonly linkerCommand: string, sysrootPath: string, public readonly requestedTargets: [
        string,
        ...string[]
    ], outPath: string | undefined, excludedCompilerFlags: string[]) {
        this.path = projectDir;
        if (excludedCompilerFlags.includes('all')) {
            if (excludedCompilerFlags.length !== 1)
                abort('-Xall must be the only usage of the -X flag.');
            excludedCompilerFlags = this.baseBuildOptions.map(opt => opt.split('=')[0]!);
        }
        this.config = loadProjectConfig(this.path, excludedCompilerFlags);
        this.baseBuildOptions = this.config.buildOptions;
        if (requestedTargets.length === 0) {
            const availableTargets: string[] = [];
            for (const targetName in this.config.targets) {
                const target = this.config.targets[targetName];
                if (target?.AbstractOnly)
                    continue;
                const TID = target?.TitleID ? ` [${$.magenta(target.TitleID)}]` : $.magenta.dim(' (no TitleID)');
                availableTargets.push(`${$.yellowBright(targetName)}${$.white(TID)}`);
            }
            abort(`No targets specified! Available targets for this project:\n        ${$.white('>')} ` +
                availableTargets.join(`\n        ${$.white('>')} `));
        }
        if (requestedTargets.includes('*')) {
            if (requestedTargets.length !== 1)
                abort('The wildcard target (*) is used to compile ALL targets and must NOT be alongside other targets.');
            console.info('Building ALL valid targets.');
            requestedTargets.pop();
            for (const targetName in this.config.targets) {
                const target = this.config.targets[targetName];
                if (target?.AbstractOnly)
                    continue;
                requestedTargets.push(targetName);
            }
        }
        this.config.includeDirs.push(path.resolve(sysrootPath, 'cxx'), path.resolve(sysrootPath, 'c'), path.resolve(sysrootPath, 'lib'));
        let lockfile: Lockfile | null = null;
        const lockfilePath = path.join(projectDir, CommonFiles.Lockfile);
        if (fs.existsSync(lockfilePath)) {
            lockfile = Lockfile.load(lockfilePath);
        }
        const directDeps = lockfile?.DirectDependencies;
        if (directDeps) {
            for (const [depName, dep] of Object.entries(directDeps)) {
                this.directDependencies.push({ name: depName, version: dep.Version });
            }
        }
        const dependencies = lockfile?.ResolvedDependencies;
        if (dependencies)
            for (const [depName, dep] of Object.entries(dependencies)) {
                this.config.includeDirs.push(...dep.IncludeDirs.map(dir => path.resolve(this.path, dir)));
                const depInstallPath = path.join(this.path, CommonDirs.Packages, depName);
                if (!fs.existsSync(depInstallPath))
                    abort(`Required project dependency ${depName} is not installed, did you forget to run "tachyon pm install"?`);
                const isLinkedPkg = fs.lstatSync(depInstallPath).isSymbolicLink();
                const depExportsPath = path.join(depInstallPath, isLinkedPkg ? CommonDirs.Exports : CommonDirs.PkgExports);
                if (!fs.existsSync(depExportsPath))
                    abort(`Dependency ${depName} has no exports folder.`);
                const depExportsFiles = fs.readdirSync(depExportsPath);
                const depHasExports = depExportsFiles.length > 0;
                if (!depHasExports)
                    abort(`Dependency ${depName} has no exports files.`);
                const depSupportedTitleIDs = new Set<bigint>();
                for (const exportsFile of depExportsFiles) {
                    if (!exportsFile.startsWith('exports_') || !exportsFile.endsWith('.json')) {
                        console.debug(`Ignoring unknown file in exports of package "${depName}":`, exportsFile);
                        continue;
                    }
                    const exportsFileFullPath = path.join(depExportsPath, exportsFile);
                    const maybeTitleID = exportsFile.slice(8, -5);
                    const parsedTitleID = TitleID.parse(maybeTitleID);
                    if (parsedTitleID === null)
                        abort(`Invalid dependency exports file found at: ${exportsFileFullPath}\nContact the dependency author.`);
                    if (!this.dependenciesExportsMap.has(parsedTitleID))
                        this.dependenciesExportsMap.set(parsedTitleID, []);
                    const titleidExportFilesList = this.dependenciesExportsMap.get(parsedTitleID)!;
                    titleidExportFilesList.push(exportsFileFullPath);
                    depSupportedTitleIDs.add(parsedTitleID);
                }
                this.dependenciesSupportedTitleIDsMap.set(depName, depSupportedTitleIDs);
                const depSymsMapPath = path.join(depInstallPath, CommonFiles.MainSymbolMap);
                const depConvMapsPath = path.join(depInstallPath, CommonDirs.ConversionMaps);
                if (fs.existsSync(depSymsMapPath)) {
                    const symmap = new SymbolMap(depSymsMapPath);
                    const mapObj = { syms: symmap, conv: new Map<bigint, string> };
                    this.dependenciesSymbolAndConvMaps.set(depName, mapObj);
                    if (fs.existsSync(depConvMapsPath)) {
                        const convmapList = fs.readdirSync(depConvMapsPath);
                        const depHasConvmaps = convmapList.length > 0;
                        if (depHasConvmaps) {
                            for (const convFile of convmapList) {
                                if (!convFile.endsWith('.convmap')) {
                                    console.debug(`Ignoring unknown file in "conv" of package "${depName}":`, convFile);
                                    continue;
                                }
                                const tid = path.basename(convFile, '.convmap');
                                const tidParsed = TitleID.parse(tid);
                                if (!tidParsed)
                                    abort(`Conversion map with invalid title ID in "conv" of package "${depName}": ${convFile}`);
                                const convFileFullPath = path.join(depConvMapsPath, convFile);
                                mapObj.conv.set(tidParsed, convFileFullPath);
                            }
                        }
                    }
                    else {
                        console.debug(`Dependency ${depName} has no conv maps folder.`);
                    }
                }
                else {
                    if (fs.existsSync(depConvMapsPath))
                        abort(`Dependency ${depName} is corrupt. It has conversion maps with no own symbol map.`);
                    console.debug(`Dependency ${depName} has no symbol map.`);
                }
            }
        if (outPath)
            this.outputDir = path.resolve(outPath);
        else
            this.outputDir = path.join(projectDir, CommonDirs.DefaultOutputPath);
        this.outputFilename = this.config.name + (this.config.freestanding ? '' : ',:target:');
        this.intermediateELFPath = path.join(os.tmpdir(), `tachyon-compile-tmp-${this.config.name}-${randomShortUUID()}.elf`);
        fs.mkdirSync(this.outputDir, { recursive: true });
        for (const srcDir of this.config.sourceDirs) {
            for (const file of fs.readdirSync(srcDir, { recursive: true, encoding: 'utf8' })) {
                const ext = path.extname(file).toLowerCase();
                if (CPP_EXTS.includes(ext))
                    this.userCppFiles.push(path.resolve(this.path, path.join(srcDir, file)));
                if (ASM_EXTS.includes(ext))
                    this.userAsmFiles.push(path.resolve(this.path, path.join(srcDir, file)));
            }
        }
    }
    get activeObjsDir(): string {
        return path.join(this.path, CommonDirs.Objs, hex(this.config.targetTitleID!, 16, ''));
    }
    readonly dependenciesExportsMap = new Map<bigint, string[]>();
    readonly dependenciesSymbolAndConvMaps = new Map<string, {
        syms: SymbolMap;
        conv: Map<bigint, string>;
    }>();
    readonly dependenciesSupportedTitleIDsMap = new Map<string, Set<bigint>>();
    readonly directDependencies: {
        name: string;
        version: string;
    }[] = [];
    intermediateELFPath: string;
    outputDir: string;
    outputFilename: string;
    readonly path: string;
    readonly config: ProjectConfig;
    static readonly requiredBuildOptions: string[] = [
        '-mcpu=750',
        '-fno-sized-deallocation', '-funsigned-char', '-mhard-float', '-mno-altivec', '-fno-fast-math', '-fno-new-infallible',
        '-fshort-wchar',
        '-fno-strict-aliasing',
    ];
    baseBuildOptions: string[] = [...ProjectBaseBuildOpts];
    readonly userCppFiles: string[] = [];
    readonly userAsmFiles: string[] = [];
    cppFiles: string[] = [];
    asmFiles: string[] = [];
}
export const ProjectBaseBuildOpts = [
    '-std=c++23',
    '--driver-mode=g++',
    '-ffreestanding', '-fno-builtin', '-nostdlib', '-nobuiltininc',
    '-Wno-switch', '-Werror', '-Wextra', '-Wno-unused-parameter', '-Wno-missing-field-initializers', '-Wno-missing-exception-spec', '-Wno-gcc-compat', '-Wno-invalid-offsetof', '-Wno-invalid-source-encoding', '-Wno-deprecated-enum-enum-conversion', '-Wshadow',
    '-ferror-limit=1',
    '-mregnames',
    '-MMD',
    '-Dcafe',
    '-D_LIBCPP_HAS_NO_THREADS', '-D_LIBCPP_HAS_NO_LOCALIZATION',
    '-DDISABLE_PS',
] as const;
