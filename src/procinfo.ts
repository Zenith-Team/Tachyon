import os from 'os';
import chp from 'child_process';

interface ProcessInfoWin32 {
    imagename: string,
    pid: number,
    sessionname: string,
    session: string,
    memusage: string,
    status: string,
    username: string,
    cputime: string,
    windowtitle: string,
    [key: string]: string | number,
}
type ProcessInfo = Partial<ProcessInfoWin32>;

export function getProcessInfo(pid: number): ProcessInfo | null {
    if (!Number.isSafeInteger(pid) || pid < 0) throw new TypeError(`pid must be a safe positive integer, received: ${pid}`);
    if (os.platform() === 'win32') {
        const tasklist = chp.execSync(`tasklist /V /FO:CSV /FI "PID EQ ${pid}"`).toString('utf8');
        const [k, v] = tasklist.split('\n').slice(0, 2).map(x => x.trim().split(','));
        if (!k || !v || !k.length || !v.length || k.length !== v.length) throw new Error(`Unrecognized tasklist output (ERR1): ${tasklist}`);
        if (k[0]!.startsWith('INFO:')) return null; // Process not found
        const info: ProcessInfo = {};
        k.forEach((x, i) => info[x.slice(1, -1).replaceAll(' ', '').replace('#', '').toLowerCase()] = v[i]!.slice(1, -1));
        const npid = Number(info.pid);
        if (npid !== pid) throw new Error(`Unrecognized tasklist output (ERR2): ${tasklist}`);
        info.pid = npid;
        return info;
    } else {
        throw new Error(`Unsupported platform: ${os.platform()}`);
    }
}
