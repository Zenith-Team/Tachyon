declare global {
    namespace NodeJS {
        interface ProcessEnv {
            GHS_ROOT: string | undefined;
            CEMU_ROOT: string | undefined;
            TACHYON_LIB_MODE: string | undefined;
            TACHYON_LIB_RETURN: string | undefined;
            readonly TACHYON_DEBUG: string | undefined;
            readonly TACHYON_DEFAULT_GAME_ROOT: string | undefined;
        }
    }
}

export default {
    async version(): Promise<string> {
        process.env.TACHYON_LIB_MODE = '1';
        process.argv = ['node', 'tachyon', '-v'];
        await import('./cli.js');
        delete process.env.TACHYON_LIB_MODE;
        return process.env.TACHYON_LIB_RETURN!;
    },
    compile(..._: unknown[]): never {
        const error = new Error('Cannot compile from library mode.');
        error.name = 'TachyonLibError';
        Error.captureStackTrace(error, this.compile);
        throw error;
    },
    async patch(baseRpxPath: string, patchFilePath: string, outputPath?: string): Promise<string> {
        process.env.TACHYON_LIB_MODE = '1';
        process.argv = ['node', 'tachyon', 'patch', baseRpxPath, patchFilePath];
        if (outputPath) process.argv.push('-o', outputPath);
        await import('./patch.js');
        delete process.env.TACHYON_LIB_MODE;
        return process.env.TACHYON_LIB_RETURN!;
    }
};
