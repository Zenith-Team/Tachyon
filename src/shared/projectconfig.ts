import $ from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { Project, ProjectBaseBuildOpts } from './project.js';
import { abort, CommonFiles, isSafeFilename, TitleID } from '../utils.js';
export const ToolWURPLSVersion = '1.0' as const;
const ValidModuleTypes = ['Special', 'CoreMod', 'CoreAPI', 'Standard'] as const;
export type ModuleType = typeof ValidModuleTypes[number];
export interface ProjectConfig {
    readonly version: string;
    readonly name: string;
    readonly description: string;
    readonly freestanding: boolean;
    readonly initless: boolean;
    readonly type: ModuleType;
    readonly variables: Record<string, string>;
    readonly sourceDirs: string[];
    readonly includeDirs: string[];
    readonly precompiledHeader: string | null;
    readonly userIncludeDirs: ReadonlyArray<string>;
    readonly convMapProvider: string;
    readonly targets: Readonly<Record<string, ProjectConfigFileTarget | null>>;
    buildOptions: string[];
    targetTitleID?: bigint;
    activeTargetName?: string;
}
export interface ProjectConfigFile {
    WURPLSVersion: string;
    Type: ModuleType;
    Version: string;
    Name: string;
    Description?: string;
    Freestanding?: boolean;
    Initless?: boolean;
    Variables?: Record<string, string> | null;
    SourceDirs?: string[] | null;
    IncludeDirs?: string[] | null;
    PrecompiledHeader?: string | null;
    BuildOptions?: string[] | null;
    ExcludeDefaultBuildOptions?: string[] | boolean | null;
    ConvMapProvider?: string;
    Targets: Record<string, ProjectConfigFileTarget | null>;
}
interface ProjectConfigFileTarget {
    AbstractOnly?: boolean | null;
    Extends?: string | string[] | null;
    AddrMap?: string | null;
    TitleID?: string;
    'Remove/BuildOptions'?: string[] | null;
    'Add/BuildOptions'?: string[] | null;
}
export interface ProjectCacheJson {
    config_mtime: number;
    last_cli_hash: string;
}
export const AssertField = {
    Type(name: string, value: unknown, type: 'boolean' | 'number' | 'string', required = false) {
        if ((required || value != null) && typeof value !== type)
            configError(required && value == null
                ? `Missing required "${name}" ${type} field.`
                : `Invalid "${name}" field type "${typeof value}". Expected ${type}.`);
        if (typeof value === 'string' && value.trim().length === 0)
            abort(`"${name}" field must not be empty string.`);
    },
    Object(name: string, value: unknown, required = false) {
        const isObject = typeof value === 'object' && value != null && !Array.isArray(value);
        if ((required || value != null) && !isObject)
            configError(required && value == null
                ? `Missing required "${name}" object field.`
                : `Invalid "${name}" field type "${typeof value}". Expected object.`);
    },
    Array(name: string, value: unknown, required = false) {
        if ((required || value != null) && !Array.isArray(value))
            configError(required && value == null
                ? `Missing required "${name}" array field.`
                : `Invalid "${name}" field type "${typeof value}". Expected array.`);
        if (required && value?.length === 0)
            abort(`"${name}" field must not be empty array.`);
    }
};
export function loadProjectConfig(projPath: string, excludedCompilerFlags: string[] = []): ProjectConfig {
    try {
        const config = JSON5.parse<ProjectConfigFile>(fs.readFileSync(path.join(projPath, CommonFiles.Config), 'utf8'));
        AssertField.Object('Variables', config.Variables);
        const variables = config.Variables ?? {};
        AssertField.Type('WURPLSVersion', config.WURPLSVersion, 'string', true);
        const projWURPLSVer = config.WURPLSVersion;
        if (projWURPLSVer !== '1.0')
            configError(`WURPLSVersion is ${projWURPLSVer}, expected 1.0.`);
        AssertField.Type('Name', config.Name, 'string', true);
        const name = processStringVars(config.Name, variables);
        if (!isSafeFilename(name))
            configError('Invalid project Name, it can only contain the characters: a-z, A-Z, 0-9, and _ - ! @ + ; = # ^\nThe name must also be under 32 characters in length and cannot begin or end with "-"');
        AssertField.Type('Description', config.Description, 'string');
        const description = processStringVars(config.Description?.trim() || 'A Telkin mod.', variables);
        AssertField.Type('Version', config.Version, 'string', true);
        const version = processStringVars(config.Version, variables);
        AssertField.Type('Freestanding', config.Freestanding, 'boolean');
        const freestanding = config.Freestanding ?? false;
        AssertField.Type('Initless', config.Initless, 'boolean');
        const initless = config.Initless ?? false;
        AssertField.Type('Type', config.Type, 'string', true);
        const type = config.Type;
        const validTypes = name === 'Telkin' ? ValidModuleTypes : ValidModuleTypes.filter(t => t !== 'Special');
        // @ts-expect-error ----------
        if (!validTypes.includes(type))
            configError(`Invalid project Type, must be one of: ${ValidModuleTypes.join(', ')}`);
        AssertField.Array('SourceDirs', config.SourceDirs);
        config.SourceDirs ??= ['src'];
        const sourceDirs = config.SourceDirs.map((dir, i) => {
            if (typeof dir !== 'string' || !dir.trim())
                configError(`Invalid SourceDirs[${i}] array item type. Expected non-empty string.`);
            return path.resolve(projPath, processStringVars(dir, variables));
        });
        AssertField.Array('IncludeDirs', config.IncludeDirs);
        config.IncludeDirs ??= [];
        const includeDirs = config.IncludeDirs.map((dir, i) => {
            if (typeof dir !== 'string' || !dir.trim())
                configError(`Invalid IncludeDirs[${i}] array item type. Expected non-empty string.`);
            return path.resolve(projPath, processStringVars(dir, variables));
        });
        AssertField.Type('PrecompiledHeader', config.PrecompiledHeader, 'string');
        const precompiledHeader = config.PrecompiledHeader ?? null;
        let buildOptions: string[] = [...ProjectBaseBuildOpts];
        if (config.ExcludeDefaultBuildOptions === true)
            buildOptions = [];
        else {
            if (!Array.isArray(config.ExcludeDefaultBuildOptions) &&
                config.ExcludeDefaultBuildOptions !== false &&
                config.ExcludeDefaultBuildOptions != null)
                configError(`Invalid ExcludeDefaultBuildOptions field type "${typeof config.ExcludeDefaultBuildOptions}". Expected array, boolean, or null.`);
            const exclDefBuildOpts = config.ExcludeDefaultBuildOptions
                ? config.ExcludeDefaultBuildOptions.concat(excludedCompilerFlags)
                : excludedCompilerFlags;
            if (exclDefBuildOpts.length > 0) {
                const defBuildOpts = buildOptions.map(opt => opt.split('=')[0]!);
                exclDefBuildOpts.forEach((opt, i) => {
                    if (typeof opt !== 'string' || !opt.trim())
                        configError(`Invalid ExcludeDefaultBuildOptions[${i}] array item type. Expected non-empty string.`);
                    exclDefBuildOpts[i] = opt = processStringVars(opt, variables);
                    if (!defBuildOpts.includes(opt))
                        configError(`Invalid ExcludeDefaultBuildOptions[${i}] array item value. Cannot exclude default build options that are not present. (${opt})`);
                });
                buildOptions = buildOptions.filter(opt => !exclDefBuildOpts.includes(opt.split('=')[0]!));
            }
        }
        AssertField.Array('BuildOptions', config.BuildOptions);
        config.BuildOptions ??= [];
        buildOptions.push(...config.BuildOptions.map((opt, i) => {
            if (typeof opt !== 'string' || !opt.trim())
                configError(`Invalid BuildOptions[${i}] array item type. Expected non-empty string.`);
            return processStringVars(opt, variables);
        }));
        AssertField.Type('ConvMapProvider', config.ConvMapProvider, 'string');
        const convMapProvider = config.ConvMapProvider ?? '';
        AssertField.Object('Targets', config.Targets, true);
        const targets = config.Targets;
        const targetCount = Object.keys(targets).length;
        if (targetCount === 0)
            configError('Project has no targets.');
        if (freestanding && targetCount !== 1)
            configError('Freestanding project may only have 1 target.');
        return {
            variables,
            name, description, version, freestanding, initless, type,
            sourceDirs, includeDirs, userIncludeDirs: [...includeDirs],
            precompiledHeader,
            buildOptions,
            convMapProvider,
            targets,
        } satisfies ProjectConfig;
    }
    catch (error) {
        const err = error as Error | undefined;
        const extra = err?.message ? ` (${err.message})` : '';
        console.debug('JSON5 read error:', error);
        configError('Failed to parse, invalid JSON5 syntax/structure.' + extra);
    }
}
const seenTargetTitleIDsByConfig = new Map<ProjectConfig, Set<bigint>>();
export function configureTarget(config: ProjectConfig, target: string, baseBuildOptions: string[] = [...ProjectBaseBuildOpts], targetConsole: boolean) {
    config.activeTargetName = target;
    config.targetTitleID = undefined;
    config.buildOptions = baseBuildOptions;
    if (!seenTargetTitleIDsByConfig.has(config))
        seenTargetTitleIDsByConfig.set(config, new Set<bigint>());
    const seenTargetTitleIDs = seenTargetTitleIDsByConfig.get(config)!;
    const processTarget = (targetName: string, depth = 0, isArrayExtends = false) => {
        if (!isSafeFilename(targetName))
            configError(`Invalid target name "${targetName}", it can only contain the characters: a-z, A-Z, 0-9, and _ - ! @ + ; = # ^\n` +
                'The name must also be under 32 characters in length and cannot begin or end with "-"');
        if (!(targetName in config.targets)) {
            const availableTargets: string[] = [];
            for (const targetName in config.targets) {
                const target = config.targets[targetName];
                if (target?.AbstractOnly)
                    continue;
                const TID = target?.TitleID ? ` [${$.magenta(target.TitleID)}]` : $.magenta.dim(' (no TitleID)');
                availableTargets.push(`${$.yellowBright(targetName)}${$.white(TID)}`);
            }
            configError(`Target "${targetName}" not found! Available targets for this project:\n        ${$.white('>')} ` +
                availableTargets.join(`\n        ${$.white('>')} `));
        }
        const tgt = config.targets[targetName] ?? {};
        if (typeof tgt !== 'object')
            configError(`Target "${targetName}" is not an object! (Got ${typeof tgt})`);
        if (depth === 0 && tgt.AbstractOnly)
            configError(`Cannot build abstract-only target "${targetName}"!`);
        if (tgt.Extends && isArrayExtends)
            configError(`Target "${targetName}" cannot extend another target due to being part of array extension!`);
        if (typeof tgt.Extends === 'string')
            processTarget(tgt.Extends, depth + 1);
        else if (Array.isArray(tgt.Extends))
            for (const ext of tgt.Extends)
                processTarget(ext, depth + 1, true);
        else if (tgt.Extends != null)
            configError(`Target "${targetName}" Extends invalid value ${String(tgt.Extends)}.`);
        if (config.freestanding) {
            if (tgt.AddrMap !== undefined)
                configError(`Invalid target "${targetName}" field: AddrMap cannot be specified in Freestanding projects.`);
            if (tgt.TitleID !== undefined)
                configError(`Invalid target "${targetName}" field: TitleID cannot be specified in Freestanding projects.`);
            config.targetTitleID = 0n;
        }
        else {
            AssertField.Type(`Targets[${targetName}].TitleID`, tgt.TitleID, 'string', true);
            let parsedTitleID = TitleID.parse(tgt.TitleID!);
            if (parsedTitleID === null)
                configError(`Invalid target "${targetName}" field: Invalid TitleID value (expected format: "FFFFFFFF-FFFFFFFF").`);
            if (targetConsole)
                parsedTitleID = TitleID.addConsoleTag(parsedTitleID);
            config.targetTitleID = parsedTitleID;
            if (seenTargetTitleIDs.has(parsedTitleID))
                configError(`Invalid targets selection for project "${config.name}", ` +
                    `the target "${targetName}" shares the Title ID "${tgt.TitleID!}" with at least 1 other requested target.\n` +
                    'Targets with matching Title IDs cannot be compiled/packaged together.');
            seenTargetTitleIDs.add(parsedTitleID);
        }
        AssertField.Array(`Targets[${targetName}]."Remove/BuildOptions"`, tgt['Remove/BuildOptions']);
        AssertField.Array(`Targets[${targetName}]."Add/BuildOptions"`, tgt['Add/BuildOptions']);
        tgt['Remove/BuildOptions'] ??= [];
        tgt['Add/BuildOptions'] ??= [];
        for (const rmvBuildOptRaw of tgt['Remove/BuildOptions']) {
            if (typeof rmvBuildOptRaw !== 'string' || !rmvBuildOptRaw.trim())
                configError(`Invalid Targets[${targetName}]."Remove/BuildOptions" array item type. Expected non-empty string.`);
            const rmvBuildOpt = processStringVars(rmvBuildOptRaw, config.variables);
            if (!config.buildOptions.includes(rmvBuildOpt))
                configError(`Target "${targetName}" Remove/BuildOptions contains build option ${rmvBuildOpt} not present in current BuildOptions list!`);
            config.buildOptions = config.buildOptions.filter(opt => opt !== rmvBuildOpt);
        }
        for (const addBuildOptRaw of tgt['Add/BuildOptions']) {
            if (typeof addBuildOptRaw !== 'string' || !addBuildOptRaw.trim())
                configError(`Invalid Targets[${targetName}]."Add/BuildOptions" array item type. Expected non-empty string.`);
            const addBuildOpt = processStringVars(addBuildOptRaw, config.variables);
            if (config.buildOptions.includes(addBuildOpt))
                configError(`Target "${targetName}" Add/BuildOptions contains build option ${addBuildOpt} already present in current BuildOptions list!`);
            config.buildOptions.push(addBuildOpt);
        }
    };
    processTarget(target);
    config.buildOptions.push(...Project.requiredBuildOptions);
}
function configError(errmsg: string): never {
    abort(`${CommonFiles.Config}: ${errmsg}`);
}
export function processStringVars(input: string, vars: Record<string, string>): string {
    input = input.trim();
    if (!input.includes('$'))
        return input;
    return input.replaceAll(/\$(\w*)/g, (_, varname: string) => {
        if (!(varname in vars))
            configError(`Variable "${varname}" not found!`);
        const varvalue = vars[varname];
        if (typeof varvalue !== 'string')
            configError(`Variable "${varname}" value is not a string!`);
        if (!varvalue)
            configError(`Variable "${varname}" value must not be empty string.`);
        if (varvalue.includes('$'))
            configError(`Variable "${varname}" value contains invalid character "$"!`);
        return varvalue;
    });
}
