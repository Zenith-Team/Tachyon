import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { abort, randomShortUUID, toPortablePath } from '../utils.js';
import { AssertField, ToolWURPLSVersion } from '../shared/projectconfig.js';
import { githubRepoFromReleaseURL, isGitHubRepoRef, normalizeGitHubReleaseURL, normalizeGitHubRepoRef, } from './pkg-resolver.js';
export interface ILockfile {
    WURPLSLockfileVersion: string;
    DirectDependencies: Record<string, DirectDependency>;
    ResolvedDependencies: Record<string, ResolvedDependency>;
}
export interface ResolvedDependency {
    Current: string;
    Source: string;
    Hash: string;
    IncludeDirs: string[];
}
export interface DirectDependency {
    Source: string;
    Version: string;
    Dependencies?: Record<string, DirectDependency>;
}
export type Dependency = ResolvedDependency | DirectDependency;
export function isPinnedVersionConstraint(constraint: string): boolean {
    const normalizedRange = semver.validRange(constraint);
    return normalizedRange !== null && semver.valid(normalizedRange) !== null;
}
function normalizeDependencySources(directDependencies: Record<string, DirectDependency>, resolvedDependencies: Record<string, ResolvedDependency>): void {
    for (const dependency of Object.values(resolvedDependencies)) {
        if (typeof dependency.Source === 'string') {
            dependency.Source = normalizeGitHubReleaseURL(dependency.Source);
        }
    }
    const normalizeDirect = (dependencies: Record<string, DirectDependency>): void => {
        for (const [name, dependency] of Object.entries(dependencies)) {
            const resolvedSource = resolvedDependencies[name]?.Source;
            if (typeof dependency.Source === 'string'
                && isGitHubRepoRef(dependency.Source)
                && typeof resolvedSource === 'string'
                && githubRepoFromReleaseURL(resolvedSource)) {
                dependency.Source = normalizeGitHubRepoRef(dependency.Source);
            }
            if (dependency.Dependencies)
                normalizeDirect(dependency.Dependencies);
        }
    };
    normalizeDirect(directDependencies);
}
function validateDependencyVersions(directDependencies: Record<string, DirectDependency>, resolvedDependencies: Record<string, ResolvedDependency>): void {
    const validateDirect = (dependencies: Record<string, DirectDependency>, parentPath: string): void => {
        for (const [name, dependency] of Object.entries(dependencies)) {
            const dependencyPath = `${parentPath}.${name}`;
            if (typeof dependency.Version !== 'string' || semver.validRange(dependency.Version) === null) {
                abort.thrown(`Invalid lockfile ${dependencyPath}.Version: expected a semantic version range or pinned version.`);
            }
            if (dependency.Dependencies)
                validateDirect(dependency.Dependencies, `${dependencyPath}.Dependencies`);
        }
    };
    validateDirect(directDependencies, 'DirectDependencies');
    for (const [name, dependency] of Object.entries(resolvedDependencies)) {
        const current = typeof dependency.Current === 'string' ? semver.valid(dependency.Current) : null;
        if (!current) {
            abort.thrown(`Invalid lockfile ResolvedDependencies.${name}.Current: expected a fixed semantic version.`);
        }
        dependency.Current = current;
    }
}
export class Lockfile implements ILockfile {
    private constructor(private readonly filepath: string, public WURPLSLockfileVersion: string, public DirectDependencies: Record<string, DirectDependency>, public ResolvedDependencies: Record<string, ResolvedDependency>) { }
    static load(lockfilePath: string): Lockfile {
        let lockfile: ILockfile;
        try {
            const data = fs.readFileSync(lockfilePath, 'utf8');
            lockfile = JSON.parse(data) as ILockfile;
        }
        catch {
            abort.thrown(`Failed to read lockfile: ${lockfilePath}`);
        }
        AssertField.Type('WURPLSVersion', lockfile.WURPLSLockfileVersion, 'string', true);
        const projWURPLSVer = lockfile.WURPLSLockfileVersion;
        if (projWURPLSVer !== ToolWURPLSVersion)
            abort.thrown(`Project lockfile WURPLS version is ${projWURPLSVer}, expected ${ToolWURPLSVersion}.`);
        AssertField.Object('ResolvedDependencies', lockfile.ResolvedDependencies, true);
        AssertField.Object('DirectDependencies', lockfile.DirectDependencies, true);
        validateDependencyVersions(lockfile.DirectDependencies, lockfile.ResolvedDependencies);
        normalizeDependencySources(lockfile.DirectDependencies, lockfile.ResolvedDependencies);
        for (const dependency of Object.values(lockfile.ResolvedDependencies)) {
            if (Array.isArray(dependency.IncludeDirs)) {
                dependency.IncludeDirs = dependency.IncludeDirs.map(toPortablePath);
            }
        }
        return new Lockfile(lockfilePath, lockfile.WURPLSLockfileVersion, lockfile.DirectDependencies, lockfile.ResolvedDependencies);
    }
    public save(): void {
        validateDependencyVersions(this.DirectDependencies, this.ResolvedDependencies);
        normalizeDependencySources(this.DirectDependencies, this.ResolvedDependencies);
        try {
            const tmpPath = path.join(path.dirname(this.filepath), `.${path.basename(this.filepath)}-${randomShortUUID()}.tmp`);
            fs.writeFileSync(tmpPath, JSON.stringify({
                WURPLSLockfileVersion: this.WURPLSLockfileVersion,
                DirectDependencies: this.DirectDependencies,
                ResolvedDependencies: Object.fromEntries(Object.entries(this.ResolvedDependencies).map(([name, dependency]) => [name, {
                        ...dependency,
                        IncludeDirs: dependency.IncludeDirs.map(toPortablePath),
                    }])),
            }, null, 2));
            fs.renameSync(tmpPath, this.filepath);
        }
        catch (err) {
            abort.thrown(`An unexpected fatal error occured while attempting to save the lockfile: ${this.filepath}; ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
