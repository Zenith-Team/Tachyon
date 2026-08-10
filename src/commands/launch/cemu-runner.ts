import $ from 'chalk';
import fs from 'node:fs';
import chp from 'node:child_process';
import { abort, TitleID } from '../../utils.js';
import { Tail } from '../../utils/tail.js';
export function runCemu({ cemuBinary, gameTitleID, manual, cemuFlags, logConfig, logFilePath }: {
    cemuBinary: string;
    gameTitleID: string;
    manual: boolean;
    cemuFlags: string[];
    logConfig: LogConfig;
    logFilePath: string;
}) {
    console.info('Launching Cemu...');
    if (!manual)
        cemuFlags.push('-t', gameTitleID);
    const cemuProc = chp.spawn(cemuBinary, cemuFlags, { stdio: 'ignore' });
    if (!cemuProc.pid || cemuProc.killed || cemuProc.exitCode !== null)
        abort('Failed to start Cemu!');
    const { promise, resolve } = Promise.withResolvers<boolean>();
    let tail: Tail | undefined;
    process.once('SIGINT', () => {
        console.warn('SIGINT received, stopping...');
        if (!cemuProc.kill())
            cemuProc.kill('SIGKILL');
    });
    const exitHandler = async (code: number | Error | null | undefined) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (code === 0)
            console.success(`${$.bold('[+]')} Cemu exited gracefully.`);
        else {
            if (typeof code === 'number')
                console.error(`Cemu exited with code ${code}`);
            else
                console.error(`Cemu exited with error ${code?.message ?? '(unknown)'}`);
        }
        console.success(`Full CEMU logs saved at: ${$.cyanBright(logFilePath)}`);
        process.removeAllListeners('SIGINT');
        tail?.unwatch();
        resolve(code === 0);
    };
    cemuProc.once('error', exitHandler);
    cemuProc.once('exit', exitHandler);
    cemuProc.on('spawn', async () => {
        const activeLogsPrint = Object.entries(logConfig).sort().map(([k, v]) => v ? $.green(k) : $.dim.red(k));
        console.success(`${$.bold('[+]')} Cemu is running, waiting for logs... (Log config: ${activeLogsPrint.join($.gray(', '))})`);
        console.debug('Searching for Cemu log file at:', logFilePath);
        const useFallbackPolling = await new Promise<boolean>(resolve => {
            let tries = 0;
            const interval = setInterval(() => {
                if (cemuProc.killed)
                    clearInterval(interval);
                tries++;
                if (fs.existsSync(logFilePath)) {
                    clearInterval(interval);
                    resolve(false);
                }
                else if (tries >= 50) {
                    if (manual) {
                        clearInterval(interval);
                        resolve(true);
                        return;
                    }
                    if (!cemuProc.kill())
                        cemuProc.kill('SIGKILL');
                    abort(`Could not get Cemu log file within 10 seconds of launch, assuming failure.\nLog path tried: ${logFilePath}`);
                }
            }, 200);
        });
        if (useFallbackPolling) {
            console.warn("It appears you have not launched the game/app yet.\nDue to --manual flag being active, Tachyon will not abort and continue waiting indefinitely for you to run the game/app.\n" +
                $.underline('NOTE: After this message appears, the polling rate of initial log detection slows down to once every 5 seconds, logging may have a delayed start.\n'));
            await new Promise<void>(resolve => {
                const interval = setInterval(() => {
                    if (cemuProc.killed)
                        clearInterval(interval);
                    if (fs.existsSync(logFilePath)) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 5000);
            });
        }
        enum CemuLogHeading {
            INIT_CEMU = '------- Init Cemu 0000000 -------',
            INIT_GFX_VULKAN = '------- Init Vulkan graphics backend -------',
            LOADED_TITLE = '------- Loaded title -------',
            ACTIVE_SETTINGS = '------- Active settings -------',
            INIT_GFX_OPENGL = '------- Init OpenGL graphics backend -------',
            ACTIVE_GFXPACKS = '------- Activate graphic packs -------',
            INIT_AUDIO_OUTPUT = '------- Init Audio backend -------',
            INIT_AUDIO_INPUT = '------- Init Audio input backend -------',
            RUN_TITLE = '------- Run title -------'
        }
        const logState = {
            __prevLine: '',
            crashlogMode: false,
            pastInitialLogs: false,
            assertCounter: 0,
            inShaderErrList: false,
            currentHeading: CemuLogHeading.INIT_CEMU,
            graphicsAPI: CemuGraphicsAPI.Unknown,
        };
        const appPrefix = $.blue.bold.dim(' [APP]');
        const cemuPrefix = $.cyan.bold('[CEMU]');
        const crashPrefix = $.bgRed.black.bold('[CEMU:CRASH]');
        tail = new Tail(logFilePath, { pollingInterval: 750 });
        tail.on('line', (line: string): void => {
            const prevLine = logState.__prevLine;
            logState.__prevLine = line;
            const lineRaw = line;
            const timeless = /^\[\d\d:\d\d:\d\d\.\d{3}\] /.test(line) ? line.slice(15) : line;
            if (!logConfig.time)
                line = timeless;
            let activePrefix: string = cemuPrefix;
            if (!logState.crashlogMode && lineRaw === "-----------------------------------------")
                return;
            if (prevLine === "-----------------------------------------") {
                if (lineRaw === '   Game info') {
                    if (!logConfig.crashlog)
                        console.log($.underline.red(`${$.bold('[-]')} Cemu has crashed! (Crashlog suppressed due to your current logging settings)`));
                    else
                        console.log(`${crashPrefix} ${$.red(prevLine)}`);
                    logState.crashlogMode = true;
                }
                else if (!logState.crashlogMode) {
                    console.log(`${activePrefix} ${prevLine}`);
                }
            }
            if (logState.crashlogMode) {
                if (logConfig.crashlog) {
                    line = line.replaceAll(/\b(0x)?([\da-fA-F]{8})\b/g, (_, prefix: string | undefined, hex: string) => {
                        prefix ??= '';
                        return $.redBright(prefix + hex.toUpperCase());
                    });
                    console.log(`${crashPrefix} ${$.red(line)}`);
                }
                return;
            }
            if (!logState.pastInitialLogs) {
                switch (timeless) {
                    case CemuLogHeading.LOADED_TITLE:
                        logState.currentHeading = CemuLogHeading.LOADED_TITLE;
                        break;
                    case CemuLogHeading.INIT_GFX_VULKAN:
                        logState.currentHeading = CemuLogHeading.INIT_GFX_VULKAN;
                        break;
                    case CemuLogHeading.INIT_GFX_OPENGL:
                        logState.currentHeading = CemuLogHeading.INIT_GFX_OPENGL;
                        break;
                    case CemuLogHeading.ACTIVE_SETTINGS:
                        logState.currentHeading = CemuLogHeading.ACTIVE_SETTINGS;
                        break;
                    case CemuLogHeading.ACTIVE_GFXPACKS:
                        logState.currentHeading = CemuLogHeading.ACTIVE_GFXPACKS;
                        break;
                    case CemuLogHeading.INIT_AUDIO_OUTPUT:
                        logState.currentHeading = CemuLogHeading.INIT_AUDIO_OUTPUT;
                        break;
                    case CemuLogHeading.INIT_AUDIO_INPUT:
                        logState.currentHeading = CemuLogHeading.INIT_AUDIO_INPUT;
                        break;
                    case CemuLogHeading.RUN_TITLE: {
                        logState.currentHeading = CemuLogHeading.RUN_TITLE;
                        logState.pastInitialLogs = true;
                        if (logState.graphicsAPI === CemuGraphicsAPI.Unknown) {
                            if (process.platform === 'darwin')
                                logState.graphicsAPI = CemuGraphicsAPI.Metal;
                        }
                        console.info($.italic(`Active graphics API: ${$.magenta(CemuGraphicsAPI[logState.graphicsAPI])}`));
                        break;
                    }
                }
                switch (logState.currentHeading) {
                    case CemuLogHeading.LOADED_TITLE: {
                        const [label, value] = timeless.split(':').map(s => s.trim());
                        if (!value)
                            break;
                        switch (label) {
                            case 'TitleId': {
                                const launchedTID = TitleID.parse(value)!;
                                const requiredTID = TitleID.parse(gameTitleID)!;
                                if (launchedTID !== requiredTID) {
                                    if (!cemuProc.kill())
                                        cemuProc.kill('SIGKILL');
                                    if (manual)
                                        abort($.bold('Whoops! It appears you have launched the wrong title (or region) for this launch!\n\n') +
                                            `> The ${$.underline('game/app you just launched')} has the title ID: ${$.red(TitleID.format(launchedTID))}\n` +
                                            `> The ${$.underline('requested launch target')} is for the title ID: ${$.green(TitleID.format(requiredTID))}\n\n` +
                                            `Please re-run the command and launch the correct title, or remove the ${$.yellow('--manual')} flag and let Cemu handle it for you.`);
                                    else
                                        throw new Error('Fatal launch failure, requested and launched title IDs do not match.');
                                }
                                break;
                            }
                        }
                        break;
                    }
                    case CemuLogHeading.INIT_GFX_VULKAN: {
                        logState.graphicsAPI = CemuGraphicsAPI.Vulkan;
                        break;
                    }
                    case CemuLogHeading.INIT_GFX_OPENGL: {
                        logState.graphicsAPI = CemuGraphicsAPI.OpenGL;
                        break;
                    }
                }
                if (!logConfig.init)
                    return;
            }
            if (timeless.startsWith('[OSConsole] ')) {
                if (!logConfig.osconsole)
                    return;
                if (!logConfig.osprefix) {
                    if (line === timeless)
                        line = line.slice(12);
                    else
                        line = line.slice(0, 15) + line.slice(27);
                }
                activePrefix = appPrefix;
            }
            if (!logConfig.asserts) {
                if (/^Encountered .+? assert!/.test(timeless))
                    return void (logState.assertCounter = 1);
                if (timeless.startsWith('File: ') && logState.assertCounter === 1)
                    return void (logState.assertCounter = 2);
                if (timeless.startsWith('Func: ') && logState.assertCounter === 2)
                    return void (logState.assertCounter = 3);
                if (timeless.startsWith('Message: ') && logState.assertCounter === 3)
                    return void (logState.assertCounter = 4);
                logState.assertCounter = 0;
            }
            if (!logConfig.shader_errors) {
                if (timeless === 'Error/Warning in shader:')
                    return void (logState.inShaderErrList = true);
                if (logState.inShaderErrList && /^\d+:\d+\(\d+\): (?:error|warning): /.test(timeless))
                    return;
                logState.inShaderErrList = false;
            }
            if (!logConfig.iosu && /^IOSU[-_].+?: /.test(timeless))
                return;
            if (!logConfig.libusb && timeless.startsWith('nsyshid::BackendLibusb: '))
                return;
            if (!logConfig.rplloader && /^Load(ing|ed) (RPL: |module '.+?' with checksum 0x)/.test(timeless))
                return;
            console.log(`${activePrefix} ${line}`);
        });
    });
    return promise;
}
export type LogConfig = Record<LogTypes, boolean>;
export type LogTypes = typeof _validLogTypeList[number];
const _validLogTypeList = [
    'time', 'init', 'crashlog',
    'osconsole', 'osprefix',
    'iosu', 'libusb', 'rplloader',
    'asserts', 'shader_errors',
] as const;
export const ValidLogTypes: ReadonlySet<LogTypes> = new Set(_validLogTypeList);
enum CemuGraphicsAPI {
    Unknown = 0,
    OpenGL = 1,
    Vulkan = 2,
    Metal = 3
}
