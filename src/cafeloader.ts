import $ from 'chalk';
import fs from 'fs';
import path from 'path';
import { DataSink, RPL } from 'rpxlib';
import { SymbolMap } from './symbolmap.js';
import { Patch } from './hooks.js';
import { abort, hex } from './utils.js';

export function generateCafeloaderFiles(oFile: RPL, patches: Patch[], map: SymbolMap): void {
    const cafeloaderDir = path.join('out', 'cafeloader');
    const addrBinPath = path.join(cafeloaderDir, 'Addr.bin');
    const codeBinPath = path.join(cafeloaderDir, 'Code.bin');
    const dataBinPath = path.join(cafeloaderDir, 'Data.bin');
    const patchesHaxPath = path.join(cafeloaderDir, 'Patches.hax');

    if (!fs.existsSync('out')) fs.mkdirSync('out');
    if (!fs.existsSync(cafeloaderDir)) fs.mkdirSync(cafeloaderDir);

    generateCodeAndDataBin();
    generatePatchesHax();

    const addrBin = Buffer.allocUnsafe(8);
    addrBin.writeUint32BE(map.converter.text, 0);
    addrBin.writeUint32BE(map.converter.data, 4);
    fs.writeFileSync(addrBinPath, addrBin);

    console.success('Saved CafeLoader files to:', $.cyanBright(path.resolve(process.cwd(), path.join('out', 'cafeloader'))));

    function generateCodeAndDataBin(): void {
        const sectionText = oFile.sections.find(s => s.name === '.text');
        const sectionRodata = oFile.sections.find(s => s.name === '.rodata');
        const sectionData = oFile.sections.find(s => s.name === '.data');

        if (fs.existsSync(dataBinPath)) fs.rmSync(dataBinPath);
        const datafd = fs.openSync(dataBinPath, 'a');

        if (sectionText?.hasData) fs.writeFileSync(codeBinPath, sectionText.data!);
        if (sectionRodata?.hasData) fs.appendFileSync(datafd, sectionRodata.data!);
        if (sectionData?.hasData) fs.appendFileSync(datafd, sectionData.data!);
    }

    function generatePatchesHax() {
        const patchesLen = Buffer.allocUnsafe(2);
        patchesLen.writeUint16BE(patches.length);
    
        const filesink = new DataSink();
        filesink.write(patchesLen);

        for (const { address, data } of patches) {
            const patchBytes = Buffer.from(data, 'hex');
            // TODO: This check is duplicated in patchrpx.ts, it should be unified in the Hook class
            if (patchBytes.byteLength !== data.length / 2) {
                abort(`Data of patch at address 0x${hex(address)} is malformed: "${data}"`);
            }
            const patchBuf = Buffer.allocUnsafe(6 + patchBytes.byteLength);

            patchBuf.writeUint16BE(patchBytes.byteLength, 0);
            patchBuf.writeUint32BE(address, 2);
            patchBuf.set(patchBytes, 6);
            filesink.write(patchBuf);
        }
        fs.writeFileSync(patchesHaxPath, filesink.end());
    }
}
