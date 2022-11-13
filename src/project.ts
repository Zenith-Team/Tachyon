import fs from 'fs';
import path from 'path';
import yamlLib from 'yaml';
import { Patch } from './hooks.js';
import { Module } from './module.js';
import { spawnSync } from 'child_process';
import { SymbolMap } from './symbolmap.js';
import { abort, hex } from './utils.js';
import { DataBaseAddress, LoadBaseAddress } from 'rpxlib';

interface ProjectYAML {
    Name: string, //! Required
    ModulesDir?: string, // Default: 'modules'
    IncludeDir?: string, // Default: 'include'
    SourceDir?: string, // Default: 'src'
    RpxDir?: string, // Default: 'rpxs'
    Defines?: string[], // Default: []
    Modules: string[], //! Required
    Targets: Record<string, ProjectTarget | null>, //! Required
}

interface ProjectTarget {
    Extends?: string, // Default: null
    AddrMap?: string, // Default: <TARGET_NAME>
    BaseRpx?: string, // Default: <TARGET_NAME>
    Defines?: string[], // Default: []
    Modules?: string[], // Default: []
    'Remove/Defines'?: string[], // Default: []
    'Remove/Modules'?: string[], // Default: []
}

export class Project {
    constructor(projectPath: string, metaPath: string, ghsPath: string, target: string) {
        this.path = projectPath;
        this.meta = metaPath;
        this.ghsPath = ghsPath;

        try {
            const yaml: ProjectYAML = yamlLib.parse(fs.readFileSync(path.join(metaPath, 'project.yaml'), 'utf8'));
            
            this.name = yaml.Name;
            yaml.ModulesDir ??= 'modules';
            yaml.IncludeDir ??= 'include';
            yaml.SourceDir ??= 'src';
            yaml.RpxDir ??= 'rpxs';
            this.modulesDir = yaml.ModulesDir.startsWith('+/') ? path.join(metaPath, yaml.ModulesDir.slice(2)) : path.resolve(projectPath, yaml.ModulesDir);
            this.includeDir = yaml.IncludeDir.startsWith('+/') ? path.join(metaPath, yaml.IncludeDir.slice(2)) : path.resolve(projectPath, yaml.IncludeDir);
            this.sourceDir = yaml.SourceDir.startsWith('+/') ? path.join(metaPath, yaml.SourceDir.slice(2)) : path.resolve(projectPath, yaml.SourceDir);
            this.rpxDir = yaml.RpxDir.startsWith('+/') ? path.join(metaPath, yaml.RpxDir.slice(2)) : path.resolve(projectPath, yaml.RpxDir);
            this.defines = yaml.Defines ?? [];

            if (target.startsWith('Template/')) abort('Cannot directly build a template target.');
            if (target in yaml.Targets) {
                const tgt = yaml.Targets[target] ?? {};
                tgt['Remove/Defines'] ??= [];
                tgt['Remove/Modules'] ??= [];
                tgt.Defines ??= [];
                tgt.Modules ??= [];
                if (tgt.Extends) {
                    const templateName = 'Template/' + tgt.Extends;
                    if (templateName in yaml.Targets) {
                        const template = yaml.Targets[templateName] ?? {};
                        if (template.Extends) abort(`Template target ${templateName} cannot extend other template targets.`);
                        tgt.AddrMap ??= template.AddrMap ?? tgt.Extends;
                        tgt.BaseRpx ??= template.BaseRpx ?? tgt.Extends;
                        tgt['Remove/Defines'].push(...(template['Remove/Defines'] ?? []));
                        tgt['Remove/Modules'].push(...(template['Remove/Modules'] ?? []));
                        tgt.Defines.push(...(template.Defines ?? []));
                        tgt.Modules.push(...(template.Modules ?? []));
                    } else abort(`Target ${target} extends unknown template ${tgt.Extends}.`);
                } else {
                    tgt.AddrMap ??= target;
                    tgt.BaseRpx ??= target;
                }
                this.defines = this.defines.filter(define => !tgt['Remove/Defines']!.includes(define));
                this.defines.push(...tgt.Defines);
                yaml.Modules = yaml.Modules.filter(module => !tgt['Remove/Modules']!.includes(module));
                yaml.Modules.push(...tgt.Modules);
                for (const module of yaml.Modules) {
                    const moduleobj = new Module(path.join(this.modulesDir, module));
                    this.modules.push(moduleobj);
                }
                this.targetAddrMap = tgt.AddrMap;
                this.targetBaseRpx = tgt.BaseRpx;
            } else abort(`Target ${target} not found on project.yaml!`);
        } catch (err) {
            abort('Invalid project.yaml!');
        }

        // Verify tools
        if (
            !fs.existsSync(path.join(this.ghsPath, 'gbuild.exe')) ||
            !fs.existsSync(path.join(this.ghsPath, 'asppc.exe')) ||
            !fs.existsSync(path.join(this.ghsPath, 'elxr.exe'))
        ) abort('Could not locate Green Hills Software MULTI!');
    }

    public createGPJ(): void {
        for (const module of this.modules) {
            for (const file of module.cppFiles) {
                this.cppFiles.push(file);
            }
            for (const file of module.asmFiles) {
                this.asmFiles.push(file);
            }
        }
        const gpj: string[] = [];
        gpj.push(
`#!gbuild
primaryTarget=ppc_cos_ndebug.tgt
[Project]
\t-object_dir=objs
\t--no_commons
\t-c99
\t-only_explicit_reg_use
\t--g++
\t--link_once_templates
\t-cpu=espresso
\t-sda=none
\t-kanji=shiftjis
\t--no_exceptions
\t--no_rtti
\t--no_implicit_include
\t--implicit_typename
\t--diag_suppress 1931,1974,1822,381
\t--enable_noinline
\t-Ospeed
\t-no_ansi_alias
\t--max_inlining
\t-Onounroll
\t-MD
\t-I${path.relative(this.meta, this.includeDir)}`
        );

        for (const define of this.defines) gpj.push(`\t-D${define}`);
        for (const cpp of this.cppFiles)   gpj.push(path.join(path.relative(this.meta, this.sourceDir), cpp));
        fs.writeFileSync(path.join(this.meta, 'project.gpj'), gpj.join('\n'));
    }

    public link(map: SymbolMap): void {
        fs.writeFileSync(path.join(this.meta, 'linker', this.targetAddrMap) + '.ld',
`MEMORY {
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
            '-T', path.join(this.meta, 'syms', this.targetAddrMap + '.x'),
            '-T', path.join(this.meta, 'linker', this.targetAddrMap + '.ld'),
            '-o', path.join(this.meta, this.name + '.o')
        ];
        let objFiles: string[] = [];

        for (const cppfile of this.cppFiles) objFiles.push(cppfile.replace('.cpp', '.o'));
        for (const asmfile of this.asmFiles) objFiles.push(asmfile + '.o');
        for (const file of objFiles) {
            elxrArgs.push(path.join(this.meta, 'objs', path.basename(file)));
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

    name: string;
    path: string;
    meta: string;
    modulesDir: string;
    includeDir: string;
    sourceDir: string;
    rpxDir: string;
    ghsPath: string;
    modules: Module[] = [];
    defines: string[] = [];
    targetAddrMap: string;
    targetBaseRpx: string;
    cppFiles: string[] = [];
    asmFiles: string[] = [];
}
