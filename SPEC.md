# Tachyon Specifications
This document holds the technical specifications for the formats of a few custom files generated by Tachyon.

## Index
- [Tachyon Patch Files (`.typf`)](#tachyon-patch-files-typf)
- [Assembly Cache file (`.asm.cache`)](#assembly-cache-file-asmcache)

### Tachyon Patch Files (`.typf`)
This file uses a simple custom binary format, the C++ pseudo-struct representation of which can be seen below:
```cpp
// EOF = end of file
struct TYPF {
    uint magic; // 0x0: File magic, always 0xC5FC9F with the last byte being the format version, currently 0x01
    uint textAddr; // 0x4: Text End Address
    uint dataAddr; // 0x8: Data End Address
    uint symsAddr; // 0xC: Syms End Address
    uint patchesDataSize; // 0x10: Patches Data Size
    uint projNameAndTargetDataSize; // 0x14: Project name & Target Data Size
    uint expectedInputRPXHash; // 0x18: Expected input RPX hash
    uint expectedOutputRPXHash; // 0x1C: Expected output RPX hash
    char patches[patchesDataSize]; // 0x20: Patches Data (minified JSON string)
    char projNameAndTarget[projNameAndTargetDataSize]; // 0x20+sizeof(patches): Project name + "\v" (0x0B) + Target
    unsigned char oFileData[EOF - (0x20+sizeof(patches)+sizeof(projNameAndTarget))]; // 0x20+sizeof(patches)+sizeof(projNameAndTarget): Compiled .o File Data (binary ELF data)
};
```
The above struct is a representation of TYPF files when uncompressed, although TYPF files produced by Tachyon directly will always be **zlib compressed** (level 9) with no distinction from uncompressed TYPFs (same extension). *The whole file is compressed, including the file magic.*

Tachyon supports reading both compressed and uncompressed TYPFs by simply attempting to decompress first, and in case of decompression error, silently proceeding and trying to parse it as if it successfully decompressed, in hopes it might be an already-decompressed TYPF.

This is not a performance costly operation since TYPFs are tiny and the decompression error will always happen at the zlib header check, so it won't actually try to decompress the whole file before erroring.

### Assembly Cache file (`.asm.cache`)
This file is uses a minified **JSON** format, simply storing an indefinite amount of top level key-value pairs of:
```json
"ABSOLUTE_PATH_TO_ASM_FILE": mtime,
```
Where `mtime` is a positive decimal numeric value representing the *Last Modified* timestamp of the respective ASM file at the time of its last assembly.

The time unit of the timestamp is subject to the operating system and filesystem in use. In Windows NTFS, the time unit is integer milliseconds with float microseconds. 