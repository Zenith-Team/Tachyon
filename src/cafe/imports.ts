import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hex, abort } from '../utils.js';
import type { ExportSymbol, ProjectExportsJson } from './exportsdump.js';
import type { Project } from '../shared/project.js';
export function dependencyExportsToImports(project: Project, exports: ProjectExportsJson) {
    exports.code.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    exports.data.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const { libName } = exports;
    const asm = ['.section .note.GNU-stack\n.long 0\n'];
    const writeSymbols = (symbols: ExportSymbol[], type: 'function' | 'object'): void => {
        for (const symbol of symbols) {
            const binding = symbol.weak ? 'weak' : 'global';
            asm.push(`.${binding} ${symbol.name}`, `.type ${symbol.name}, @${type}`, `${symbol.name}: .long 0, 0\n`);
        }
    };
    let libNameBytes = '';
    Buffer.from(libName, 'ascii').forEach(byte => libNameBytes += `.byte ${hex(byte, 2)}\n`);
    for (let i = 0; i < (libName.length % 16); i++)
        libNameBytes += '.byte 0x00\n';
    if (exports.code.length !== 0) {
        asm.push(`.section ".fimport_${libName}", "ax", @0x80000002\n.align 4`, `.long ${exports.code.length.toString()}`, '.long 0x0', libNameBytes);
        writeSymbols(exports.code, 'function');
    }
    if (exports.data.length !== 0) {
        asm.push(`.section ".dimport_${libName}", "a", @0x80000002\n.align 4`, `.long ${exports.data.length.toString()}`, '.long 0x0', libNameBytes);
        writeSymbols(exports.data, 'object');
    }
    const asmFileName = `__imports_${libName}.S`;
    const imports_o_path = `${path.join(project.activeObjsDir, asmFileName)}.o`;
    project.asmFiles.push(asmFileName);
    const clangCXXCommand = project.compilerCommand;
    const clangCXXArgs = [
        '-target', 'powerpc-eabi',
        '-o', imports_o_path,
        '-x', 'assembler',
        '-',
    ];
    const clangCXX = spawnSync(clangCXXCommand, clangCXXArgs, { cwd: project.path, input: asm.join('\n'), stdio: ['pipe', 'inherit', 'inherit'] });
    if (clangCXX.error || clangCXX.signal || clangCXX.status !== 0) {
        abort('clang++ imports command failed!', clangCXX.status || 1);
    }
}
export function genLDSnippetForImport(name: string) {
    return `
    ".fimport_${name}" ALIGN(0x10) : {
       KEEP (*(.fimport_${name}))
       *(.fimport_${name}.*)
    } > dynlarea

    ".dimport_${name}" ALIGN(0x10) : {
       KEEP (*(.dimport_${name}))
       *(.dimport_${name}.*)
    } > dynlarea`;
}
