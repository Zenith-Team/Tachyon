import * as semver from 'semver';
import type { PackageVersionRegistry } from './pkg-registry.js';
interface PackageConstraintInfo {
    readonly constraint: string;
    readonly deps: PackageConstraintsTree;
}
export type PackageConstraintsTree = Record<string, PackageConstraintInfo>;
export type ResolvedPackageVersionsMap = Record<string, string>;
type PackageConstraintRegistry = Record<string, string[]>;
function flattenConstraintsTreeToRegistry(packagesTree: PackageConstraintsTree, _constraints: PackageConstraintRegistry = {}, _visited = new Set<string>()) {
    for (const [name, pkg] of Object.entries(packagesTree)) {
        if (_visited.has(name))
            throw new Error(`Circular dependency detected: "${name}" appears in its own dependency chain. Please resolve the cycle to continue.`);
        _constraints[name] ??= [];
        _constraints[name].push(pkg.constraint);
        _visited.add(name);
        flattenConstraintsTreeToRegistry(pkg.deps, _constraints, _visited);
        _visited.delete(name);
    }
    return _constraints;
}
export function resolve(constraintsTree: PackageConstraintsTree, registry: PackageVersionRegistry, pre: boolean = false): ResolvedPackageVersionsMap {
    const constraintsRegistry = flattenConstraintsTreeToRegistry(constraintsTree);
    const resolved: ResolvedPackageVersionsMap = {};
    for (const name in constraintsRegistry) {
        const packageConstraints = constraintsRegistry[name]!;
        const availableVersions = registry[name];
        if (!availableVersions || availableVersions.length === 0) {
            throw new Error(`No versions available for package "${name}" in the registry.`);
        }
        for (const constraint of packageConstraints) {
            if (semver.validRange(constraint) === null) {
                throw new Error(`Invalid semantic version constraint for package "${name}": ${constraint}`);
            }
        }
        const concreteVersions = availableVersions.map(version => {
            const concreteVersion = semver.valid(version);
            if (!concreteVersion) {
                throw new Error(`Invalid concrete version for package "${name}" in the registry: ${version}`);
            }
            return concreteVersion;
        });
        const satisfyingVersions = concreteVersions.filter(version => {
            return packageConstraints.every(constraint => semver.satisfies(version, constraint, pre ? { includePrerelease: true } : undefined));
        });
        if (satisfyingVersions.length === 0) {
            throw new Error(`Could not find a compatible version for package "${name}" that satisfies all constraints: ${packageConstraints.join(', ')}`);
        }
        const maxVersion = semver.maxSatisfying(satisfyingVersions, '*', { includePrerelease: true });
        if (!maxVersion) {
            throw new Error(`Could not determine maximum satisfying version for "${name}"`);
        }
        resolved[name] = maxVersion;
    }
    return resolved;
}
