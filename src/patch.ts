import { Patch } from './hooks';
import { patchRPX } from './patchrpx';
import { RPL, Util, WSLSafePath } from 'rpxlib';
import { abort, hex, ResolveDrive, UnixPath } from './utils';
import path from 'path';
import fs from 'fs';

const cwd = process.cwd();
const args = process.argv.slice(2);
let patchFilePath: string = '';
let rpxPath: string = '';
let outpath: string = '';

args.forEach((arg, i) => {
    if (arg === '--patch' || arg === '-p') patchFilePath = args[i + 1];
    if (arg === '--rpx'   || arg === '-r') rpxPath       = args[i + 1];
    if (arg === '--out'   || arg === '-o') outpath       = args[i + 1];
});
if (!patchFilePath) abort('No patch file provided! The --patch option is required.');
if (!rpxPath) abort('No base RPX file provided! The --rpx option is required.');
if (outpath) {
    if (path.extname(outpath)) abort('Output path may not contain the file extension, only the name.');
    outpath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(outpath))));
}
patchFilePath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(patchFilePath))));
rpxPath = WSLSafePath(ResolveDrive(path.resolve(cwd, UnixPath(rpxPath))));

let patchFile = Buffer.from(fs.readFileSync(patchFilePath));
try {
    patchFile = Buffer.from(Bun.gunzipSync(patchFile));
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
}
const patchesDataSize = patchFile.readUint32BE(0x10);
const brandDataSize = patchFile.readUint32BE(0x14);
const expectedInputRPXHash = patchFile.readUint32BE(0x18);
const expectedOutputRPXHash = patchFile.readUint32BE(0x1C);
const patches: Patch[] = JSON.parse(decoder.decode(patchFile.subarray(DYNAMIC_OFFSET, DYNAMIC_OFFSET + patchesDataSize)));
const brand: string = decoder.decode(patchFile.subarray(DYNAMIC_OFFSET + patchesDataSize, DYNAMIC_OFFSET + patchesDataSize + brandDataSize));
const oFile = patchFile.subarray(DYNAMIC_OFFSET + patchesDataSize + brandDataSize);

const rpxData = fs.readFileSync(rpxPath);
const rpxHash = Util.crc32(rpxData);
if (rpxHash !== expectedInputRPXHash) {
    abort(`The provided RPX of hash ${hex(rpxHash)} is not compatible with this patch made for an RPX of hash ${hex(expectedInputRPXHash)}`);
}
const rpx = new RPL(rpxData);
patchRPX(new RPL(oFile), rpx, patches, brand, addrs);

const defaultSavePath = rpxPath.split('.').slice(0, -1).join('.');
const savedTo = rpx.save(`${outpath ? outpath.replace(/\.rpx/i, '') : defaultSavePath}.${brand}`, true);
const outHash = Util.crc32(fs.readFileSync(savedTo));
if (outHash !== expectedOutputRPXHash) {
    fs.unlinkSync(savedTo);
    abort(`Patch failed. The output patched RPX hash ${hex(outHash)} does not match the expected output hash ${hex(expectedOutputRPXHash)}`);
}
console.info(`Patch successful. Saved patched RPX to: ${savedTo}`);
