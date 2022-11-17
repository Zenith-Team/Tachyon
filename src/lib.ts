declare global {
    namespace NodeJS {
        interface ProcessEnv {
            GHS_ROOT: string | undefined;
            TACHYON_LIB_MODE: string | undefined;
            TACHYON_LIB_RETURN: string | undefined;
            readonly TACHYON_DEBUG: string | undefined;
        }
    }
}

export default {
    async version() {
        process.env.TACHYON_LIB_MODE = '1';
        process.argv = ['node', 'tachyon', '-v'];
        await import('./cli.js');
        delete process.env.TACHYON_LIB_MODE;
        return process.env.TACHYON_LIB_RETURN;
    }
};
