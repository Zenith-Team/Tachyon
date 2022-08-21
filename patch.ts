import { PatchFile, patchRPX } from './patchrpx';
import { RPL } from 'rpxlib';
import fs from 'fs';

let patchFilePath: string = '';
let oFilePath: string = '';
let rpxPath: string = '';
let brand: string = '';
let outpath: string = '';

const args = process.argv.slice(2);

args.forEach((arg, i) => {
    if (arg === '--patch' || arg === '-p') patchFilePath = args[i + 1];
    if (arg === '--ofile' || arg === '-f') oFilePath     = args[i + 1];
    if (arg === '--rpx'   || arg === '-r') rpxPath       = args[i + 1];
    if (arg === '--brand' || arg === '-b') brand         = args[i + 1];
    if (arg === '--out'   || arg === '-o') outpath       = args[i + 1];
});

const patchFile: PatchFile = JSON.parse(fs.readFileSync(patchFilePath, 'utf8'));
const rpx = new RPL(fs.readFileSync(rpxPath));

patchRPX(new RPL(fs.readFileSync(oFilePath)), rpx, patchFile.patches, brand, patchFile.addrs);

const savedTo = rpx.save(outpath.replace(/\.rpx/i, ''), true);
console.info(`Saved patched RPX to: ${savedTo}`);
