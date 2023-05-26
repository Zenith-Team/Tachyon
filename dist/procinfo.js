import os from 'os';
import chp from 'child_process';
export function getProcessInfo(pid) {
    if (!Number.isSafeInteger(pid) || pid < 0)
        throw new TypeError(`pid must be a safe positive integer, received: ${pid}`);
    if (os.platform() === 'win32') {
        const tasklist = chp.execSync(`tasklist /V /FO:CSV /FI "PID EQ ${pid}"`).toString('utf8');
        const [k, v] = tasklist.split('\n').slice(0, 2).map(row => {
            const rowItems = row.trim().split('","');
            rowItems[0] = rowItems[0].slice(1);
            rowItems[rowItems.length - 1] = rowItems.at(-1).slice(0, -1);
            return rowItems;
        });
        if (!k || !v || !k.length || !v.length || k.length !== v.length)
            throw new Error(`Unrecognized tasklist output (ERR1): ${tasklist}`);
        if (k[0].startsWith('INFO:'))
            return null; // Process not found
        const info = {};
        k.forEach((x, i) => info[x.replaceAll(' ', '').replace('#', '').toLowerCase()] = v[i]);
        const npid = Number(info.pid);
        if (npid !== pid)
            throw new Error(`Unrecognized tasklist output (ERR2): ${tasklist}`);
        info.pid = npid;
        return info;
    }
    else {
        throw new Error(`Unsupported platform: ${os.platform()}`);
    }
}
