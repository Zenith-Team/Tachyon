import fs from 'node:fs';
import path from 'node:path';
import { CommonFiles, CommonDirs, hex } from '../../utils.js';
import type { Project } from '../../shared/project.js';
function generateDependencyManifest(entries: {
    name: string;
    version: string;
}[]): string {
    const n = entries.length;
    let body = '\n';
    let totalBytes = 0;
    const countBytes = [
        (n >>> 24) & 0xFF,
        (n >>> 16) & 0xFF,
        (n >>> 8) & 0xFF,
        (n >>> 0) & 0xFF,
    ];
    const countHex = countBytes.map(b => hex(b, 2)).join(', ');
    body += `    // n = ${n}\n    ${countHex},\n\n`;
    totalBytes += 4;
    let i = 0;
    for (const entry of entries) {
        const nameBytes = [...Buffer.from(entry.name, 'utf8'), 0];
        const verBytes = [...Buffer.from(entry.version, 'utf8'), 0];
        const combined = [...nameBytes, ...verBytes];
        const hexLine = combined.map(b => hex(b)).join(', ');
        body += `    // Entry ${i}: "${entry.name}" (${entry.version})\n    ${hexLine},\n\n`;
        totalBytes += combined.length;
        i++;
    }
    return `static unsigned char sDependencyManifest[${totalBytes}] __attribute__((aligned(4))) = {\n${body}};\n`;
}
export function generateInitializer(project: Project) {
    const generatedCode = `
extern "C" const char* getModID() {
    return "${project.config.name.toLowerCase()}";
}
extern "C" unsigned long long getTitleID() {
    return ${hex(project.config.targetTitleID!, 16)}ULL;
}

enum ModuleType {
    Null,
    Special,
    CoreMod,
    CoreAPI,
    Standard,
};

extern "C" int getModuleType() {
    return ${project.config.type};
}

extern "C" unsigned char* getDependencyManifest() {
    return sDependencyManifest;
}

extern "C" const char* getVersion() {
    return "${project.config.version}";
}
`;
    const initializerCode = BASE_INITIALIZER_CODE + generateDependencyManifest(project.directDependencies) + generatedCode;
    const filePath = path.join(project.path, CommonDirs.Linker, CommonFiles.Initializer);
    fs.writeFileSync(filePath, initializerCode);
    project.cppFiles.push(filePath);
}
const BASE_INITIALIZER_CODE = `
#include <telkin/Hooks.h>

// Ensure .loaderdata isn't empty
tk::NullHook _tHook_NullInit __attribute__((section(".loaderdata"))) = tk::NullHook(tk::DataMagic::NullHook);

// Ensure .init_array isn't empty
#pragma clang optimize off
struct NullCtor {
    NullCtor() : x(0) {
        asm volatile("nop");
    }
    ~NullCtor() = default;
    int x;
};
[[gnu::used]]
NullCtor _tHook_NullCtor; // name hack to ensure it doesn't export
#pragma clang optimize on

extern "C" {
    using funcPtr = void (*)();
    extern funcPtr __init_array_start[], __init_array_end[];
}

extern "C" int __rpl_crt() { return 0; } // Called by Cafe OS, don't do anything here.

extern "C" void _Z4mainv();

extern "C" void __rpl_start(unsigned int acquireAddr, unsigned int exportAddr) {
    static bool initialized = false;
    if (initialized) return;
    initialized = true;

    for (funcPtr* p = __init_array_start; p != __init_array_end; p++) {
        (*p)();
    }

    _Z4mainv(); // begin user code
}
`;
