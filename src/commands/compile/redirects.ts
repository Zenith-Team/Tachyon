import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '../../shared/project.js';
import type { ConvMap } from '../../shared/convmap.js';
import { CommonFiles, CommonDirs } from '../../utils.js';
import { loadSymbolMapsAndGetCodeSyms } from './maps-loader.js';
export function generateRedirects(project: Project, convMap: ConvMap): void {
    console.info('Generating .text redirects...');
    const codeSymbols = loadSymbolMapsAndGetCodeSyms(project, convMap);
    const textRedirects: string[] = ['.text\n'];
    for (const symbol of codeSymbols) {
        const { name, address } = symbol;
        textRedirects.push(`
.global ${name}
${name}:
    lis %r2, ${address >>> 16}
    ori %r2, %r2, ${address & 0xFFFF}
    mtctr %r2
    bctr`);
    }
    textRedirects.push('\n');
    const redirectsFileText = '.section .note.GNU-stack\n.long 0\n' + textRedirects.join('\n');
    const redirectsFilePath = path.join(project.path, CommonDirs.Linker, CommonFiles.Redirects);
    fs.writeFileSync(redirectsFilePath, redirectsFileText);
    project.asmFiles.push(redirectsFilePath);
}
