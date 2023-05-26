export default {
    async version() {
        process.env.TACHYON_LIB_MODE = '1';
        process.argv = ['node', 'tachyon', '-v'];
        await import('./cli.js');
        delete process.env.TACHYON_LIB_MODE;
        return process.env.TACHYON_LIB_RETURN;
    },
    compile(..._) {
        const error = new Error('Cannot compile from library mode.');
        error.name = 'TachyonLibError';
        Error.captureStackTrace(error, this.compile);
        throw error;
    },
    async patch(baseRpxPath, patchFilePath, outputPath) {
        process.env.TACHYON_LIB_MODE = '1';
        process.argv = ['node', 'tachyon', 'patch', baseRpxPath, patchFilePath];
        if (outputPath)
            process.argv.push('-o', outputPath);
        await import('./patch.js');
        delete process.env.TACHYON_LIB_MODE;
        return process.env.TACHYON_LIB_RETURN;
    }
};
