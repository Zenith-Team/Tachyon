import $ from 'chalk';
const consoleDebug = console.debug;
const consoleError = console.error;
const consoleWarn = console.warn;
const consoleInfo = console.info;
console.debug = (...data) => consoleDebug($.bold.gray('[DEBUG]'), ...data.map(d => typeof d === 'string' ? $.gray(d) : d));
console.error = (...data) => consoleError($.bold.redBright('[ERROR]'), ...data.map(d => typeof d === 'string' ? $.redBright(d) : d));
console.warn = (...data) => consoleWarn($.bold.yellowBright('[WARN]'), ...data.map(d => typeof d === 'string' ? $.yellowBright(d) : d));
console.info = (...data) => consoleInfo($.bold.blueBright('[INFO]'), ...data.map(d => typeof d === 'string' ? $.blueBright(d) : d));
console.success = (...data) => console.log(...data.map(d => typeof d === 'string' ? $.greenBright(d) : d));
