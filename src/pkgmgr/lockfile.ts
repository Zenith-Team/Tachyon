import fs from 'node:fs';
import path from 'node:path';
import { abort, randomShortUUID } from '../utils.js';
import { AssertField, ToolWURPLSVersion } from '../shared/projectconfig.js';
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
export class Lockfile implements ILockfile {
    private constructor(private readonly filepath: string, public WURPLSLockfileVersion: string, public DirectDependencies: Record<string, DirectDependency>, public ResolvedDependencies: Record<string, ResolvedDependency>) {}
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
        return new Lockfile(lockfilePath, lockfile.WURPLSLockfileVersion, lockfile.DirectDependencies, lockfile.ResolvedDependencies);
    }
    public save(): void {
        try {
            const tmpPath = path.join(path.dirname(this.filepath), `.${path.basename(this.filepath)}-${randomShortUUID()}.tmp`);
            fs.writeFileSync(tmpPath, JSON.stringify({
                WURPLSLockfileVersion: this.WURPLSLockfileVersion,
                DirectDependencies: this.DirectDependencies,
                ResolvedDependencies: this.ResolvedDependencies,
            }, null, 2));
            fs.renameSync(tmpPath, this.filepath);
        }
        catch (err) {
            abort.thrown(`An unexpected fatal error occured while attempting to save the lockfile: ${this.filepath}; ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
