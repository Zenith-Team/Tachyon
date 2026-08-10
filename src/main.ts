#!/usr/bin/env node
import './sideload.js';
import $ from 'chalk';
import fs from 'node:fs';
import { abort, AbortError } from './utils.js';
import { checkForUpdate } from './utils/updater.js';
if (process.versions.bun) {
    Reflect.set(process.env, 'TACHYON_NO_RUNTIME_CHECK', '1');
    console.error('Bun detected. [UNSUPPORTED]');
}
if (process.versions.deno) {
    Reflect.set(process.env, 'TACHYON_NO_RUNTIME_CHECK', '1');
    const denoVerDigits = (process.versions.deno.split('-')[0] ?? '0.0.0').split('.');
    const denoMajor = Number(denoVerDigits[0]) || 0;
    const denoMinor = Number(denoVerDigits[1]) || 0;
    const denoPatch = Number(denoVerDigits[2]) || 0;
    const denoIsOutdated = denoMajor < 2 ||
        (denoMajor === 2
            && (denoMinor < 9 || (denoMinor === 9 && denoPatch < 0)));
    if (denoIsOutdated) {
        abort(`Outdated Deno version (${process.versions.deno}) detected. Recommended range: ${"Deno v2.9.0 or higher (<3.x)"}.`);
    }
    if (denoMajor > 2) {
        console.warn(`Untested Deno version (${process.versions.deno}) detected, newer than the supported range.\n` +
            `Recommended range: ${"Deno v2.9.0 or higher (<3.x)"}. Continuing anyway. [experimental]`);
    }
    else {
        console.warn(`Deno v${denoVerDigits.join('.')} detected. [experimental]`);
    }
}
try {
    if (!process.env.TACHYON_NO_RUNTIME_CHECK) {
        const SUPPORTED_NODE_MAJOR_VERS = [24, 25, 26] as const;
        const MIN_NODE_VERS = { 24: [0, 0], 25: [0, 0], 26: [0, 0] } satisfies Record<typeof SUPPORTED_NODE_MAJOR_VERS[number], [
            number,
            number
        ]>;
        const MIN_NODE_MAJOR_VER = SUPPORTED_NODE_MAJOR_VERS[0];
        const MAX_NODE_MAJOR_VER = SUPPORTED_NODE_MAJOR_VERS.at(-1)!;
        const [MIN_NODE_MINOR_VER, MIN_NODE_PATCH_VER] = MIN_NODE_VERS[MIN_NODE_MAJOR_VER];
        const RECOMMENDED_NODE_RANGE = `Node.js v${MIN_NODE_MAJOR_VER}.${MIN_NODE_MINOR_VER}.${MIN_NODE_PATCH_VER} through v${MAX_NODE_MAJOR_VER}.x`;
        const nodeVerDigits = (process.versions.node.split('-')[0] ?? '0.0.0').split('.');
        const nodeMajor = Number(nodeVerDigits[0]) || 0;
        const nodeMinor = Number(nodeVerDigits[1]) || 0;
        const nodePatch = Number(nodeVerDigits[2]) || 0;
        const isSupportedNodeMajor = SUPPORTED_NODE_MAJOR_VERS.includes(nodeMajor as typeof SUPPORTED_NODE_MAJOR_VERS[number]);
        if (!isSupportedNodeMajor) {
            if (nodeMajor < MIN_NODE_MAJOR_VER) {
                abort(`Outdated Node.js version (${process.versions.node}) detected. Recommended range: ${RECOMMENDED_NODE_RANGE}.`);
            }
            console.warn(`Untested Node.js version (${process.versions.node}) detected, newer than the supported range.\n` +
                `Recommended range: ${RECOMMENDED_NODE_RANGE}. Continuing anyway.`);
        }
        else {
            const testedMajor = nodeMajor as typeof SUPPORTED_NODE_MAJOR_VERS[number];
            const [MIN_MINOR_VER, MIN_PATCH_VER] = MIN_NODE_VERS[testedMajor];
            if (nodeMinor < MIN_MINOR_VER || (nodeMinor === MIN_MINOR_VER && nodePatch < MIN_PATCH_VER)) {
                abort(`Outdated Node.js version (${process.versions.node}) detected. Recommended range: ${RECOMMENDED_NODE_RANGE}.`);
            }
        }
    }
    if (process.platform === 'win32') {
        const normalizePath = (p: string) => p.toLowerCase().replaceAll('\\', '/');
        const cwd = process.cwd();
        const inOneDrive = normalizePath(cwd).includes('/onedrive')
            || normalizePath(fs.realpathSync(cwd)).includes('/onedrive')
            || normalizePath(fs.realpathSync.native(cwd)).includes('/onedrive');
        const userWantsToMakeBadChoices = process.env.TACHYON_FORCE_UNSUPPORTED_CLOUD_FS !== undefined;
        if (inOneDrive) {
            console.error("Tachyon has detected you have ran it inside a OneDrive-enabled folder, this is not supported.\nNetworked filesystems such as OneDrive are extremely slow and do not support basic filesystem features needed for Tachyon to work properly.");
            if (!userWantsToMakeBadChoices) {
                abort("Switch directories to a folder outside of OneDrive and try again. (Under a default configuration, that means outside of your C:/Users/* folder)");
            }
            else
                console.error($.bold("Proceeding anyway due to environment setting, this is a very bad idea and your configuration is now unsupported.\nNo issues you run into will be accepted unless reproduced outside a networked filesystem / OneDrive."));
        }
    }
    const args = process.argv.slice(2);
    let command: {
        cli_handler(args: string[]): Promise<void> | void;
    };
    const updateAvailablePromise = checkForUpdate();
    const arg0 = args.shift();
    switch (arg0) {
        case 'cc':
        case 'compile':
        case 'build':
            command = await import('./commands/compile/cli-handler.js');
            break;
        case 'pkg':
        case 'package':
            command = await import('./commands/compile/cli-handler.js');
            args.push('--package');
            break;
        case 'bundle':
            command = await import('./commands/bundle.js');
            break;
        case 'launch':
            command = await import('./commands/launch/cli-handler.js');
            break;
        case 'clean':
            command = await import('./commands/clean.js');
            break;
        case 'setup':
            command = await import('./commands/setup.js');
            break;
        case 'init':
            command = await import('./commands/init.js');
            break;
        case 'pm':
        case 'pkgmgr': {
            const arg1 = args.shift();
            switch (arg1) {
                case 'link':
                    command = await import('./commands/pm/link.js');
                    break;
                case 'ls':
                case 'list':
                    command = await import('./commands/pm/list.js');
                    break;
                case 'i':
                case 'add':
                case 'install':
                    command = await import('./commands/pm/install.js');
                    break;
                case 'r':
                case 'rm':
                case 'remove':
                case 'uninstall':
                    command = await import('./commands/pm/uninstall.js');
                    break;
                case 'update':
                case 'up':
                    command = await import('./commands/pm/update.js');
                    break;
                default:
                    command = await import('./commands/default.js');
                    if (arg1)
                        args.unshift(arg1);
            }
            break;
        }
        default:
            command = await import('./commands/default.js');
            if (arg0)
                args.unshift(arg0);
    }
    await command.cli_handler(args);
    if (await updateAvailablePromise) {
        console.log($.greenBright.bold('\n[*] An update for Tachyon is available. Install it with:\n') +
            $.gray.bold('> ') + $.whiteBright.bold('npm i -g --allow-remote=root https://github.com/Zenith-Team/Tachyon/releases/latest/download/tachyon.tgz'));
    }
}
catch (err) {
    if (err instanceof AbortError)
        process.exit(err.code);
    const errcode = Reflect.get(err as object, 'code') as string | number | undefined;
    if (typeof errcode === 'string' && errcode.startsWith('ERR_PARSE_ARGS_')) {
        if (errcode === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
            console.error('Invalid arguments: ' + (<Error>err).message.split(' To specify a ')[0]!);
        }
        else {
            console.error(`Invalid arguments: ${(<Error>err).message}`);
        }
        process.exit(1);
    }
    console.error('Something has gone catastrophically wrong!\n' +
        (typeof errcode === 'string' ? `[${errcode}] ` : '') +
        `${(<Error>err).name}: ${(<Error>err).message}`);
    process.exitCode = 255;
    if (process.env.TACHYON_DEBUG)
        throw err;
}
