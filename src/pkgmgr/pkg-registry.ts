import { resolve, type PackageConstraintsTree, type ResolvedPackageVersionsMap } from './resolution.js';
import type { GitHubRelease } from './github-release.js';
import { locationType, normalizeGitHubRepoRef, PkgInstallSourceLocationType } from './pkg-resolver.js';
import semver from 'semver';
import type { DirectDependency } from './lockfile.js';
import { abort } from '../utils.js';
export type PackageVersionRegistry = Record<string, string[]>;
export async function queryAllGitHubVersions(ghRef: string): Promise<string[]> {
    const releases: string[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
        const url = `https://api.github.com/repos/${ghRef}/releases?per_page=${100}&page=${page}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!resp.ok || !resp.body) {
            if (resp.status === 404 && page === 1)
                abort.thrown(`No versions found for "${ghRef}"`);
            throw new Error(`GitHub API error for "${ghRef}": ${resp.status} ${resp.statusText}`);
        }
        const data = await resp.json() as GitHubRelease[];
        if (!Array.isArray(data))
            throw new Error(`Unexpected GitHub API response for "${ghRef}"`);
        const validTags = data.flatMap(release => {
            const version = semver.valid(release.tag_name);
            return version ? [version] : [];
        });
        releases.push(...validTags);
        hasMore = data.length === 100;
        page++;
    }
    return releases;
}
function directDepToResolutionInput(deps: Record<string, DirectDependency>, depChain = new Set<string>()): PackageConstraintsTree {
    const resInput = Object.create(null) as PackageConstraintsTree;
    for (const [depName, dep] of Object.entries(deps)) {
        if (depChain.has(depName)) {
            throw new Error(`Circular dependency detected: "${depName}" appears in its own dependency chain.`);
        }
        else
            depChain.add(depName);
        if (depName in resInput)
            throw new Error('Internal assertion failure [code:DDTRI]');
        if (semver.validRange(dep.Version) === null) {
            throw new Error(`Invalid semantic version constraint for package "${depName}": ${dep.Version}`);
        }
        resInput[depName] = { constraint: dep.Version, deps: {} };
        if (dep.Dependencies) {
            const subDeps = directDepToResolutionInput(dep.Dependencies, depChain);
            Object.assign(resInput[depName].deps, subDeps);
        }
        depChain.delete(depName);
    }
    return resInput;
}
function filterResolutionInput(input: PackageConstraintsTree, registry: PackageVersionRegistry): PackageConstraintsTree {
    const result: PackageConstraintsTree = {};
    for (const [name, pkg] of Object.entries(input)) {
        if (registry[name] && registry[name].length > 0) {
            result[name] = {
                constraint: pkg.constraint,
                deps: filterResolutionInput(pkg.deps, registry),
            };
        }
        else
            Object.assign(result, filterResolutionInput(pkg.deps, registry));
    }
    return result;
}
export async function buildRegistryFromDirectDeps(directDeps: Record<string, DirectDependency>): Promise<PackageVersionRegistry> {
    const registry: PackageVersionRegistry = {};
    const githubRepos = new Map<string, string>();
    const walkDeps = async (deps: Record<string, DirectDependency>, depChain = new Set<string>()) => {
        for (const [name, dep] of Object.entries(deps)) {
            if (depChain.has(name)) {
                throw new Error(`Circular dependency detected: "${name}" appears in its own dependency chain.`);
            }
            else
                depChain.add(name);
            if (!dep.Source)
                continue;
            if ((await locationType(name, dep.Source)) === PkgInstallSourceLocationType.GitHubRepo) {
                dep.Source = normalizeGitHubRepoRef(dep.Source);
                githubRepos.set(dep.Source, name);
            }
            if (dep.Dependencies) {
                await walkDeps(dep.Dependencies, depChain);
            }
            depChain.delete(name);
        }
    };
    await walkDeps(directDeps);
    for (const [repo, name] of githubRepos) {
        const versions = await queryAllGitHubVersions(repo);
        registry[name] = versions;
    }
    return registry;
}
export async function resolvePackageVersions(directDeps: Record<string, DirectDependency>, registry?: PackageVersionRegistry, pre: boolean = false): Promise<ResolvedPackageVersionsMap> {
    const resolutionInput = directDepToResolutionInput(directDeps);
    const finalRegistry = registry ?? await buildRegistryFromDirectDeps(directDeps);
    return resolve(filterResolutionInput(resolutionInput, finalRegistry), finalRegistry, pre);
}
