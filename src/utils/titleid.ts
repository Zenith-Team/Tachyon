import { hex } from '../utils.js';
export class TitleID extends null {
    static parse(titleID: string): bigint | null {
        const parts = /^([\dA-F]{8})-?([\dA-F]{8})$/gi.exec(titleID);
        if (parts?.length !== 3)
            return null;
        return BigInt('0x' + parts[1]! + parts[2]!);
    }
    static format(titleID: bigint): string {
        const hexTID = hex(titleID, 16, '');
        const half1 = hexTID.slice(0, 8);
        const half2 = hexTID.slice(8);
        return `${half1}-${half2}`;
    }
    static getType(titleID: bigint): TitleID.Type | null {
        const upperHalf = Number(TitleID.removeConsoleTag(titleID) >> 32n);
        if (!TitleID.Type[upperHalf])
            return null;
        return upperHalf;
    }
    static stripSubtype(titleid: bigint) {
        return titleid & 0xFFFFFF00FFFFFFFFn;
    }
    static addConsoleTag(titleid: bigint) {
        return titleid | 0xC000000000000000n;
    }
    static removeConsoleTag(titleid: bigint) {
        return titleid & ~0xC000000000000000n;
    }
    static isConsoleTagged(titleid: bigint): boolean {
        return (titleid & 0xC000000000000000n) !== 0n;
    }
    static DUMMY_TEXT = '00050000-00000000';
    static DUMMY_ID = 0x0005000000000000n;
    static isDummyID(titleid: bigint | string): boolean {
        if (typeof titleid === 'bigint')
            return titleid === TitleID.DUMMY_ID;
        if (typeof titleid === 'string')
            return titleid === TitleID.DUMMY_TEXT;
        else
            return false;
    }
}
export namespace TitleID {
    export enum Type {
        System = 0x00050010,
        Shared = 0x0005001B,
        Overlay = 0x00050030,
        Game = 0x00050000,
        DLC = 0x0005000C,
        Update = 0x0005000E,
        Demo = 0x00050002
    }
}
