declare function require(module: string): any;

const lib: typeof import('bun-utilities') = require('bun-utilities')();
export default lib;
export const arch = lib.arch;
export const cachedir = lib.cachedir;
export const copydir = lib.copydir;
export const copyfile = lib.copyfile;
export const cpus = lib.cpus;
export const exec = lib.exec;
export const execAndDontWait = lib.execAndDontWait;
export const freeMemory = lib.freeMemory;
export const freeSwap = lib.freeSwap;
export const homedir = lib.homedir;
export const hostname = lib.hostname;
export const networkInterfaces = lib.networkInterfaces;
export const platform = lib.platform;
export const release = lib.release;
export const rmdir = lib.rmdir;
export const spawn = lib.spawn;
export const spawnAndDontWait = lib.spawnAndDontWait;
export const tempdir = lib.tempdir;
export const totalMemory = lib.totalMemory;
export const totalSwap = lib.totalSwap;
export const uptime = lib.uptime;
