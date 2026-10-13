import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import JSON5 from 'json5';
import { abort, CommonDirs, CommonFiles, hex, isFolderAtSync, isSafeFilename, TitleID } from '../utils.js';
import { type ProjectConfigFile, ToolWURPLSVersion } from '../shared/projectconfig.js';
const BASE_PROJECT_CONFIG: ProjectConfigFile = {
    WURPLSVersion: ToolWURPLSVersion,
    Name: 'NewMod',
    Type: 'CoreMod',
    Version: '1.0.0',
    Description: 'A Telkin mod.',
    SourceDirs: [],
    IncludeDirs: [],
    BuildOptions: [],
    Targets: {},
};
export function cli_handler(args: string[]): void {
    const { positionals, values: { path: projectPath, titleid, } } = util.parseArgs({
        args,
        allowPositionals: true,
        options: {
            path: { type: 'string', short: 'p', default: process.cwd() },
            titleid: { type: 'string', short: 'T', default: TitleID.DUMMY_TEXT },
        }
    });
    const projectTemplate = positionals[0] ?? 'coremod';
    if (projectTemplate !== 'coremod')
        abort('Project templates not yet implemented.');
    if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath, { recursive: true });
    }
    else {
        if (!isFolderAtSync(projectPath))
            abort('Project location is not a folder.');
        const SYSTEM_FILES = ['.DS_Store', 'desktop.ini'];
        const NUM_FILES_IN_DIR = fs.readdirSync(projectPath).filter(f => !SYSTEM_FILES.includes(f)).length;
        if (NUM_FILES_IN_DIR !== 0)
            abort('Project location is not empty. Please run this command in an empty folder (or point it to one via --path).');
    }
    const parsedTID = TitleID.parse(titleid);
    if (!parsedTID)
        abort('Invalid value given to --titleid option, must be a valid Wii U title ID (FFFFFFFF-FFFFFFFF).');
    const formattedTID = TitleID.format(parsedTID);
    const USING_DUMMY_TID = TitleID.isDummyID(parsedTID);
    if (USING_DUMMY_TID) {
        console.warn(`Using the dummy title ID (${formattedTID}) as placeholder!\n` +
            'You must replace it with the real title ID of your target game/app everywhere it is used (project.json5, .convmap and syms.map).');
    }
    const folderName = path.basename(projectPath);
    if (isSafeFilename(folderName))
        BASE_PROJECT_CONFIG.Name = folderName;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (projectTemplate === 'coremod') {
        BASE_PROJECT_CONFIG.SourceDirs!.push('src');
        BASE_PROJECT_CONFIG.IncludeDirs!.push('include');
        BASE_PROJECT_CONFIG.Targets.US = { TitleID: formattedTID };
    }
    fs.mkdirSync(path.join(projectPath, 'content'));
    fs.mkdirSync(path.join(projectPath, 'include'));
    fs.mkdirSync(path.join(projectPath, 'src'));
    fs.writeFileSync(path.join(projectPath, 'src', 'Main.cpp'), `void main() {
    // Hello world!
}\n`);
    fs.writeFileSync(path.join(projectPath, '.clangd'), 'CompileFlags: {\n    Add: ["-std=c++23"]\n}\nDiagnostics: {\n    Suppress: [\n        static_assert_requirement_failed,\n        main_returns_nonint\n    ]\n}\nDocumentation: {\n    CommentFormat: Doxygen\n}\n');
    fs.mkdirSync(path.join(projectPath, CommonDirs.ConversionMaps));
    fs.writeFileSync(path.join(projectPath, CommonDirs.ConversionMaps, `${hex(parsedTID, 16, '')}.convmap`), '// Write your conversion mappings here!\n');
    fs.writeFileSync(path.join(projectPath, CommonFiles.MainSymbolMap), `@addresses_from "${formattedTID}"\n\n` +
        '// Write your game/app symbols here!\n');
    fs.writeFileSync(path.join(projectPath, CommonFiles.Config), JSON5.stringify(BASE_PROJECT_CONFIG, null, 4) + '\n');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (projectTemplate === 'coremod') {
        console.success('New single-region CoreMod project successfully generated!\n' +
            `If your target game/app has multiple regions you wish to support, remember to add them to your Targets in the ${CommonFiles.Config}!`);
    }
    else
        console.success(`New project successfully generated from template "${projectTemplate as string}"`);
}
