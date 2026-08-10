import $ from 'chalk';
import fs from 'node:fs';
import os from 'node:os';
import util from 'node:util';
import path from 'node:path';
import { abort, CommonDirs, findFileConflicts, getAllTargets, hex, TitleID, validateProjectFolder } from '../utils.js';
import { configureTarget, loadProjectConfig, type ProjectConfig } from '../shared/projectconfig.js';
import { archiveFolder } from 'zip-lib';
export async function cli_handler(args: string[]): Promise<void> {
    const { positionals: targetsOverride, } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {}
    });
    return await bundleProject(targetsOverride, false);
}
export async function bundleProject(targetsOverride: string[] = [], forLaunch: boolean): Promise<void> {
    const projectDir = validateProjectFolder();
    const config = loadProjectConfig(projectDir);
    if (config.type === 'Special')
        abort('Cannot bundle Special module.');
    const bundleTmpDir = forLaunch
        ? path.join(projectDir, CommonDirs.BundleOutputPath)
        : fs.mkdtempSync(path.join(os.tmpdir(), 'tachyon-bundle'));
    if (forLaunch)
        fs.rmSync(bundleTmpDir, { recursive: true, force: true });
    const bundleCodeDir = path.join(bundleTmpDir, 'code');
    const bundleContentDir = path.join(bundleTmpDir, 'content');
    const bundleTelkinDir = path.join(bundleContentDir, 'telkin');
    fs.mkdirSync(bundleCodeDir, { recursive: true });
    fs.mkdirSync(bundleTelkinDir, { recursive: true });
    let allTargets: string[] = getAllTargets(config);
    if (targetsOverride.length !== 0) {
        targetsOverride.forEach(override => {
            if (!allTargets.includes(override))
                abort(`Target "${override}" does not exist!`);
        });
        allTargets = allTargets.filter(tgt => targetsOverride.includes(tgt));
    }
    const TARGET_MAP = new Map<bigint, string>();
    for (const target of allTargets) {
        configureTarget(config, target, [], false);
        TARGET_MAP.set(config.targetTitleID!, target);
    }
    interface RPLInfo {
        rplPath: string;
        config: ProjectConfig;
    }
    const DEPS_RPL_MAP = new Map<bigint, RPLInfo[]>();
    const packagesDir = path.join(projectDir, CommonDirs.Packages);
    fs.mkdirSync(packagesDir, { recursive: true });
    const depDirs = fs.readdirSync(packagesDir);
    for (const depName of depDirs) {
        const depDir = path.join(packagesDir, depName);
        const outDir = path.join(depDir, CommonDirs.DefaultOutputPath);
        const depProjDir = validateProjectFolder(depDir);
        const depConfig = loadProjectConfig(depProjDir);
        const depAllTargets = getAllTargets(depConfig);
        for (const depTarget of depAllTargets) {
            configureTarget(depConfig, depTarget, [], false);
            const depTargetTitleID = depConfig.targetTitleID!;
            if (depTargetTitleID !== 0n && !TARGET_MAP.has(depTargetTitleID))
                continue;
            const rplPath = path.join(outDir, `${depConfig.name}${depConfig.freestanding ? '' : `,${depTarget}`}.rpl`);
            const rplList = DEPS_RPL_MAP.get(depTargetTitleID) ?? [];
            rplList.push({ rplPath, config: depConfig });
            DEPS_RPL_MAP.set(depTargetTitleID, rplList);
            if (depConfig.freestanding)
                continue;
            const depConsoleTargetTitleID = TitleID.addConsoleTag(depConfig.targetTitleID!);
            const consoleRplPath = path.join(outDir, `${depConfig.name},${depTarget},C.rpl`);
            const consoleRplList = DEPS_RPL_MAP.get(depConsoleTargetTitleID) ?? [];
            consoleRplList.push({ rplPath: consoleRplPath, config: depConfig });
            DEPS_RPL_MAP.set(depConsoleTargetTitleID, consoleRplList);
        }
        const contentPath = path.join(depProjDir, 'content');
        if (fs.existsSync(contentPath)) {
            if (!process.env.TACHYON_SUPPRESS_ASSET_CONFLICT) {
                findFileConflicts(contentPath, bundleContentDir).forEach(conflict => {
                    console.warn(`Asset conflict, overwriting ${prettifyBundlePath(conflict.dstPath)} with ${conflict.srcPath}`);
                });
            }
            fs.cpSync(contentPath, bundleContentDir, { recursive: true, force: true, mode: fs.constants.COPYFILE_FICLONE });
        }
    }
    const ownContentPath = path.join(projectDir, 'content');
    if (fs.existsSync(ownContentPath)) {
        const ownContentFilter = forLaunch ? undefined : createOwnContentFilter(projectDir);
        findFileConflicts(ownContentPath, bundleContentDir).forEach(conflict => {
            if (ownContentFilter && !ownContentFilter(conflict.srcPath))
                return;
            if (!process.env.TACHYON_SUPPRESS_ASSET_CONFLICT) {
                console.warn(`Asset conflict, overwriting ${prettifyBundlePath(conflict.dstPath)} with ${conflict.srcPath}`);
            }
            if (forLaunch)
                fs.rmSync(conflict.dstPath, { force: true });
        });
        if (!forLaunch) {
            fs.cpSync(ownContentPath, bundleContentDir, {
                recursive: true,
                force: true,
                mode: fs.constants.COPYFILE_FICLONE,
                filter: ownContentFilter,
            });
        }
        else {
            const ownFiles = fs.readdirSync(ownContentPath, { withFileTypes: true, recursive: true });
            for (const file of ownFiles) {
                if (file.isDirectory())
                    continue;
                const ownFullpath = path.join(file.parentPath, file.name);
                const contentDirSubpath = path.relative(ownContentPath, file.parentPath);
                const bundleHardlinkDir = path.join(bundleContentDir, contentDirSubpath);
                const bundleHardlinkPath = path.join(bundleHardlinkDir, file.name);
                fs.mkdirSync(bundleHardlinkDir, { recursive: true });
                fs.linkSync(ownFullpath, bundleHardlinkPath);
            }
        }
    }
    const FREESTANDING_RPLS = (DEPS_RPL_MAP.get(0n) ?? []);
    for (const { rplPath } of FREESTANDING_RPLS) {
        if (!fs.existsSync(rplPath)) {
            abort(`Freestanding RPL file "${path.basename(rplPath)}" is missing, but is required by your project.`);
        }
        fs.cpSync(rplPath, path.join(bundleCodeDir, path.basename(rplPath)), { mode: fs.constants.COPYFILE_FICLONE });
    }
    const CONSOLE_TARGET_MAP = new Map([...TARGET_MAP].map(([tid, name]) => [TitleID.addConsoleTag(tid), `${name},C`]));
    const FULL_TARGET_MAP = forLaunch ? TARGET_MAP : [...TARGET_MAP, ...CONSOLE_TARGET_MAP];
    for (const [targetTitleID, targetName] of FULL_TARGET_MAP) {
        const TARGET_RPLS = DEPS_RPL_MAP.get(targetTitleID || -1n) ?? [];
        TARGET_RPLS.push({
            rplPath: path.join(projectDir, CommonDirs.DefaultOutputPath, `${config.name},${targetName}.rpl`),
            config,
        });
        const ALL_RPLS = [
            ...FREESTANDING_RPLS.filter(rpl => !rpl.rplPath.endsWith('Telkin.rpl')),
            ...TARGET_RPLS,
        ];
        const CORE_MODS = ALL_RPLS.filter(mod => mod.config.type.startsWith('Core'));
        const STANDARD_MODS = ALL_RPLS.filter(mod => mod.config.type === 'Standard');
        const coreDir = path.join(bundleTelkinDir, hex(targetTitleID, 16, ''), 'core');
        const modsDir = path.join(bundleTelkinDir, hex(targetTitleID, 16, ''), 'mods');
        fs.mkdirSync(coreDir, { recursive: true });
        fs.mkdirSync(modsDir, { recursive: true });
        for (const { rplPath } of CORE_MODS) {
            fs.closeSync(fs.openSync(path.join(coreDir, path.basename(rplPath, '.rpl')), fs.constants.O_CREAT));
        }
        for (const { rplPath } of STANDARD_MODS) {
            fs.closeSync(fs.openSync(path.join(modsDir, path.basename(rplPath, '.rpl')), fs.constants.O_CREAT));
        }
        for (const { rplPath } of TARGET_RPLS) {
            if (!fs.existsSync(rplPath))
                abort(`RPL file "${path.basename(rplPath)}" is missing, but is required by your ${$.yellowBright(targetName).replace(',C', $.gray(' (Console)'))} target.`
                    + (rplPath.endsWith(',C.rpl') ? `\n        (Did you forget to compile with ${$.blueBright('--console')}?)` : '')
                    + `\n        ${$.gray('Hint: Use')} ${$.blueBright('tachyon package')} ${$.gray('to build every target automatically before bundling.')}`);
            fs.cpSync(rplPath, path.join(bundleCodeDir, path.basename(rplPath)), { mode: fs.constants.COPYFILE_FICLONE });
        }
    }
    {
        const telkinDepDir = path.join(projectDir, CommonDirs.Packages, 'Telkin');
        const telkinDepRealDir = fs.realpathSync(telkinDepDir);
        const telkinIsSymlink = fs.lstatSync(telkinDepDir).isSymbolicLink();
        const telkinLauncherFilesDir = !telkinIsSymlink ? CommonDirs.PkgIntermediate : path.join('..', 'launcher', 'cemu');
        const mainAsmPath = path.join(telkinDepRealDir, telkinLauncherFilesDir, 'main.asm');
        const mainAsmOutPath = path.join(bundleTmpDir, 'patch_Loader.asm');
        fs.copyFileSync(mainAsmPath, mainAsmOutPath, fs.constants.COPYFILE_FICLONE);
        const rulesTxtPath = path.join(telkinDepRealDir, telkinLauncherFilesDir, 'rules.txt');
        const rulesTxtOutPath = path.join(bundleTmpDir, 'rules.txt');
        const titleIDList = [...TARGET_MAP.keys()].map(tid => hex(tid, 16, '')).join(',');
        const rulesTxt = fs.readFileSync(rulesTxtPath, 'utf-8')
            .replaceAll('${PLACEHOLDER_NAME}', config.name)
            .replaceAll('${PLACEHOLDER_DESC}', config.description)
            .replaceAll('${PLACEHOLDER_TITLEIDS}', titleIDList);
        fs.writeFileSync(rulesTxtOutPath, rulesTxt, 'utf-8');
    }
    if (!forLaunch) {
        const outputBundleZipPath = path.join(projectDir, CommonDirs.DefaultOutputPath, `bundle-${config.name}-${config.version}.zip`);
        fs.rmSync(outputBundleZipPath, { recursive: true, force: true });
        for (const file of fs.readdirSync(bundleTmpDir, { recursive: true, withFileTypes: true })) {
            if (file.isDirectory())
                continue;
            if (file.name === '.DS_Store')
                fs.rmSync(path.join(file.parentPath, file.name), { force: true });
            if (file.name === 'desktop.ini')
                fs.rmSync(path.join(file.parentPath, file.name), { force: true });
        }
        await archiveFolder(bundleTmpDir, outputBundleZipPath, {
            compressionLevel: 9,
            followSymlinks: true,
            mode: 0o644,
            mtime: new Date(Date.UTC(2026)),
        });
        console.success(`${$.greenBright.bold('[✓ SUCCESS]')} Bundle with targets [${allTargets.join(', ')}] saved at: ${$.cyanBright(outputBundleZipPath)}`);
    }
}
function createOwnContentFilter(projectDir: string): ((source: string) => boolean) | undefined {
    const gitignorePath = path.join(projectDir, '.gitignore');
    if (!fs.existsSync(gitignorePath))
        return undefined;
    const rules = fs.readFileSync(gitignorePath, 'utf8')
        .split('\n')
        .map(line => line.trimEnd())
        .flatMap(line => {
        const negated = line.startsWith('!');
        const pattern = negated ? line.slice(1) : line;
        return pattern.startsWith('/content/')
            ? [{ pattern: pattern.slice(1).replace(/\/$/, ''), negated }]
            : [];
    });
    if (rules.length === 0)
        return undefined;
    return source => {
        const relativeSource = path.relative(projectDir, source).split(path.sep).join('/');
        let included = true;
        for (const rule of rules) {
            if (path.posix.matchesGlob(relativeSource, rule.pattern))
                included = rule.negated;
        }
        return included;
    };
}
function prettifyBundlePath(path: string): string {
    const tokenIndex = path.indexOf('tachyon-bundle');
    let nextSlashIndex = path.indexOf('/', tokenIndex);
    if (nextSlashIndex === -1) {
        nextSlashIndex = path.indexOf('\\');
    }
    return path.slice(nextSlashIndex + 1);
}
