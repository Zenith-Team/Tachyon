import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { abort, CommonDirs, getAllTargets, hex, randomShortUUID, trySymlink, validateProjectFolder } from '../../utils.js';
import { configureTarget, loadProjectConfig } from '../../shared/projectconfig.js';
import { findCemuBinary } from './cemu-bin-handler.js';
import { findCemuFolders } from './cemu-dir-handler.js';
import { bundleProject } from '../bundle.js';
import { type LogConfig, type LogTypes, ValidLogTypes, runCemu } from './cemu-runner.js';
export async function cli_handler(args: string[]): Promise<void> {
    const { positionals: targets, values: { cemu, fullscreen, allow, block, interpreter, 'multicore-interpreter': mcInterpreter, manual, } } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {
            cemu: { type: 'string', short: 'c', default: process.env.CEMU_BIN },
            allow: { type: 'string', short: 'A', multiple: true, default: [] },
            block: { type: 'string', short: 'B', multiple: true, default: [] },
            fullscreen: { type: 'boolean', short: 'f', default: false },
            interpreter: { type: 'boolean', short: 'i', default: false },
            'multicore-interpreter': { type: 'boolean', short: 'I', default: false },
            manual: { type: 'boolean', short: 'm', default: false },
        }
    });
    const projectDir = validateProjectFolder();
    const config = loadProjectConfig(projectDir);
    if (config.type === 'Special')
        abort('Cannot launch Special module.');
    if (config.freestanding)
        abort('Cannot launch freestanding module.');
    if (interpreter && mcInterpreter)
        abort('Cannot use both --interpreter/-i and --multicore-interpreter/-I flags at the same time.');
    const cemuFlags: string[] = [
        fullscreen ? '-f' : '',
        interpreter ? '--force-interpreter' : '',
        mcInterpreter ? '--force-multicore-interpreter' : '',
        (new Date().getMonth() === 3 && new Date().getDate() === 1) ? '--ud' : '',
    ];
    const allTargets = getAllTargets(config);
    if (targets.length === 0)
        abort('No target specified! The first positional argument must be the target to launch (Target must have been built).');
    if (targets.length > 1)
        abort('Cannot launch multiple targets at once.');
    const target = targets[0]!;
    if (!allTargets.includes(target))
        abort(`Target "${target}" does not exist in this project or is not launchable due to being AbstractOnly.`);
    configureTarget(config, target, [], false);
    const gameTitleID = hex(config.targetTitleID!, 16, '');
    const cemuBinary = findCemuBinary(cemu);
    const cemuFolders = findCemuFolders(cemuBinary);
    console.debug('Using TitleID:', gameTitleID, '\nUsing Cemu bin:', cemuBinary, '\nUsing Cemu dirs:', cemuFolders);
    await bundleProject([target], true);
    const bundleDir = path.join(projectDir, CommonDirs.BundleOutputPath);
    const tachyonLaunchGfxDir = path.join(cemuFolders.root, 'graphicPacks', '.tachyonLaunchGraphicPacks');
    fs.rmSync(tachyonLaunchGfxDir, { recursive: true, force: true });
    fs.mkdirSync(tachyonLaunchGfxDir, { recursive: true });
    const gfxpackIdentifier = `${config.name},${target},${randomShortUUID()}`;
    const gfxpackDir = path.join(tachyonLaunchGfxDir, gfxpackIdentifier);
    const symlinkOK = trySymlink(gfxpackDir, bundleDir);
    if (!symlinkOK) {
        console.warn('Falling back to folder copy due to symlink error!');
        fs.mkdirSync(gfxpackDir, { recursive: true });
        fs.cpSync(bundleDir, gfxpackDir, { recursive: true, force: true, mode: fs.constants.COPYFILE_FICLONE });
    }
    const settingsXMLPath = path.join(cemuFolders.config, 'settings.xml');
    addGfxpackToSettingsXML(settingsXMLPath, symlinkOK ? path.relative(cemuFolders.root, bundleDir) : `graphicPacks/.tachyonLaunchGraphicPacks/${gfxpackIdentifier}`);
    const logFilePath = path.join(cemuFolders.root, 'log.txt');
    fs.rmSync(logFilePath, { force: true });
    const logConfig = resolveLogConfig(allow, block);
    const cemuOK = await runCemu({ cemuBinary, gameTitleID, manual, cemuFlags, logConfig, logFilePath });
    void cemuOK;
}
function addGfxpackToSettingsXML(settingsXMLPath: string, gfxpackPath: string) {
    const settingsXML = fs.readFileSync(settingsXMLPath, 'utf8')
        .replaceAll(/[ \t]*<Entry filename="graphicPacks\/\.tachyonLaunchGraphicPacks\/[^>]+\/>(?:\n|\r\n)?/g, '')
        .replaceAll(/[ \t]*<Entry filename="\.\.\/.+\/out\/bundle\/rules\.txt"[ \t]*\/>(?:\n|\r\n)?/g, '');
    const gfxpackListIndex = settingsXML.indexOf('<GraphicPack>');
    const gfxpackListEndIndex = settingsXML.indexOf('</GraphicPack>');
    if (gfxpackListIndex === -1)
        abort('Corrupt Cemu settings.xml (O)');
    if (gfxpackListEndIndex === -1)
        abort('Corrupt Cemu settings.xml (C)');
    const gfxpackTagLen = '<GraphicPack>'.length;
    const gfxpackListXML = settingsXML.slice(gfxpackListIndex + gfxpackTagLen, gfxpackListEndIndex);
    const indentMatch = /^[\n\r]*([ \t]*)/.exec(gfxpackListXML);
    const indent = indentMatch?.[1] ?? ' '.repeat(8);
    const tachyonGfxEntry = `<Entry filename="${path.join(gfxpackPath, 'rules.txt').replaceAll('\\', '/')}"/>`;
    const newGfxpackListXML = '\n' + indent + tachyonGfxEntry + gfxpackListXML;
    const xmlPreGfxpacks = settingsXML.slice(0, gfxpackListIndex + gfxpackTagLen);
    const xmlPostGfxpacks = settingsXML.slice(gfxpackListEndIndex);
    const newSettingsXML = xmlPreGfxpacks + newGfxpackListXML + xmlPostGfxpacks;
    fs.writeFileSync(settingsXMLPath, newSettingsXML, 'utf8');
}
function resolveLogConfig(allow: string[], block: string[]): LogConfig {
    if (allow.length === 0 && block.length === 0)
        return {
            time: false,
            init: false,
            iosu: false,
            libusb: false,
            asserts: false,
            osprefix: false,
            shader_errors: false,
            osconsole: true,
            rplloader: true,
            crashlog: true,
        } satisfies LogConfig;
    if (allow.includes('all')) {
        if (allow.length !== 1 || block.length !== 0)
            abort('Cannot specify other log flags when allowing all logs.');
        allow = [...ValidLogTypes];
    }
    if (block.includes('all')) {
        if (block.length !== 1 || allow.length !== 0)
            abort('Cannot specify other log flags when blocking all logs.');
        block = [...ValidLogTypes];
    }
    const userAllowedLogs = new Set<LogTypes>(allow as LogTypes[]);
    const userBlockedLogs = new Set<LogTypes>(block as LogTypes[]);
    if (userAllowedLogs.size && userBlockedLogs.size)
        abort('Cannot allow and block log types at the same time.');
    const blockMode = userBlockedLogs.size > 0;
    const logConfig = Object.fromEntries(ValidLogTypes.entries().map(e => [e[0], blockMode] as const)) as LogConfig;
    userAllowedLogs.forEach(A => {
        if (!ValidLogTypes.has(A))
            abort(`Unknown allowed log type: ${A} (Must be one of: ${[...ValidLogTypes.values()].join(', ')})`);
        logConfig[A] = true;
    });
    userBlockedLogs.forEach(B => {
        if (!ValidLogTypes.has(B))
            abort(`Unknown blocked log type: ${B} (Must be one of: ${[...ValidLogTypes.values()].join(', ')})`);
        logConfig[B] = false;
    });
    return logConfig;
}
