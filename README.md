# Tachyon
An experimental Wii U custom code project compiler.

## Requirements
* Green Hills Software MULTI for PowerPC (required only for the `compile` command)
* [Node.js](https://nodejs.org/) v18.6 or higher
* For installation: `npm` v9 or higher (Node.js 18 comes with `npm` v8, use `npm i -g npm@9` to upgrade)

## Installation
```sh
npm i -g Zenith-Team/Tachyon
```

## Usage
```sh
tachyon --help
```

### Environment Variables
Instead of passing the `--ghs` option to the `compile` command every time, Tachyon supports the `GHS_ROOT` environment variable to permanently store the path to GHS. (Optional)

### Generated Files
As of version `1.2.4-dev.5`, Tachyon caches Assembly files to avoid needlessly reassembling unmodified files between runs. This cache is currently stored at `<PROJECT_DIR>/objs/.asm.cache`, to clear/invalidate this cache, simply delete said file.