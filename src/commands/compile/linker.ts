import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { abort, CommonFiles, CommonDirs } from '../../utils.js';
import { lldpretty } from '../../utils/linkerpretty.js';
import type { Project } from '../../shared/project.js';
export const LD_PROLOGUE = `
MEMORY {
    codearea : ORIGIN = 0x02000000, LENGTH = 0x0E000000
    dataarea : ORIGIN = 0x10000000, LENGTH = 0xB0000000
    dynlarea : ORIGIN = 0xC0000000, LENGTH = 0x08000000
    not_allowed : ORIGIN = 0, LENGTH = 0
}

SECTIONS {
    . = ORIGIN(codearea);
    .text ALIGN(0x20) : {
        *(.text .text.*)
    } > codearea

    . = ORIGIN(dynlarea);
    .fexports ALIGN(0x20) : {
        KEEP (*(.fexports))
    } > dynlarea

    .dexports ALIGN(0x20) : {
        KEEP (*(.dexports))
    } > dynlarea
`;
export const LD_EPILOGUE = `
    . = ORIGIN(dataarea);
    .rodata ALIGN(0x20) : {
        *(.rodata .rodata.*)
    } > dataarea

    .secinfo ALIGN(0x20) : {
        *(.secinfo)
    } > dataarea

    .data ALIGN(0x20) : {
        *(.data .data.*)
    } > dataarea

    .module_id ALIGN(0x20) : {
        *(.module_id)
    } > dataarea

    .bss ALIGN(0x40) : {
        *(.bss .bss.*)
        *(.bss2)
        *(COMMON)
    } > dataarea

    .init_array : {
        PROVIDE_HIDDEN (__init_array_start = .);
        KEEP (*(SORT_BY_INIT_PRIORITY(.init_array.*)))
        KEEP (*(.init_array))
        PROVIDE_HIDDEN (__init_array_end = .);
    } > dataarea

    .loaderdata : {
        __loaderdata_start = .;
        KEEP (*(.loaderdata))
        __loaderdata_end = .;
    } > dataarea

    /DISCARD/ : { *(.comment) }
}
`;
export function linkProject(proj: Project, extraLinkerFlags: string[], ld: string) {
    fs.writeFileSync(path.join(proj.path, CommonDirs.Linker, CommonFiles.LinkerDirective), ld);
    const linkCommand = proj.linkerCommand;
    const linkArgs = [
        '-o', proj.intermediateELFPath,
        '--no-warn-mismatch',
        '--no-demangle',
        '--no-undefined',
        '-m', 'elf32ppc',
        '-e', '__rpl_crt',
        '--emit-relocs',
        '-dn',
        '-Bstatic',
        '--error-limit=0',
        '--no-eh-frame-hdr',
        '-u', '__loaderdata_start',
        '-u', '__loaderdata_end',
        '-T', path.join(proj.path, CommonDirs.Linker, CommonFiles.LinkerDirective),
    ];
    if (!proj.config.freestanding)
        linkArgs.push('-T', path.join(proj.path, CommonDirs.SymbolMaps, proj.config.activeTargetName! + '.syms.ld'));
    linkArgs.push(...extraLinkerFlags);
    const objFiles: string[] = [];
    for (const cppfile of proj.cppFiles)
        objFiles.push(cppfile + '.o');
    for (const asmfile of proj.asmFiles)
        objFiles.push(asmfile + '.o');
    const objDir = proj.activeObjsDir;
    for (const file of objFiles)
        linkArgs.push(path.join(objDir, path.basename(file)));
    const uniqueFiles = new Set(objFiles.map(f => path.basename(f)));
    if (uniqueFiles.size !== proj.cppFiles.length + proj.asmFiles.length) {
        const seen = new Map<string, string>();
        for (const filepath of [...proj.cppFiles, ...proj.asmFiles]) {
            const filename = path.basename(filepath);
            if (seen.has(filename))
                abort(`Duplicate named files found in project at different folders:\n  1. ${seen.get(filename)!}\n  2. ${filepath}\nPlease rename one to prevent a conflict.`);
            else
                seen.set(filename, filepath);
        }
        abort('Duplicate named files found in project at different folders.');
    }
    const linker = spawnSync(linkCommand, linkArgs, { cwd: proj.path, stdio: ['ignore', 'pipe', 'pipe'] });
    if (linker.stdout.length > 0) {
        if (process.env.TACHYON_LINKERPRETTY === '0')
            process.stdout.write(linker.stdout);
        else
            lldpretty(linker.stdout.toString('utf8'));
    }
    if (linker.stderr.length > 0) {
        if (process.env.TACHYON_LINKERPRETTY === '0')
            process.stderr.write(linker.stderr);
        else
            lldpretty(linker.stderr.toString('utf8'));
    }
    if (linker.error || linker.signal || linker.status !== 0) {
        abort('linker command failed!', linker.status || 1);
    }
}
