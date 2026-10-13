import $ from 'chalk';
import { abort } from '../utils.js';
import { cli_handler as compileCliHandler } from './compile/cli-handler.js';
import { cli_handler as launchCliHandler } from './launch/cli-handler.js';
export async function cli_handler(args: string[]): Promise<void> {
    if (args.length === 0)
        abort('No target specified! The first positional argument must be the target to warp.');
    if (args.length > 1)
        abort('warp accepts exactly one target and no options. Use "compile" or "launch" directly for command specific options.');
    const target = args[0]!;
    await compileCliHandler([target]);
    console.log($.greenBright.bold('[*] Compilation successful, launching...'));
    await launchCliHandler([target]);
}
