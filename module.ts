import fs from 'fs';
import yamlLib from 'yaml';
import {
    BranchHook, FuncptrHook, Hook, HookYAML, MultiNopHook, NopHook, PatchHook, ReturnHook, ReturnValueHook
} from './hooks';

interface ModuleYAML {
    Files: string[];
    Hooks: HookYAML[];
}

export class Module {
    constructor(path: string) {
        try {
            const yaml: ModuleYAML = yamlLib.parse(fs.readFileSync(path, 'utf8'));

            for (const file of yaml.Files) {
                if      (file.endsWith('.cpp')) this.cppFiles.push(file);
                else if (file.endsWith('.S'))   this.asmFiles.push(file);
                else console.error('Unknown file:', file);
            }

            for (const hook of yaml.Hooks) {
                switch (hook.type) {
                    case 'patch':       this.hooks.push(new PatchHook(hook)); break;
                    case 'nop':         this.hooks.push(new NopHook(hook)); break;
                    case 'multinop':    this.hooks.push(new MultiNopHook(hook)); break;
                    case 'returnvalue': this.hooks.push(new ReturnValueHook(hook)); break;
                    case 'return':      this.hooks.push(new ReturnHook(hook)); break;
                    case 'branch':      this.hooks.push(new BranchHook(hook)); break;
                    case 'funcptr':     this.hooks.push(new FuncptrHook(hook)); break;
                    default: console.error('Unknown hook:', hook.type);
                }
            }
        } catch {
            console.error('Invalid module:', path);
        }
    }

    public cppFiles: string[] = [];
    public asmFiles: string[] = [];
    public hooks: Hook[] = [];
}
