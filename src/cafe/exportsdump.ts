import fs from 'node:fs';
import path from 'node:path';
import { assembleRPLExports } from './exports-to-obj.js';
import { CommonDirs, hex, TitleID } from '../utils.js';
import type { Project } from '../shared/project.js';
import { RPL, type SymbolSection, SymbolType, SymbolBinding } from 'rpxlib';
export interface ExportSymbol {
    name: string;
    weak: boolean;
}
export interface ProjectExports {
    code: ExportSymbol[];
    data: ExportSymbol[];
}
export interface ProjectExportsJson extends ProjectExports {
    libName: string;
}
const DATA_EXPORTS_FOR_LOADERDATA = [
    '__loaderdata_start',
    '__loaderdata_end',
];
const NON_EXPORTS = [
    '<empty>',
    '__init_array_end',
    '__init_array_start',
    '__rpl_crt',
    '_ZN8NullCtorC2Ev'
];
const SPECIAL_NON_EXPORTS = [
    ...NON_EXPORTS,
    '_Znwm',
    '_ZdlPv',
    'abort',
    'sin',
    'cos',
    'tan',
    'atan',
    'atan2',
    'log',
    'pow',
    'ceil',
    'floor',
    'fabs',
    'fabsf',
    'atof',
    'malloc',
    'calloc',
    'realloc',
    'free',
    'memalign',
    'memchr',
    'memcmp',
    'memcpy',
    'memmove',
    'memset',
    'printf',
    'sprintf',
    'strcat',
    'strchr',
    'strcmp',
    'strcpy',
    'strlen',
    'strncmp',
    'strncpy',
    'strpbrk',
    'strstr',
    'strtol',
    'isalnum',
    'isalpha',
    'iscntrl',
    'isdigit',
    'isgraph',
    'islower',
    'isprint',
    'ispunct',
    'isspace',
    'isupper',
    'isxdigit',
    'tolower',
    'toupper',
];
const BLOCKED_PKG_CODE_EXPORTS = [
    '__rpl_crt',
    '__rpl_start',
    '_Z4mainv',
    'init',
    'getModID',
    'getTitleID',
    'getModuleType',
    'getDependencyManifest',
    'getVersion',
];
const BLOCKED_PKG_DATA_EXPORTS = [
    '__loaderdata_start',
    '__loaderdata_end',
];
function exportsdump(objFilePaths: string[], ignoredExports: string[]): ProjectExports {
    const exports = {
        code: new Map<string, ExportSymbol>(),
        data: new Map<string, ExportSymbol>(),
    };
    for (const objFilePath of objFilePaths) {
        const objFile = new RPL(fs.readFileSync(objFilePath));
        const symtab = objFile.sections.find(sec => sec.name === '.symtab') as SymbolSection | undefined;
        if (!symtab)
            continue;
        const hasLoaderdata = objFile.sections.some(sec => sec.name === '.loaderdata');
        if (hasLoaderdata)
            DATA_EXPORTS_FOR_LOADERDATA.forEach(name => exports.data.set(name, { name, weak: false }));
        for (const symbol of symtab.symbols) {
            if (+symbol.binding === SymbolBinding.Local ||
                ignoredExports.includes(symbol.name) ||
                symbol.name.includes('.') ||
                symbol.name.includes('_tPatch_') ||
                symbol.name.includes('_tHook_'))
                continue;
            const weak = +symbol.binding === SymbolBinding.Weak;
            switch (+symbol.type) {
                case SymbolType.Function:
                    exports.code.set(symbol.name, { name: symbol.name, weak });
                    break;
                case SymbolType.Object:
                    exports.data.set(symbol.name, { name: symbol.name, weak });
                    break;
            }
        }
    }
    return {
        code: [...exports.code.values()],
        data: [...exports.data.values()],
    };
}
export function createExports(project: Project): string {
    const objFiles: string[] = [];
    const objDir = project.activeObjsDir;
    for (const cppfile of project.cppFiles)
        objFiles.push(path.join(objDir, path.basename(cppfile + '.o')));
    for (const asmfile of project.asmFiles)
        objFiles.push(path.join(objDir, path.basename(asmfile + '.o')));
    const exports = exportsdump(objFiles, project.config.type === 'Special' ? SPECIAL_NON_EXPORTS : NON_EXPORTS);
    const exportsDumpDir = path.join(project.path, CommonDirs.Exports);
    const exportFileID = project.config.freestanding ? '0000000000000000' : hex(project.config.targetTitleID!, 16, '');
    const exportsDumpFilePath = path.join(exportsDumpDir, `exports_${exportFileID}.json`);
    fs.mkdirSync(exportsDumpDir, { recursive: true });
    fs.writeFileSync(exportsDumpFilePath, JSON.stringify({
        libName: project.config.name + (project.config.freestanding ? '' : (`,${project.config.activeTargetName!}` + (TitleID.isConsoleTagged(project.config.targetTitleID!) ? ',C' : ''))),
        code: exports.code.filter(ex => !BLOCKED_PKG_CODE_EXPORTS.includes(ex.name)),
        data: exports.data.filter(ex => !BLOCKED_PKG_DATA_EXPORTS.includes(ex.name)),
    } satisfies ProjectExportsJson, null, 4));
    if (exports.code.length > 0 || exports.data.length > 0)
        assembleRPLExports(project, exports);
    return exportsDumpFilePath;
}
