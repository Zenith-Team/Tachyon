import fs from 'node:fs';
import path from 'node:path';
import { CommonDirs, validateProjectFolder } from '../utils.js';
export function cli_handler(args: string[]): void {
    void args;
    const projectDir = validateProjectFolder();
    fs.rmSync(path.join(projectDir, CommonDirs.Exports), { recursive: true, force: true });
    fs.rmSync(path.join(projectDir, CommonDirs.Linker), { recursive: true, force: true });
    fs.rmSync(path.join(projectDir, CommonDirs.SymbolMaps), { recursive: true, force: true });
    fs.rmSync(path.join(projectDir, CommonDirs.Objs), { recursive: true, force: true });
    fs.rmSync(path.join(projectDir, CommonDirs.DefaultOutputPath), { recursive: true, force: true });
    console.success('Project generated files cleared.');
}
