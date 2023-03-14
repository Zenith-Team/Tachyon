import $ from 'chalk';
import fs from 'fs';
import util from 'util';
import path from 'path';
import chp from 'child_process';
import { Tail } from 'tail';
import { abort } from './utils.js';
import { getProcessInfo } from './procinfo.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function launch() {
    const cwd = process.cwd();
    const {
        positionals: [rpxPathRaw], values: {
            cemu, game,
            fullscreen,
            allow, block
        }
    } = util.parseArgs({
        args: process.argv.slice(3),
        allowPositionals: true,
        options: {
            cemu: { type: 'string', short: 'c', default: process.env.CEMU_ROOT },
            game: { type: 'string', short: 'g', default: process.env.TACHYON_DEFAULT_GAME_ROOT },
            fullscreen: { type: 'boolean', short: 'f', default: false },
            allow: { type: 'string', short: 'A', multiple: true, default: [] },
            block: { type: 'string', short: 'B', multiple: true, default: [] },
        }
    });

    const logTypes = new Set(['all', 'time', 'init', 'iosu', 'vulkan', 'osconsole', 'osprefix', 'crashlog'] as const);
    type LogTypes = typeof logTypes extends Set<infer T> ? T : never;
    const allowedLogs = new Set<LogTypes>(allow as LogTypes[]);
    const blockedLogs = new Set<LogTypes>(block as LogTypes[]);
    if (allowedLogs.size && blockedLogs.size) abort('Cannot allow and block logs at the same time.');
    allowedLogs.forEach(a => { if (!logTypes.has(a)) abort(`Unknown allowed log type: ${a} (Must be one of: ${[...logTypes.values()].join(', ')})`); });
    blockedLogs.forEach(b => { if (!logTypes.has(b)) abort(`Unknown blocked log type: ${b} (Must be one of: ${[...logTypes.values()].join(', ')})`); });
    const activeLogs = new Set<LogTypes>();
    if (allowedLogs.has('all')) {
        if (allowedLogs.size > 1) abort('Cannot allow all logs and other logs at the same time.');
        logTypes.forEach(t => (allowedLogs.add(t), activeLogs.add(t)));
    } else if (allowedLogs.size) {
        allowedLogs.forEach(t => activeLogs.add(t));
        activeLogs.delete('all');
    }
    if (blockedLogs.has('all')) {
        if (blockedLogs.size > 1) abort('Cannot block all logs and other logs at the same time.');
        logTypes.forEach(t => blockedLogs.add(t)); activeLogs.clear();
    } else if (blockedLogs.size) {
        logTypes.forEach(t => { if (!blockedLogs.has(t)) activeLogs.add(t); });
        activeLogs.delete('all');
    }
    if (!activeLogs.size && !blockedLogs.has('all')) logTypes.forEach(t => activeLogs.add(t));

    if (!rpxPathRaw) abort('No RPX/ELF file provided! The first positional argument must be the path to the RPX/ELF file to launch.');
    if (!cemu) abort('No Cemu path provided! The CEMU_ROOT environment variable is not set, and no path was provided with the --cemu option.');
    if (!game) abort('No game path provided! The TACHYON_DEFAULT_GAME_ROOT environment variable is not set, and no path was provided with the --game option.');
    const rpxPath = path.resolve(cwd, rpxPathRaw);
    const gamePath = path.resolve(cwd, game);
    const cemuPath = path.resolve(cwd, cemu);
    const cemuExe = path.join(cemuPath, 'Cemu.exe');
    if (!fs.existsSync(rpxPath)) abort('RPX/ELF file not found!');
    if (!fs.existsSync(gamePath)) abort('Game path not found!');
    if (!fs.existsSync(cemuPath)) abort('Cemu path not found!');
    if (!fs.existsSync(cemuExe)) abort(`Cemu path is invalid! No Cemu.exe found at the given folder! (Path searched: ${cemuExe})`);

    const gameFolders = fs.readdirSync(gamePath);
    const gamePathBasename = path.basename(gamePath);
    if (gamePathBasename.toLowerCase().endsWith('rpx') || gamePathBasename.toLowerCase().endsWith('elf')) {
        abort('The game path must be the root folder of the game, not the RPX/ELF file! (Go one folder up)');
    }
    ['code', 'meta', 'content'].forEach(folder => {
        if (!gameFolders.includes(folder)) abort(
            `Game path is invalid! No "${folder}" folder found in the given folder!` +
            gamePathBasename === folder ? ` (Did you give the "${folder}" folder path instead of the root folder? Go one folder up)` : ''
        );
    });
    
    // If we don't check this edge case and ammend it, we may inadvertently overwrite the real vanilla RPX with the modified one
    fs.readdirSync(path.join(gamePath, 'code')).forEach(file => {
        if (file.endsWith('.disabled')) {
            console.warn(`Found disabled file ${file} from a previous launch which failed to cleanup! Restoring file...`);
            fs.renameSync(path.join(gamePath, 'code', file), path.join(gamePath, 'code', file.slice(0, -9)));
        }
    });
    
    const cosxmlPath = path.join(gamePath, 'code', 'cos.xml');
    let originalPrefRpxPath: string | null = null;
    if (fs.existsSync(cosxmlPath)) {
        console.info('cos.xml found! Scanning for preferred RPX filename...');
        const cosxml = fs.readFileSync(cosxmlPath, 'utf8');
        const matches = cosxml.match(/<argstr.*?> *(.+?\.rpx) *?<\/argstr *?>/);
        if (matches) {
            const [, prefRpx] = matches as [string, string];
            console.success(`${$.bold('[+]')} Preferred RPX filename found: ${prefRpx}`);
            const prefRpxPath = path.join(gamePath, 'code', prefRpx);
            if (fs.existsSync(prefRpxPath)) {
                console.success(`${$.bold('[+]')} Preferred RPX file found, temporarily disabling it to prevent conflicts...`);
                fs.renameSync(prefRpxPath, `${prefRpxPath}.disabled`);
                originalPrefRpxPath = prefRpxPath;
            } else {
                console.info(`Preferred RPX file not found, no action required.`);
            }
        } else console.info('Preferred RPX filename not found in cos.xml, no action required.');
    }

    process.once('SIGINT', () => {
        console.warn('SIGINT received, cleaning up...');
        cleanup();
        process.exit(0);
    });

    let finalGamePath: string;
    if (originalPrefRpxPath) {
        console.info('Copying custom RPX/ELF to preferred RPX file location...');
        fs.cpSync(rpxPath, originalPrefRpxPath);
        finalGamePath = originalPrefRpxPath;
    } else {
        console.info('Copying custom RPX/ELF to game folder...');
        finalGamePath = path.join(gamePath, 'code', path.basename(rpxPath));
        fs.cpSync(rpxPath, finalGamePath);
    }

    console.info('Launching Cemu...');
    const cemuProc = chp.spawn(cemuExe, [
        '-g', finalGamePath,
        fullscreen ? '-f' : ''
    ], {
        stdio: 'ignore', detached: true
    });

    cemuProc.on('spawn', () => {
        const cemuPid = cemuProc.pid!;
        const cemuInfo = getProcessInfo(cemuPid);
        if (!cemuInfo) cleanup(), abort('Failed to get Cemu process info!');
        let cemuWindowTitle = cemuInfo.windowtitle;
        let tries = 0;
        while (tries < 100 && (cemuWindowTitle === 'N/A' || cemuWindowTitle === 'OleMainThreadWndName')) {
            cemuWindowTitle = getProcessInfo(cemuPid)!.windowtitle;
            tries++;
        }
        if (cemuWindowTitle === 'N/A' || !cemuWindowTitle) cleanup(), abort('Failed to get Cemu window title!');
        if (!cemuWindowTitle.startsWith('Cemu')) cleanup(), abort(
            `Failed to properly launch Cemu! This likely a Tachyon bug, please report it! (Window title was: ${cemuWindowTitle})`
        );
        if (cemuWindowTitle.startsWith('Cemu 2')) cleanup(), cemuProc.kill(), abort('Cemu 2.0+ is not supported! Please use Cemu 1.26.2f or lower.');
        if (cemuWindowTitle.startsWith('Cemu 1.27')) cleanup(), cemuProc.kill(), abort('Cemu 1.27 is not supported! Please use Cemu 1.26.2f or lower.');
        if (process.env.TACHYON_DEBUG) {
            console.debug(`Cemu PID: ${cemuPid}`);
            console.debug(`Cemu initial window title: ${cemuWindowTitle}`);
            console.debug(`Took ${tries} tries to get Cemu window title.`);
        }
        const int = setInterval(() => {
            const newInfo = getProcessInfo(cemuPid);
            if (!newInfo) clearInterval(int); // Cemu closed
            else {
                const newWindowTitle = newInfo.windowtitle!;
                if (newWindowTitle !== cemuWindowTitle) {
                    cemuWindowTitle = newWindowTitle;
                    if (process.env.TACHYON_DEBUG) console.debug(`Window title changed to ${newWindowTitle}`);
                    if (cemuWindowTitle.includes('FPS')) {
                        clearInterval(int); // Game is running
                        onGameRunning(cemuWindowTitle);
                    }
                }
            }
        }, 500);
    });

    cemuProc.once('exit', code => {
        if (code) console.error(`Cemu exited with code ${code ?? 'null'}`);
        else console.success(`${$.bold('[+]')} Cemu exited gracefully.`);
        cleanup(!!code);
    });

    let tail: Tail | null = null;
    let crashlogMode: boolean = false;
    const logPath = path.join(cemuPath, 'log.txt');

    function onGameRunning(finalWindowTitle: string) {
        console.success(`${$.bold('[+]')} Game running!`);
        const matches = finalWindowTitle.match(
            /FPS: [\d.,]+? \[([\w -]+?)\] \[([\w -]+?)\] \[TitleId: ([\dA-Fa-f]+?-??[\dA-Fa-f]+?)\] (.+?) \[(\w+?) (v\d+?)\]/
        );
        if (!matches) console.warn('Failed to parse Cemu & game info from window title!');
        else {
            if (process.env.TACHYON_DEBUG) {
                const [
                    , graphicAPI, gpuVendor, titleID, gameName, gameRegion, gameVersion
                ] = matches as [string, string, string, string, string, string, string];
                console.debug('Parsed Cemu & game info:'
                            + `\n- Graphic API: ${graphicAPI}`
                            + `\n- GPU vendor: ${gpuVendor}`
                            + `\n- Game name: ${gameName}`
                            + `\n- Title ID: ${titleID}`
                            + `\n- Game region: ${gameRegion}`
                            + `\n- Game version: ${gameVersion}`);
            }
        }

        const activeLogsPrint = activeLogs.has('all') ? ['all'] : [...activeLogs.values()];
        console.info(`Now tracking Cemu log file. (Active logs: ${activeLogsPrint.join(', ')})`);
        tail = new Tail(logPath, { fromBeginning: true, useWatchFile: true, fsWatchOptions: { interval: 500 } });

        let pastInitialLogs = false;
        const cemuPrefix = $.cyanBright.bold('[CEMU]');
        const crashPrefix = $.bgRedBright.black.bold('[CEMU:CRASH]');
        tail.on('line', (data: string) => {
            if (data.includes('Crashlog for Cemu')) {
                if (!activeLogs.has('crashlog')) console.error(`Cemu has crashed! (Crashlog suppressed due to your current logging settings)`);
                crashlogMode = true;
            }
            if (!crashlogMode) {
                if (activeLogs.has('all')) return console.log(`${cemuPrefix} ${data}`);
                const timeless = /^\[\d\d:\d\d:\d\d\] /.test(data) ? data.slice(11) : data;
                if (timeless.trim() === '------- Run title -------') pastInitialLogs = true;
                if (!activeLogs.has('init') && !pastInitialLogs) return;
                if (!activeLogs.has('time')) data = timeless;
                if (!activeLogs.has('vulkan') && timeless.startsWith('Vulkan-Info: ')) return;
                //if (!activeLogs.has('opengl') && timeless.startsWith('OpenGL-Info: ')) return;
                if (!activeLogs.has('iosu') && timeless.startsWith('IOSU_')) return;
                if (timeless.startsWith('OSConsoleWrite: ')) {
                    if (!activeLogs.has('osconsole')) return;
                    if (!activeLogs.has('osprefix')) {
                        if (data === timeless) data = data.slice(16);
                        else data = data.slice(0, 11) + data.slice(27);
                    }
                }
                console.log(`${cemuPrefix} ${data}`);
            } else if (activeLogs.has('crashlog')) {
                console.log(`${crashPrefix} ${$.redBright(data)}`);
            }
        });
        tail.on('error', (error) => {
            console.warn('Tail failure on log.txt:', error);
        });
    }

    function cleanup(crashed = false) {
        if (originalPrefRpxPath) {
            console.info('cleanup: Restoring original preferred RPX file over custom RPX...');
            fs.renameSync(`${originalPrefRpxPath}.disabled`, originalPrefRpxPath);
            console.success(`${$.bold('[+]')} cleanup: Original preferred RPX file restored.`);
        } else {
            console.info('cleanup: Deleting custom RPX/ELF file from game folder...');
            fs.rmSync(finalGamePath, { force: true });
            console.success(`${$.bold('[+]')} cleanup: Custom RPX/ELF file deleted.`);
        }
        if (crashed) crashlogMode = true;
        if (tail) setTimeout(() => {
            tail?.unwatch();
            console.info(`Full CEMU logs saved at: ${$.cyanBright(logPath)}`);
            console.success('Game session ended.');
        }, 1100);
        process.removeAllListeners('SIGINT');
    }
}
