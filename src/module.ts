import fs from 'fs';
import path from 'path';
import yamlLib, { YAMLParseError } from 'yaml';
import { abort } from './utils.js';
import {
    BranchHook, FuncptrHook, Hook, HookYAML, NopHook, PatchHook, ReturnHook
} from './hooks.js';

interface ModuleYAML {
    Files: Partial<Record<'C' | 'C++' | 'Assembly' | 'Text', string[]>> | null;
    Hooks: HookYAML[] | null;
}

export class Module {
    constructor(yamlPath: string) {
        const moduleName = path.basename(yamlPath, '.yaml');
        try {
            const yaml = yamlLib.parse(fs.readFileSync(yamlPath, 'utf8')) as ModuleYAML;

            yaml.Files ??= {};
            yaml.Files.C ??= [];
            yaml.Files['C++'] ??= [];
            yaml.Files.Assembly ??= [];
            yaml.Files.Text ??= [];
            if (Object.keys(yaml.Files).length !== 4) abort(`Module ${moduleName} has an invalid "Files" property.`);
            if (typeof yaml.Files !== 'object') abort(`Module ${moduleName} has an invalid "Files" property.`);

            for (const file of yaml.Files.C) this.cppFiles.push(file);
            for (const file of yaml.Files['C++']) this.cppFiles.push(file);
            for (const file of yaml.Files.Assembly) this.asmFiles.push(file);
            //for (const file of yaml.Files.Text) this.txtFiles.push(file);

            yaml.Hooks ??= [];
            if (!(yaml.Hooks instanceof Array)) abort(`Module ${moduleName} has an invalid "Hooks" property.`);
            for (const hook of yaml.Hooks) {
                if (!Number.isSafeInteger(hook.addr) || hook.addr < 0) {
                    abort(`Invalid address "${hook.addr}" for hook #${yaml.Hooks.indexOf(hook) + 1} of type ${hook.type} in module ${moduleName}`);
                }
                switch (hook.type) {
                    case 'nop':         this.hooks.push(new NopHook(hook)); break;
                    case 'return':      this.hooks.push(new ReturnHook(hook)); break;
                    case 'branch':      this.hooks.push(new BranchHook(hook)); break;
                    case 'funcptr':     this.hooks.push(new FuncptrHook(hook)); break;
                    case 'patch':       this.hooks.push(new PatchHook(hook)); break;
                    default: abort(`Unknown hook type: ${hook.type} (in module ${moduleName})`);
                }
            }
        } catch (e: unknown) {
            console.error(`Failed to parse YAML file for module ${moduleName}`);
            if (e instanceof YAMLParseError) {
                abort(`Reason: ${e.message} (in ${yamlPath}:${e.linePos?.[0].line ?? e.pos[0]}:${e.linePos?.[0].col ?? e.pos[1]})`);
            } else if (process.env.TACHYON_DEBUG) {
                console.error('Reason (Debug):', e); process.exit(0);
            } else abort(`Reason: Unknown error, run in debug mode for more information.`);
        }
    }

    public cppFiles: string[] = [];
    public asmFiles: string[] = [];
    public hooks: Hook[] = [];
}
