import fs from 'node:fs';
import path from 'node:path';
import { abort, type u32 } from '../utils.js';
export enum ConvPlatform {
    GLOBAL,
    EMULATOR,
    CONSOLE
}
const VALID_CONV_PLATFORMS = ['EMULATOR', 'CONSOLE'] as const;
interface ConvOffset {
    from: u32;
    until: u32;
    value: u32;
}
const CONV_OFFSET_REGEX = /^(?:0x)?([\dA-F]{1,8}) *- *(?:0x)?([\dA-F]{1,8}) *: *([+-]) *(0x[\dA-F]{1,8}|\d{1,10});?$/;
export class ConvMap {
    private constructor(offsetsMap: ReadonlyMap<ConvPlatform, readonly ConvOffset[]>) {
        this.#offsetsMap = offsetsMap;
    }
    static parseFile(convFilePath: string) {
        try {
            const convFile = fs.readFileSync(convFilePath, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');
            const offsetsMap = new Map<ConvPlatform, ConvOffset[]>()
                .set(ConvPlatform.GLOBAL, [])
                .set(ConvPlatform.EMULATOR, [])
                .set(ConvPlatform.CONSOLE, []);
            let activeOffsetsList = offsetsMap.get(ConvPlatform.GLOBAL)!;
            let linenum = 0;
            for (const lineRaw of convFile.split('\n')) {
                linenum++;
                const lineWithIndent = lineRaw.split('//')[0]?.trimEnd() ?? '';
                const line = lineWithIndent.trimStart();
                if (!line)
                    continue;
                if (lineWithIndent[0] === '@') {
                    const directiveKeyword = /^@(\w+)/.exec(line)?.[1];
                    switch (directiveKeyword) {
                        case 'platform': {
                            const directiveArgs = /^ +(\w+) *:$/.exec(line.slice(1 + directiveKeyword.length));
                            const platform = (directiveArgs?.[1] ?? '') as typeof VALID_CONV_PLATFORMS[number];
                            if (!VALID_CONV_PLATFORMS.includes(platform)) {
                                abort(`Error parsing convmap "${convFilePath}" at line ${linenum}: Invalid target platform value for @${directiveKeyword} directive.`);
                            }
                            activeOffsetsList = offsetsMap.get(ConvPlatform[platform])!;
                            break;
                        }
                        default: abort(`Error parsing convmap "${convFilePath}" at line ${linenum}: Invalid @ directive.`);
                    }
                    continue;
                }
                else if (line[0] === '@') {
                    abort(`Error parsing convmap "${convFilePath}" at line ${linenum}: @ directive must not be indented.`);
                }
                const match = CONV_OFFSET_REGEX.exec(line);
                if (!match)
                    abort(`Failed to parse line ${linenum} in ${path.basename(convFilePath)}`);
                const [, from, until, sign, value] = match;
                activeOffsetsList.push({
                    from: Number('0x' + from!),
                    until: Number('0x' + until!),
                    value: sign === '-' ? -Number(value) : Number(value),
                });
            }
            return new ConvMap(offsetsMap);
        }
        catch {
            abort(`Invalid or missing conversion map: ${convFilePath}`);
        }
    }
    public convert(address: u32, platform: ConvPlatform): u32 {
        let convertedAddr: u32 = address;
        for (const offset of this.#offsetsMap.get(ConvPlatform.GLOBAL)!) {
            if (address >= offset.from && address < offset.until) {
                convertedAddr += offset.value;
            }
        }
        if (platform)
            for (const offset of this.#offsetsMap.get(platform)!) {
                if (address >= offset.from && address < offset.until) {
                    convertedAddr += offset.value;
                }
            }
        return convertedAddr;
    }
    public revert(address: u32, platform: ConvPlatform): u32 {
        let convertedAddr: u32 = address;
        for (const offset of this.#offsetsMap.get(ConvPlatform.GLOBAL)!) {
            if (address >= offset.from && address < offset.until) {
                convertedAddr -= offset.value;
            }
        }
        if (platform)
            for (const offset of this.#offsetsMap.get(platform)!) {
                if (address >= offset.from && address < offset.until) {
                    convertedAddr -= offset.value;
                }
            }
        return convertedAddr;
    }
    readonly #offsetsMap: ReadonlyMap<ConvPlatform, readonly ConvOffset[]>;
}
