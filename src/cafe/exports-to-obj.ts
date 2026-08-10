import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { abort, hex } from '../utils.js';
import type { Project } from '../shared/project.js';
import type { ProjectExports } from './exportsdump.js';
function generateExportsAssemblySource(exports: ProjectExports): string {
    const asm = [
        '.section .note.GNU-stack\n.long 0\n'
    ];
    if (exports.code.length === 0 && exports.data.length === 0)
        return asm.join('\n');
    for (const exportsType of ['code', 'data'] as const) {
        const symbols = exports[exportsType].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        asm.push(`.section ${exportsType === 'code' ? '.fexports, "ax"' : '.dexports, "a"'}, @0x80000001`, `.align 4\n.long ${symbols.length}, 0\n`);
        let symbolNameOffset = 8 + (8 * symbols.length);
        for (const symbol of symbols) {
            asm.push(`.extern ${symbol.name}\n.long ${symbol.name}, ${hex(symbolNameOffset)}`);
            symbolNameOffset += symbol.name.length + 1;
        }
        asm.push('', ...symbols.map(symbol => `.string "${symbol.name}"`), '');
    }
    return asm.join('\n');
}
export function assembleRPLExports(project: Project, exports: ProjectExports) {
    const exportsAsmSrc = generateExportsAssemblySource(exports);
    const exports_o_path = `${path.join(project.activeObjsDir, "__exports.S")}.o`;
    project.asmFiles.push("__exports.S");
    const clangCXXCommand = project.compilerCommand;
    const clangCXXArgs = [
        '-target', 'powerpc-eabi',
        '-o', exports_o_path,
        '-x', 'assembler',
        '-',
    ];
    const clangCXX = spawnSync(clangCXXCommand, clangCXXArgs, { cwd: project.path, input: exportsAsmSrc, stdio: ['pipe', 'inherit', 'inherit'] });
    if (clangCXX.error || clangCXX.signal || clangCXX.status !== 0) {
        abort('clang++ exports command failed!', clangCXX.status || 1);
    }
}
