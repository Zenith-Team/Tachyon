import fs from 'fs';
import path from 'path';
import yamlLib, { YAMLParseError } from 'yaml';
import { abort } from './utils.js';
import {
    BranchHook, FuncptrHook, Hook, HookYAML, MultiNopHook, NopHook, PatchHook, ReturnHook, ReturnValueHook
} from './hooks.js';

interface ModuleYAML {
    Hooks: HookYAML[];
}

export class Module {
    constructor(yamlPath: string) {
        const moduleName = path.basename(yamlPath, '.yaml');
        try {
            const yaml = yamlLib.parse(fs.readFileSync(yamlPath, 'utf8')) as ModuleYAML;

            if (!(yaml.Hooks instanceof Array)) abort(`Module ${moduleName} is missing a "Hooks" property, or it is not a list.`);
            for (const hook of yaml.Hooks) {
                if (!Number.isSafeInteger(Number(hook.addr))) {
                    abort(`Invalid address "${hook.addr}" for hook #${yaml.Hooks.indexOf(hook) + 1} of type ${hook.type} in module ${moduleName}`);
                }
                switch (hook.type) {
                    case 'patch':       this.hooks.push(new PatchHook(hook)); break;
                    case 'nop':         this.hooks.push(new NopHook(hook)); break;
                    case 'multinop':    this.hooks.push(new MultiNopHook(hook)); break;
                    case 'returnvalue': this.hooks.push(new ReturnValueHook(hook)); break;
                    case 'return':      this.hooks.push(new ReturnHook(hook)); break;
                    case 'branch':      this.hooks.push(new BranchHook(hook)); break;
                    case 'funcptr':     this.hooks.push(new FuncptrHook(hook)); break;
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

    public hooks: Hook[] = [];
}
