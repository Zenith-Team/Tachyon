import fs from 'fs';
import path from 'path';
import { DataBaseAddress, LoadBaseAddress } from 'rpxlib';
import yamlLib from 'yaml';
import { Patch } from './hooks';
import { Module } from './module';
import { SymbolMap } from './symbolmap';
import { abort, hex, WindowsPath } from './utils';
import syslib from './syslib';

interface ProjectYAML {
    Name: string;
    Modules: string[];
    Defines: string[];
}

export class Project {
    constructor(projectPath: string, ghsPath: string) {
        this.path = projectPath;

        try {
            const yaml: ProjectYAML = yamlLib.parse(fs.readFileSync(path.join(projectPath, 'project.yaml'), 'utf8'));

            this.name = yaml.Name;
            for (const module of yaml.Modules) {
                const moduleobj = new Module(path.join(projectPath, 'modules', module));
                this.modules.push(moduleobj);
            }
            this.ghsPath = ghsPath;
            this.defines = yaml.Defines ?? [];
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

        this.gpj.push('#!gbuild'
                    , 'primaryTarget=ppc_cos_ndebug.tgt'
                    , '[Project]'
                    , '\t-object_dir=objs'
                    , '\t--no_commons'
                    , '\t-c99'
                    , '\t-only_explicit_reg_use'
                    , '\t--g++'
                    , '\t--link_once_templates'
                    , '\t-cpu=espresso'
                    , '\t-sda=none'
                    , '\t-kanji=shiftjis'
                    , '\t--no_exceptions'
                    , '\t--no_rtti'
                    , '\t--no_implicit_include'
                    , '\t--implicit_typename'
                    , '\t--diag_suppress 1931,1974,1822,381'
                    , '\t--enable_noinline'
                    , '\t-Ospeed'
                    , '\t-no_ansi_alias'
                    , '\t--max_inlining'
                    , '\t-Onounroll'
                    , '\t-MD'
                    , '\t-Iinclude');

        for (const define of this.defines) this.gpj.push('\t-D' + define);
        for (const cpp of this.cppFiles)   this.gpj.push('source/' + cpp);

        fs.writeFileSync(path.join(this.path, 'project.gpj'), this.gpj.join('\n'));
    }

    public link(region: string, map: SymbolMap): void {
        let linkerDirective: string[] = [];

        linkerDirective.push('MEMORY {'
                           , '\ttext : origin = 0x' + hex(map.converter.text)
                           + ', length = 0x' + hex(DataBaseAddress - map.converter.text)
                           , '\tdata : origin = 0x' + hex(map.converter.data)
                           + ', length = 0x' + hex(LoadBaseAddress - map.converter.data)
                           , '}'
                           , '\nOPTION("-append")'
                           , '\nSECTIONS {'
                           , '\t.text   : > text'
                           , '\t.rodata : > data'
                           , '\t.data   : > data'
                           , '\t.bss    : > data'
                           , '}');

        fs.writeFileSync(path.join(this.path, 'linker', region) + '.ld', linkerDirective.join('\n'));

        let elxrCommand = [
            path.join(this.ghsPath, 'elxr.exe'), '-T', WindowsPath(path.join(this.path, 'syms', region) + '.x'), '-T',
            WindowsPath(path.join(this.path, 'linker', region) + '.ld'), '-o', WindowsPath(path.join(this.path, this.name) + '.o')
        ];
        let objFiles: string[] = [];

        for (const cppfile of this.cppFiles) objFiles.push(cppfile.replace('.cpp', '.o'));
        for (const asmfile of this.asmFiles) objFiles.push(path.basename(asmfile) + '.o');
        for (const file of objFiles) {
            elxrCommand.push(WindowsPath(path.join(this.path, 'objs', path.basename(file))));
        }
        const elxr = syslib.exec(elxrCommand, { cwd: this.path, stdout: 'inherit', stderr: 'inherit' });
        if (!elxr.isExecuted || elxr.exitCode || elxr.stderr) abort('exlr command failed!');
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
    modules: Module[] = [];
    ghsPath: string;
    defines: string[] = [];
    cppFiles: string[] = [];
    asmFiles: string[] = [];
    gpj: string[] = [];
}
