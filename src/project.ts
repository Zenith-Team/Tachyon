import fs from 'fs';
import path from 'path';
import yamlLib from 'yaml';
import { Patch } from './hooks.js';
import { Module } from './module.js';
import { spawnSync } from 'child_process';
import { SymbolMap } from './symbolmap.js';
import { abort, hex } from './utils.js';
import { DataBaseAddress, LoadBaseAddress } from 'rpxlib';

const ToolWUAPPSVersion = '3.1' as const;
type Integer = number;

interface ProjectYAML {
    WUAPPSVersion: string, //! Required
    Name: string, //! Required
    Variables?: Record<string, string> | null, // Default: {}
    RpxDir?: string | null, // Default: './rpxs'
    ModulesBaseDir?: string | null, // Default: null (from project.yaml)
    SourceDir?: string | null, // Default: null (from module file)
    IncludeDirs?: string[] | null, // Default: ['./include']
    BuildOptions?: string[] | null, // Default: []
    ExcludeDefaultBuildOptions?: string[] | boolean | null, // Default: []
    Modules: string[] | null, // Default: []
    MinAlign: Record<string, Integer> | null, // Default: {.text:0x20,.rodata:0x20,.data:0x20,.bss:0x40}
    Targets: Record<string, ProjectTarget | null>, //! Required
}

interface ProjectTarget {
    Abstract?: boolean | null, // Default: false
    Extends?: string | string[] | null, // Default: null
    AddrMap?: string | null, // Default: <TARGET_NAME>
    BaseRpx?: string | null, // Default: <TARGET_NAME>
    'Remove/Modules'?: string[] | null, // Default: []
    'Add/Modules'?: string[] | null, // Default: []
    'Remove/BuildOptions'?: string[] | null, // Default: []
    'Add/BuildOptions'?: string[] | null, // Default: []
}

export class Project {
    constructor(projectDir: string, ghsPath: string, target: string, consoleOutput: 'cafeloader' | 'none') {
        this.path = projectDir;
        this.ghsPath = ghsPath;

        try {
            const yaml = yamlLib.parse(fs.readFileSync(path.join(this.path, 'project.yaml'), 'utf8')) as ProjectYAML;
            
            const projWUAPPSVer = yaml.WUAPPSVersion;
            if (typeof projWUAPPSVer !== 'string') abort(`project.yaml: Invalid WUAPPSVersion field type "${typeof projWUAPPSVer}". Expected string.`);
            if (!projWUAPPSVer) abort('project.yaml is missing WUAPPSVersion!');
            if (projWUAPPSVer !== ToolWUAPPSVersion) abort(`project.yaml WUAPPSVersion is ${projWUAPPSVer}, expected ${ToolWUAPPSVersion}.`);

            this.vars = yaml.Variables ?? {};
            this.name = this.processStringVars(yaml.Name);
            if (this.name === '') abort('project.yaml: Name must not be empty.');

            yaml.RpxDir ??= 'rpxs';
            if (typeof yaml.RpxDir !== 'string') abort(`project.yaml: Invalid RpxDir field type "${typeof yaml.RpxDir}". Expected string or null.`);
            this.rpxDir = path.resolve(projectDir, this.processStringVars(yaml.RpxDir || 'rpxs'));

            yaml.ModulesBaseDir ??= this.path;
            if (typeof yaml.ModulesBaseDir !== 'string') abort(`project.yaml: Invalid ModulesBaseDir field type "${typeof yaml.ModulesBaseDir}". Expected string or null.`);
            this.modulesBaseDir = path.resolve(projectDir, this.processStringVars(yaml.ModulesBaseDir || this.path));

            yaml.SourceDir ??= null;
            if (yaml.SourceDir === '') yaml.SourceDir = null;
            if (typeof yaml.SourceDir !== 'string') abort(`project.yaml: Invalid SourcesBaseDir field type "${typeof yaml.SourceDir}". Expected string or null.`);
            this.sourceDir = yaml.SourceDir && path.resolve(projectDir, this.processStringVars(yaml.SourceDir));
            
            yaml.IncludeDirs ??= ['include'];
            if (!Array.isArray(yaml.IncludeDirs)) abort(`project.yaml: Invalid IncludeDirs field type "${typeof yaml.IncludeDirs}". Expected array or null.`);
            if (yaml.IncludeDirs.some(dir => typeof dir !== 'string')) abort(`project.yaml: Invalid IncludeDirs array value type. Expected string.`);
            this.includeDirs = yaml.IncludeDirs.map(dir => {
                if (!dir) abort('project.yaml: IncludeDirs array value must not be empty string.');
                return path.resolve(projectDir, this.processStringVars(dir));
            });

            yaml.ExcludeDefaultBuildOptions ??= [];
            if (typeof yaml.ExcludeDefaultBuildOptions !== 'boolean' && !Array.isArray(yaml.ExcludeDefaultBuildOptions))
                abort(`project.yaml: Invalid ExcludeDefaultBuildOptions field type "${typeof yaml.ExcludeDefaultBuildOptions}". Expected array, boolean or null.`);
            if (Array.isArray(yaml.ExcludeDefaultBuildOptions) && yaml.ExcludeDefaultBuildOptions.some(opt => typeof opt !== 'string'))
                abort(`project.yaml: Invalid ExcludeDefaultBuildOptions array value type. Expected string.`);
            if (yaml.ExcludeDefaultBuildOptions === true) this.buildOptions = [];
            else {
                const exclDefBuildOpts = yaml.ExcludeDefaultBuildOptions;
                if (exclDefBuildOpts) {
                    const defBuildOpts = this.buildOptions.map(opt => opt.split('=')[0]);
                    if (!exclDefBuildOpts.every(opt => {
                        if (!opt) abort(`project.yaml: ExcludeDefaultBuildOptions array value must not be empty string.`);
                        return defBuildOpts.includes(opt);
                    })) abort(`project.yaml: Invalid ExcludeDefaultBuildOptions array value. Cannot exclude default build options that are not present.`);
                    this.buildOptions = this.buildOptions.filter(opt => !exclDefBuildOpts.includes(opt.split('=')[0] ?? ''));
                }
            }

            yaml.BuildOptions ??= [];
            if (!Array.isArray(yaml.BuildOptions)) abort(`project.yaml: Invalid BuildOptions field type "${typeof yaml.BuildOptions}". Expected array or null.`);
            if (yaml.BuildOptions.some(opt => typeof opt !== 'string')) abort(`project.yaml: Invalid BuildOptions array value type. Expected string.`);
            this.buildOptions.push(...yaml.BuildOptions.map(opt => {
                if (!opt) abort('project.yaml: BuildOptions array value must not be empty string.');
                return this.processStringVars(opt);
            }));

            yaml.Modules ??= [];
            if (!Array.isArray(yaml.Modules)) abort(`project.yaml: Invalid Modules field type "${typeof yaml.Modules}". Expected array or null.`);
            if (yaml.Modules.some(mod => typeof mod !== 'string' || mod === '')) abort(`project.yaml: Invalid Modules array value type. Expected non-empty string.`);

            yaml.MinAlign ??= {};
            yaml.MinAlign['.text'] ??= 0x20;
            yaml.MinAlign['.rodata'] ??= 0x20;
            yaml.MinAlign['.data'] ??= 0x20;
            yaml.MinAlign['.bss'] ??= 0x40;
            if (typeof yaml.MinAlign !== 'object') abort(`project.yaml: Invalid MinAlign field type "${typeof yaml.MinAlign}". Expected object or null.`);
            if (Object.values(yaml.MinAlign).some(val => !Number.isSafeInteger(val))) abort(`project.yaml: Invalid MinAlign object field type "${typeof yaml.MinAlign}". Expected integer.`);
            this.minAligns = yaml.MinAlign;

            if (!yaml.Targets) abort('project.yaml has no Targets!');

            const processTarget = (targetName: string, depth = 0, isArrayExtends = false) => {
                if (!(targetName in yaml.Targets)) abort(`project.yaml: Target ${targetName} not found!`);
                const tgt = yaml.Targets[targetName] ?? {};
                if (typeof tgt !== 'object') abort(`project.yaml: Target ${targetName} is not an object! (Got ${typeof tgt})`);
                if (depth === 0 && tgt.Abstract) abort(`Target ${targetName} is abstract!`);
                if (depth && !tgt.Abstract) abort(`Target ${targetName} is not abstract and cannot be extended!`);
                if (tgt.Extends && isArrayExtends) abort(`Target ${targetName} cannot extend another target due to being part of array extension!`);
                tgt['Remove/Modules'] ??= [];
                tgt['Add/Modules'] ??= [];
                tgt['Remove/BuildOptions'] ??= [];
                tgt['Add/BuildOptions'] ??= [];

                if (typeof tgt.Extends === 'string') processTarget(tgt.Extends, depth + 1);
                else if (Array.isArray(tgt.Extends)) for (const ext of tgt.Extends) processTarget(ext, depth + 1, true);
                else if (tgt.Extends) abort(`Target ${targetName} Extends invalid value ${String(tgt.Extends)}.`);

                if (tgt.AddrMap === '@self') tgt.AddrMap = targetName;
                if (tgt.BaseRpx === '@self') tgt.BaseRpx = targetName;
                if (tgt.AddrMap === '@inherit') {
                    if (!tgt.Extends) abort(`Target ${targetName} AddrMap is @inherit but target is not extending another target!`);
                    else tgt.AddrMap = null;
                }
                if (tgt.BaseRpx === '@inherit') {
                    if (!tgt.Extends) abort(`Target ${targetName} BaseRpx is @inherit but target is not extending another target!`);
                    else tgt.BaseRpx = null;
                }
                if (!tgt.Extends) {
                    if (!tgt.AddrMap) tgt.AddrMap = targetName;
                    if (!tgt.BaseRpx) tgt.BaseRpx = targetName;
                }
                if (tgt.AddrMap) this.targetAddrMap = tgt.AddrMap;
                if (tgt.BaseRpx) this.targetBaseRpx = tgt.BaseRpx;

                for (const rmvModule of tgt['Remove/Modules']!) {
                    if (!yaml.Modules!.includes(rmvModule)) abort(`Target ${targetName} Remove/Modules contains module ${rmvModule} not present in current Modules list!`);
                    yaml.Modules = yaml.Modules!.filter(module => module !== rmvModule);
                }
                for (const addModule of tgt['Add/Modules']!) {
                    if (yaml.Modules!.includes(addModule)) abort(`Target ${targetName} Add/Modules contains module ${addModule} already present in current Modules list!`);
                        yaml.Modules!.push(addModule);
                }
                for (const rmvBuildOptRaw of tgt['Remove/BuildOptions']!) {
                    const rmvBuildOpt = this.processStringVars(rmvBuildOptRaw);
                    if (!this.buildOptions.includes(rmvBuildOpt)) abort(`Target ${targetName} Remove/BuildOptions contains build option ${rmvBuildOpt} not present in current BuildOptions list!`);
                    this.buildOptions = this.buildOptions.filter(opt => opt !== rmvBuildOpt);
                }
                for (const addBuildOptRaw of tgt['Add/BuildOptions']!) {
                    const addBuildOpt = this.processStringVars(addBuildOptRaw);
                    if (this.buildOptions.includes(addBuildOpt)) abort(`Target ${targetName} Add/BuildOptions contains build option ${addBuildOpt} already present in current BuildOptions list!`);
                    this.buildOptions.push(addBuildOpt);
                }
            };
            processTarget(target);

            for (const module of yaml.Modules) {
                const moduleobj = new Module(path.join(this.modulesBaseDir, this.processStringVars(module) + '.yaml'));
                this.modules.push(moduleobj);
            }
            //if (consoleOutput !== 'none') this.targetAddrMap += `-${consoleOutput}`;
        } catch {
            abort('Invalid project.yaml!');
        }

        // Verify tools
        if (
            !fs.existsSync(path.join(this.ghsPath, 'gbuild.exe')) ||
            !fs.existsSync(path.join(this.ghsPath, 'asppc.exe')) ||
            !fs.existsSync(path.join(this.ghsPath, 'elxr.exe'))
        ) abort('Could not locate Green Hills Software MULTI!');
    }

    public processStringVars(input: string): string {
        if (!input.includes('$')) return input;
        return input.replaceAll(/\$(\w*)/g, (_, varname: string) => {
            if (!(varname in this.vars)) abort(`YAML Variable "${varname}" not found!`);
            const varvalue = this.vars[varname];
            if (typeof varvalue !== 'string') abort(`YAML Variable "${varname}" value is not a string!`);
            if (varvalue.includes('$')) return abort(`YAML Variable "${varname}" value contains invalid character "$"!`);
            return varvalue;
        });
    }

    public createGPJ(consoleOutput: 'cafeloader' | 'none', extraCompilerFlagsCLI: string[] = []): void {
        for (const module of this.modules) {
            for (const file of module.cppFiles) {
                this.cppFiles.push(file);
            }
            for (const file of module.asmFiles) {
                this.asmFiles.push(file);
            }
        }
        const gpj: string[] = [];
        gpj.push(`#!gbuild
primaryTarget=ppc_cos_ndebug.tgt
[Project]
\t-object_dir=objs
\t-MD
\t-cpu=espresso
\t-sda=none
\t--no_commons
\t${this.buildOptions.join(' ')}
\t${extraCompilerFlagsCLI.join(' ')}
\t${this.includeDirs.map(dir => `-I${path.relative(this.path, dir)}`).join(' ')}`
        );
        if (consoleOutput !== 'none') gpj.push(`\t-DCONSOLE=${consoleOutput}`);
        for (const cpp of this.cppFiles)   gpj.push(path.join(/*path.relative(this.path, this.sourcesBaseDir),*/ cpp));
        fs.writeFileSync(path.join(this.path, 'project.gpj'), gpj.join('\n'));
    }

    public link(map: SymbolMap, extraLinkerFlags: string[]): void {
        fs.writeFileSync(path.join(this.path, 'linker', this.targetAddrMap) + '.ld', `MEMORY {
\ttext : origin = 0x${hex(map.converter.text)}, length = 0x${hex(DataBaseAddress - map.converter.text)}
\tdata : origin = 0x${hex(map.converter.data)}, length = 0x${hex(LoadBaseAddress - map.converter.data)}
}

OPTION("-append")

SECTIONS {
\t.text   : > text
\t.rodata : > data
\t.data   : > data
\t.bss    : > data
}`
        );

        const elxrCommand = path.join(this.ghsPath, 'elxr.exe');
        let elxrArgs = [
            '-T', path.join(this.path, 'maps', this.targetAddrMap + '.x'),
            '-T', path.join(this.path, 'linker', this.targetAddrMap + '.ld'),
            '-o', path.join(this.path, this.name + '.o'), ...extraLinkerFlags
        ];
        let objFiles: string[] = [];

        for (const cppfile of this.cppFiles) objFiles.push(cppfile.replace('.cpp', '.o'));
        for (const asmfile of this.asmFiles) objFiles.push(asmfile + '.o');
        for (const file of objFiles) {
            elxrArgs.push(path.join(this.path, 'objs', path.basename(file)));
        }
        const elxr = spawnSync(elxrCommand, elxrArgs, { cwd: this.path, stdio: 'inherit' });
        if (elxr.error || elxr.signal || elxr.stderr || elxr.status !== 0) abort('exlr command failed!');
    }

    public patches(): Patch[] {
        let output: Patch[] = [];
        for (const module of this.modules) {
            for (const hook of module.hooks) {
                output.push(hook.get());
            }
        }
        return output;
    }

    path: string;
    name: string;
    vars: Record<string, string> = {};
    rpxDir: string;
    modulesBaseDir: string;
    sourceDir: string;
    includeDirs: string[];
    buildOptions: string[] = [
        '-c99',
        '--g++',
        '--link_once_templates',
        '--enable_noinline',
        '--max_inlining',
        '--no_exceptions',
        '--no_rtti',
        '--no_implicit_include',
        '-no_ansi_alias',
        '-only_explicit_reg_use',
        '-kanji=shiftjis',
        '-Ospeed',
        '-Onounroll',
        '-Dcafe',
    ];
    minAligns: Record<string, number>;
    ghsPath: string;
    modules: Module[] = [];
    defines: string[] = [];
    targetAddrMap!: string;
    targetBaseRpx!: string;
    cppFiles: string[] = [];
    asmFiles: string[] = [];
}
