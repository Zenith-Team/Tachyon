import $ from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { Zip } from 'zip-lib';
import { abort, isFolderAtSync, CommonDirs, CommonFiles, hex, TitleID } from '../../utils.js';
import { Project } from '../../shared/project.js';
import { generateRedirects } from './redirects.js';
import { generateInitializer } from './initializer.js';
import { LD_EPILOGUE, LD_PROLOGUE, linkProject } from './linker.js';
import { compileProject } from './compiler.js';
import { convertToRPL } from '../../cafe/elf-rpl-convert.js';
import type { OptimizationLevel } from './cli-handler.js';
import { configureTarget, type ProjectCacheJson } from '../../shared/projectconfig.js';
import { type ProjectExportsJson, createExports } from '../../cafe/exportsdump.js';
import { dependencyExportsToImports, genLDSnippetForImport } from '../../cafe/imports.js';
import { ConvMap, ConvPlatform } from '../../shared/convmap.js';
import { RPL } from 'rpxlib';
export async function compile({ projectDir, compilerPath, linkerPath, sysrootPath, targets, outPath, noCache, threads, excludedCompilerFlags, extraCompilerFlags, extraLinkerFlags, zlibLevel, optLevel, package: genPkg, compiledb, targetConsole, consoleOnly, }: {
    targets: [
        string,
        ...string[]
    ];
    projectDir: string;
    threads: number;
    compilerPath: string;
    linkerPath: string;
    sysrootPath: string;
    excludedCompilerFlags: string[];
    extraCompilerFlags: string[];
    extraLinkerFlags: string[];
    zlibLevel: RPL.ZlibCompressionLevel | boolean;
    optLevel: OptimizationLevel;
    outPath?: string;
    noCache: boolean;
    package: boolean;
    compiledb: boolean;
    targetConsole: boolean;
    consoleOnly: boolean;
}): Promise<void> {
    console.info('Parsing project...');
    const totalStartTime = performance.now();
    const usedWildcardTarget = targets.includes('*');
    const project = new Project(projectDir, compilerPath, linkerPath, sysrootPath, targets, outPath, excludedCompilerFlags);
    if (optLevel !== 'none')
        project.baseBuildOptions.push(`-O${optLevel}`);
    project.config.includeDirs.forEach(dir => {
        if (!isFolderAtSync(dir))
            abort(`Include folder does not exist: ${dir}`);
    });
    project.config.sourceDirs.forEach(dir => {
        if (!isFolderAtSync(dir))
            abort(`Source folder does not exist: ${dir}`);
    });
    if (project.config.freestanding && targetConsole)
        abort('Illegal option: --console[-only] is redundant on freestanding targets.');
    if (usedWildcardTarget) {
        if (targetConsole && !consoleOnly)
            abort('Illegal option: The package command or wildcard target (*) already imply --console');
        if (!project.config.freestanding)
            targetConsole = true;
    }
    interface TargetQueueEntry {
        name: string;
        console: boolean;
    }
    const targetQueue: TargetQueueEntry[] = [];
    for (const target of project.requestedTargets) {
        if (!consoleOnly)
            targetQueue.push({ name: target, console: false });
        if (targetConsole)
            targetQueue.push({ name: target, console: true });
    }
    const artifacts: string[] = [];
    for (const target of targetQueue) {
        const targetStartTime = performance.now();
        project.cppFiles = [...project.userCppFiles];
        project.asmFiles = [...project.userAsmFiles];
        configureTarget(project.config, target.name, project.baseBuildOptions, target.console);
        console.log('');
        console.info(`=== Compiling target: ${$.yellowBright.bold(target.name + (target.console ? ' (Console)' : ''))} ===`);
        const TAGGED_TARGET_TITLEID = project.config.targetTitleID!;
        const TAGGED_TARGET_TID_FMT = TitleID.format(TAGGED_TARGET_TITLEID);
        const UNTAGGED_TARGET_TITLEID = TitleID.removeConsoleTag(TAGGED_TARGET_TITLEID);
        const UNTAGGED_TARGET_TID_FMT = TitleID.format(UNTAGGED_TARGET_TITLEID);
        if (!project.config.freestanding) {
            const tidType = TitleID.getType(UNTAGGED_TARGET_TITLEID);
            if (!tidType) {
                console.warn(`Unknown type of target title ID: ${$.magentaBright(UNTAGGED_TARGET_TID_FMT)}.\n` +
                    'Check if it is typed correctly, or the target Wii U application may be unsupported.');
            }
            else if (tidType === TitleID.Type.Update || tidType === TitleID.Type.DLC) {
                const suggestion = $.yellow(UNTAGGED_TARGET_TID_FMT) + ' -> ' + $.greenBright(TitleID.format(TitleID.stripSubtype(UNTAGGED_TARGET_TITLEID)));
                abort(`Detected a game UPDATE or DLC title ID, please use the BASE title ID of your game instead: ${suggestion}`);
            }
            else if (tidType !== TitleID.Type.Game) {
                console.warn(`Detected title ID of type ${$.magentaBright(TitleID.Type[tidType])}, Wii U applications of this type may not be supported and have not been tested!`);
            }
        }
        for (const directDep of project.directDependencies) {
            const depSupportedTitleIDs = project.dependenciesSupportedTitleIDsMap.get(directDep.name);
            if (!depSupportedTitleIDs)
                throw new Error('Assertion failure: Dependency supported TIDs Set was null');
            const fmtDep = $.yellow(directDep.name);
            if (depSupportedTitleIDs.has(0n))
                console.debug(`OK: Dependency ${directDep.name} is freestanding.`);
            else if (!depSupportedTitleIDs.has(TAGGED_TARGET_TITLEID)) {
                abort(`Dependency ${fmtDep} does not support the Title ID (${$.magentaBright(TAGGED_TARGET_TID_FMT)}) ` +
                    `which your ${$.yellowBright.bold(target.name)} target requires.\n` +
                    `${fmtDep}'s supported Title IDs: ${$.magentaBright([...depSupportedTitleIDs].map(TitleID.format).join($.gray(', ')))}`);
            }
            else
                console.debug(`OK: Dependency ${directDep.name} supports Title ID ${TAGGED_TARGET_TID_FMT}`);
        }
        let convMap: ConvMap | undefined;
        if (!project.config.freestanding) {
            const convMapID = hex(UNTAGGED_TARGET_TITLEID, 16, '');
            let convFilePath = path.join(projectDir, CommonDirs.ConversionMaps, convMapID + '.convmap');
            if (!fs.existsSync(convFilePath)) {
                if (!project.config.convMapProvider)
                    abort(`Missing needed conversion map for title ID ${UNTAGGED_TARGET_TID_FMT}, and no ConvMapProvider is set to inherit it.`
                        + `\n        Wanted file: ${$.yellowBright(path.relative(projectDir, convFilePath))}`);
                const convMapProviderPkg = project.dependenciesSymbolAndConvMaps.get(project.config.convMapProvider);
                if (!convMapProviderPkg)
                    abort(`The specified ConvMapProvider package "${project.config.convMapProvider}" is not present in this project or could not be resolved.`);
                const inheritedConvMapPath = convMapProviderPkg.conv.get(UNTAGGED_TARGET_TITLEID);
                if (!inheritedConvMapPath)
                    abort(`The specified ConvMapProvider package "${project.config.convMapProvider}" does not have a conversion map for the requested target title ID.`);
                convFilePath = inheritedConvMapPath;
            }
            else if (project.config.convMapProvider && project.dependenciesSymbolAndConvMaps.get(project.config.convMapProvider)?.conv.get(UNTAGGED_TARGET_TITLEID)) {
                console.warn($.dim('You\'ve set a ConvMapProvider in your project config, '
                    + `but also have a local conversion map file for the title ID ${UNTAGGED_TARGET_TID_FMT}.\n` +
                    `  Your local conversion map is taking priority over "${project.config.convMapProvider}"'s conversion map. (They are NOT merged!)`));
            }
            convMap = ConvMap.parseFile(convFilePath);
            generateRedirects(project, convMap);
        }
        const outFilename = project.outputFilename.replaceAll(':target:', target.name) + (target.console ? ',C' : '');
        const finalRPLPath = path.join(project.outputDir, outFilename + '.rpl');
        if (!project.config.initless) {
            generateInitializer(project);
        }
        const config_mtime = fs.statSync(path.join(project.path, CommonFiles.Config)).mtimeMs;
        const cli_hash = process.argv.slice(3).sort().filter(f => f !== '--no-cache').join();
        const toolchain_lock_path = path.join(process.env.TACHYON_HOME!, CommonFiles.TachyonToolchainLock);
        if (!fs.existsSync(toolchain_lock_path))
            fs.writeFileSync(toolchain_lock_path, '{"compiler":"v1.0.0","sysroot":"W/\\"0\\""}');
        const toolchain_lock = fs.readFileSync(toolchain_lock_path, 'utf8');
        if (!noCache && fs.existsSync(path.join(project.path, CommonDirs.Objs))) {
            try {
                const projectCachePath = path.join(project.path, CommonDirs.Objs, CommonFiles.ProjectCache);
                const projCache = JSON.parse(fs.readFileSync(projectCachePath, 'utf8')) as ProjectCacheJson;
                if (projCache.config_mtime !== config_mtime) {
                    console.warn('Project configuration update detected. Forcing full rebuild.');
                    noCache = true;
                }
                else if (projCache.last_cli_hash !== cli_hash) {
                    console.warn('Compilation command-line arguments changed. Forcing full rebuild.');
                    noCache = true;
                }
                else if (projCache.toolchain_lock !== toolchain_lock) {
                    console.warn('Locally installed toolchain change detected. Forcing full rebuild.');
                    noCache = true;
                }
                else
                    console.debug('Project is safe to cache.');
            }
            catch {
                if (!noCache) {
                    console.warn('Failed to read project cache or it doesn\'t exist. Forcing full rebuild.');
                    noCache = true;
                }
            }
        }
        const extraCompilerFlagsPerTarget = [
            ...extraCompilerFlags,
            target.console ? '-D__CONSOLE__' : '-D__EMULATOR__',
        ];
        if (!project.config.freestanding)
            extraCompilerFlagsPerTarget.push(`-D__TITLEID__=${UNTAGGED_TARGET_TITLEID}`);
        const dirty = await compileProject(project, threads, extraCompilerFlagsPerTarget, noCache, compiledb);
        if (!dirty) {
            const targetDuration = performance.now() - targetStartTime;
            const durationStr = targetDuration >= 1000 ? `${(targetDuration / 1000).toFixed(2)} s` : `${targetDuration.toFixed(1)} ms`;
            console.warn('Nothing to do.');
            console.success(`${$.greenBright.bold('[✓ SUCCESS]')} RPL is cached at: ${$.cyanBright(finalRPLPath)} (Took ${durationStr})`);
            continue;
        }
        console.info('Building exports...');
        const exportsDumpPath = createExports(project);
        artifacts.push(exportsDumpPath);
        console.info('Building imports...');
        let ld = LD_PROLOGUE;
        const universalDepsExportsFilesList = project.dependenciesExportsMap.get(0n) ?? [];
        const titleSpecificDepsExportsFilesList = project.config.freestanding
            ? []
            : (project.dependenciesExportsMap.get(TAGGED_TARGET_TITLEID) ?? []);
        const depsExportsFilesList = [...universalDepsExportsFilesList, ...titleSpecificDepsExportsFilesList];
        for (const depExportsFile of depsExportsFilesList) {
            const exports = JSON.parse(fs.readFileSync(depExportsFile, 'utf8')) as ProjectExportsJson;
            dependencyExportsToImports(project, exports);
            ld += genLDSnippetForImport(exports.libName);
        }
        ld += LD_EPILOGUE;
        console.info('Linking...');
        linkProject(project, extraLinkerFlags, ld);
        console.info('Creating RPL...');
        if (process.env.TACHYON_DEBUG) {
            fs.copyFileSync(project.intermediateELFPath, path.join(project.outputDir, outFilename + '.debug.elf'), fs.constants.COPYFILE_FICLONE);
        }
        const elf = new RPL(fs.readFileSync(project.intermediateELFPath), { parseRelocs: true });
        if (convMap)
            convHooks(elf, convMap, target.console);
        convertToRPL(elf, outFilename + '.rpl');
        elf.save(finalRPLPath, zlibLevel, {
            automaticFileExtension: false, compressAsPossible: true, forceIgnoreSegments: true, [Symbol.for('@@iKnowWhatImDoing')]: true
        });
        fs.rmSync(project.intermediateELFPath, { force: true, recursive: false });
        artifacts.push(finalRPLPath);
        fs.writeFileSync(path.join(project.path, CommonDirs.Objs, CommonFiles.ProjectCache), JSON.stringify({
            config_mtime,
            last_cli_hash: cli_hash,
            toolchain_lock,
        } satisfies ProjectCacheJson, null, 2));
        const targetDuration = performance.now() - targetStartTime;
        const durationStr = targetDuration >= 1000 ? `${(targetDuration / 1000).toFixed(2)} s` : `${targetDuration.toFixed(1)} ms`;
        console.success(`${$.greenBright.bold('[✓ SUCCESS]')} RPL saved at: ${$.cyanBright(finalRPLPath)} (Took ${durationStr})`);
    }
    if (genPkg) {
        const lockfilePath = path.join(projectDir, CommonFiles.Lockfile);
        if (fs.existsSync(lockfilePath))
            artifacts.push(lockfilePath);
        artifacts.push(path.join(projectDir, CommonFiles.Config));
        artifacts.push(...project.config.userIncludeDirs);
        if (!project.config.freestanding) {
            const symmap = path.join(projectDir, CommonFiles.MainSymbolMap);
            const convdir = path.join(projectDir, CommonDirs.ConversionMaps);
            if (fs.existsSync(symmap))
                artifacts.push(symmap);
            if (fs.existsSync(convdir))
                artifacts.push(convdir);
        }
        if (project.config.type === 'Special') {
            const launcherMainAsmPath = path.join(projectDir, '..', 'launcher', 'cemu', 'main.asm');
            const launcherRulesTxtPath = path.join(projectDir, '..', 'launcher', 'cemu', 'rules.txt');
            if (!fs.existsSync(launcherMainAsmPath))
                abort('Internal Special package error (A).');
            if (!fs.existsSync(launcherRulesTxtPath))
                abort('Internal Special package error (R).');
            artifacts.push(launcherMainAsmPath, launcherRulesTxtPath);
        }
        const contentPath = path.join(projectDir, 'content');
        if (fs.existsSync(contentPath)) {
            artifacts.push(contentPath);
        }
        const outputTpkgPath = path.join(projectDir, CommonDirs.DefaultOutputPath, 'package.zip');
        const zip = new Zip({
            compressionLevel: 9, followSymlinks: true,
            mode: 0o644, mtime: new Date(Date.UTC(2026)),
        });
        for (const artifact of artifacts) {
            if (!fs.existsSync(artifact))
                abort(`Packer: Artifact path does not exist: "${artifact}"`);
            let target = path.relative(projectDir, artifact).replaceAll('\\', '/');
            if (target.startsWith('./'))
                target = target.slice(2);
            if (target.startsWith('..')) {
                if (project.config.type === 'Special') {
                    if (target.endsWith('/launcher/cemu/main.asm')) {
                        target = path.join(CommonDirs.PkgIntermediate, 'main.asm');
                    }
                    else if (target.endsWith('/launcher/cemu/rules.txt')) {
                        target = path.join(CommonDirs.PkgIntermediate, 'rules.txt');
                    }
                    else
                        abort(`Packer: Illegal artifact path outside project directory: "${artifact}" (S)`);
                }
                else
                    abort(`Packer: Illegal artifact path outside project directory: "${artifact}"`);
            }
            if (target.startsWith(CommonDirs.Intermediate + '/')) {
                target = path.join(CommonDirs.PkgIntermediate, target.slice(CommonDirs.Intermediate.length + 1));
            }
            if (isFolderAtSync(artifact)) {
                zip.addFolder(artifact, target);
            }
            else {
                zip.addFile(artifact, target);
            }
        }
        await zip.archive(outputTpkgPath);
        console.success(`${$.greenBright.bold('[✓ SUCCESS]')} Tachyon package saved at: ${$.cyanBright(outputTpkgPath)}`);
    }
    const totalDuration = performance.now() - totalStartTime;
    const durationStr = totalDuration >= 1000 ? `${(totalDuration / 1000).toFixed(2)} s` : `${totalDuration.toFixed(1)} ms`;
    console.success($.italic.dim(`            Total run time: ${$.yellow(durationStr)}`));
}
function convHooks(elf: RPL, convMap: ConvMap, consoleTarget: boolean): void {
    const loaderdataSection = elf.sections.find(section => section.name === '.loaderdata');
    if (!loaderdataSection)
        return;
    const loaderdata = loaderdataSection.data;
    if (!loaderdata)
        return console.warn('Empty .loaderdata found, skipping convHooks (this shouldn\'t happen!)');
    const view = new DataView(loaderdata.buffer, loaderdata.byteOffset, loaderdata.byteLength);
    for (let i = 0; i < loaderdata.byteLength; i += 0x20) {
        const addr = view.getUint32(i + 0x4);
        const convertedAddr = convMap.convert(addr, consoleTarget ? ConvPlatform.CONSOLE : ConvPlatform.EMULATOR);
        view.setUint32(i + 0x4, convertedAddr);
    }
}
