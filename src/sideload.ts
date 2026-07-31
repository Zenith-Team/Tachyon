import $ from 'chalk';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { abort, CommonDirs, CommonFiles } from './utils.js';
declare global {
    interface Console {
        success(...data: unknown[]): void;
    }
}
if (process.env.TACHYON_DEBUG === '0')
    Reflect.deleteProperty(process.env, 'TACHYON_DEBUG');
const consoleDebug = console.debug;
if (process.env.TACHYON_DEBUG) {
    console.debug = (...data) => consoleDebug($.bold.gray('[DEBUG]'), ...data.map(d => typeof d === 'string' ? $.gray(d) : d as unknown));
}
else {
    console.debug = () => void 0;
}
const consoleError = console.error;
const consoleWarn = console.warn;
const consoleInfo = console.info;
console.error = (...data) => consoleError($.bold.redBright('[ERROR]'), ...data.map(d => typeof d === 'string' ? $.redBright(d) : d as unknown));
console.warn = (...data) => consoleWarn($.bold.yellowBright('[WARN]'), ...data.map(d => typeof d === 'string' ? $.yellowBright(d) : d as unknown));
console.info = (...data) => consoleInfo($.bold.blueBright('[INFO]'), ...data.map(d => typeof d === 'string' ? $.blueBright(d) : d as unknown));
console.success = (...data) => console.log(...data.map(d => typeof d === 'string' ? $.greenBright(d) : d));
if (!process.env.TACHYON_HOME!) {
    const chosenHomeDir = process.env.XDG_CONFIG_HOME
        ? path.join(process.env.XDG_CONFIG_HOME, CommonDirs.TachyonHome)
        : path.join(os.homedir(), '.config', CommonDirs.TachyonHome);
    Reflect.set(process.env, 'TACHYON_HOME', chosenHomeDir);
    process.env.TACHYON_HOME_USING_DEFAULT = '1';
}
else {
    process.env.TACHYON_HOME_USING_DEFAULT = undefined;
}
fs.mkdirSync(process.env.TACHYON_HOME!, { recursive: true });
console.debug('Selected Tachyon home dir:', process.env.TACHYON_HOME!);
const CONFIG_FILE_ALLOWED_OPTIONS = [
    'TACHYON_COMPILER',
    'TACHYON_LINKER',
    'TACHYON_SYSROOT',
    'TACHYON_NO_TOOLCHAIN_CHECK',
    'TACHYON_LINKERPRETTY',
    'TACHYON_DEMANGLER',
    'CEMU_BIN',
    'TACHYON_NO_UPDATE_CHECK',
    'TACHYON_UPDATE_CHECK_INTERVAL',
    'TACHYON_SUPPRESS_ASSET_CONFLICT',
];
for (const optionName of CONFIG_FILE_ALLOWED_OPTIONS) {
    if (!optionName.startsWith('TACHYON_'))
        continue;
    Reflect.deleteProperty(process.env, optionName.slice(8));
}
const configFiles = dotenv.config({
    path: [
        path.resolve(CommonFiles.TachyonConfig),
        path.join(process.env.TACHYON_HOME!, CommonFiles.TachyonConfig),
    ],
    override: false,
    quiet: true,
});
const configFilesObj = configFiles.parsed;
if (!configFilesObj) {
    if (process.env.TACHYON_DEBUG)
        throw configFiles.error ?? new Error('config files parsed null, unknown reason');
    else
        abort('An unknown fatal error occured while trying to parse one of your Tachyon configuration files! Please rewrite or delete them.');
}
console.debug('Loaded from Tachyon config file(s):', configFilesObj);
const configFilesKeys = Object.keys(configFilesObj);
process.env.TACHYON_CONFIG_KEYS_LOADED = configFilesKeys.length.toString();
for (const optionName of configFilesKeys) {
    if (CONFIG_FILE_ALLOWED_OPTIONS.includes(optionName)) {
        if (optionName.startsWith('TACHYON_'))
            abort(`One of your Tachyon configuration files contains the prefixed known option ${$.yellowBright(optionName)}\n` +
                `Options in ${CommonFiles.TachyonConfig} files must be stripped of their "TACHYON_" prefix, please change it to ${$.yellowBright(optionName.slice(8))}`);
        continue;
    }
    if (CONFIG_FILE_ALLOWED_OPTIONS.includes(`TACHYON_${optionName}`)) {
        process.env[`TACHYON_${optionName}`] ??= process.env[optionName];
        Reflect.deleteProperty(process.env, optionName);
        continue;
    }
    abort(`One of your Tachyon configuration files contains an unknown or invalid option: ${$.yellowBright(optionName)}`);
}
