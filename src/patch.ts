import { Patch } from './hooks.js';
import { patchRPX } from './patchrpx.js';
import { RPL } from 'rpxlib';
import { abort, hex } from './utils.js';
import crc from '@foxglove/crc';
import path from 'path';
import zlib from 'zlib';
import fs from 'fs';

const cwd = process.cwd();
let [rpxPath, patchFilePath, ...args] = process.argv.slice(2);
let outpath: string | undefined;

args.forEach((arg, i) => {
    if (arg === '--out'   || arg === '-o') outpath = args[i + 1];
});
if (!rpxPath || rpxPath[0] === '-') abort('No base RPX file provided! The first positional argument must be the path to the base RPX to patch.');
if (!patchFilePath || patchFilePath[0] === '-') abort('No patch file provided! The second positional argument must be the path to the Tachyon patch file to apply.');
if (outpath) {
    if (path.extname(outpath)) abort('Output path may not contain the file extension, only the name.');
    outpath = path.resolve(cwd, outpath);
}
rpxPath = path.resolve(cwd, rpxPath);
patchFilePath = path.resolve(cwd, patchFilePath);

let patchFile = Buffer.from(fs.readFileSync(patchFilePath));
try {
    patchFile = Buffer.from(zlib.inflateSync(patchFile));
} catch {
    // File is not compressed, but it could still be an uncompressed patch file
    // Silently proceed to magic check
}
if (patchFile.readUint32BE(0) !== 0xC5FC5046) abort(`The file ${patchFilePath} is not a Tachyon Patch file!`);
console.info('Patching...');

const DYNAMIC_OFFSET = 0x20 as const;
const decoder = new TextDecoder();
const addrs = {
    syms: patchFile.readUint32BE(0x4),
    text: patchFile.readUint32BE(0x8),
    data: patchFile.readUint32BE(0xC),
};
const patchesDataSize = patchFile.readUint32BE(0x10);
const brandDataSize = patchFile.readUint32BE(0x14);
const expectedInputRPXHash = patchFile.readUint32BE(0x18);
const expectedOutputRPXHash = patchFile.readUint32BE(0x1C);
const patches = JSON.parse(decoder.decode(patchFile.subarray(DYNAMIC_OFFSET, DYNAMIC_OFFSET + patchesDataSize))) as Patch[];
const brand: string = decoder.decode(patchFile.subarray(DYNAMIC_OFFSET + patchesDataSize, DYNAMIC_OFFSET + patchesDataSize + brandDataSize));
const oFile = patchFile.subarray(DYNAMIC_OFFSET + patchesDataSize + brandDataSize);

const rpxData = fs.readFileSync(rpxPath);
const rpxHash = crc.crc32(rpxData);
if (rpxHash !== expectedInputRPXHash) {
    abort(`The provided RPX of hash ${hex(rpxHash)} is not compatible with this patch made for an RPX of hash ${hex(expectedInputRPXHash)}`);
}
const rpx = new RPL(rpxData, { parseRelocs: true });
patchRPX(new RPL(oFile), rpx, patches, brand, addrs);

const defaultSavePath = rpxPath.split('.').slice(0, -1).join('.');
const savedTo = rpx.save(`${outpath ? outpath.replace(/\.rpx/i, '') : defaultSavePath}.${brand}`, true);
const outHash = crc.crc32(fs.readFileSync(savedTo));
if (outHash !== expectedOutputRPXHash) {
    fs.unlinkSync(savedTo);
    abort(`Patch failed. The output patched RPX hash ${hex(outHash)} does not match the expected output hash ${hex(expectedOutputRPXHash)}`);
}
console.info(`Patch successful. Saved patched RPX to: ${savedTo}`);
