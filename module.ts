import fs from 'fs';
import path from 'path';
import yamlLib from 'yaml';
import { abort } from './utils';
import {
    BranchHook, FuncptrHook, Hook, HookYAML, MultiNopHook, NopHook, PatchHook, ReturnHook, ReturnValueHook
} from './hooks';

interface ModuleYAML {
    Files: string[];
    Hooks: HookYAML[];
}

export class Module {
    constructor(yamlPath: string) {
        try {
            const yaml: ModuleYAML = yamlLib.parse(fs.readFileSync(yamlPath, 'utf8'));

            for (const file of yaml.Files) {
                if      (file.endsWith('.cpp')) this.cppFiles.push(file);
                else if (file.endsWith('.S'))   this.asmFiles.push(file);
                else console.error('Unknown file:', file);
            }

            for (const hook of yaml.Hooks) {
                if (Number.isSafeInteger(hook.addr)) {
                    abort(`Invalid address for hook #${yaml.Hooks.indexOf(hook)+1} of type ${hook.type} in module ${path.basename(yamlPath, '.yaml')}`);
                }
                switch (hook.type) {
                    case 'patch':       this.hooks.push(new PatchHook(hook)); break;
                    case 'nop':         this.hooks.push(new NopHook(hook)); break;
                    case 'multinop':    this.hooks.push(new MultiNopHook(hook)); break;
                    case 'returnvalue': this.hooks.push(new ReturnValueHook(hook)); break;
                    case 'return':      this.hooks.push(new ReturnHook(hook)); break;
                    case 'branch':      this.hooks.push(new BranchHook(hook)); break;
                    case 'funcptr':     this.hooks.push(new FuncptrHook(hook)); break;
                    default: console.error('Unknown hook type:', hook.type);
                }
            }
        } catch {
            console.error('Invalid module:', yamlPath);
        }
    }

    public cppFiles: string[] = [];
    public asmFiles: string[] = [];
    public hooks: Hook[] = [];
}
