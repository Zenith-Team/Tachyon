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

## Documentation
Detailed documentation on using the project system:
[**Tachyon Docs**](DOCS.md)

Technical information on the file formats used by Tachyon:
[**Tachyon Spec**](SPEC.md)

### Environment Variables
Instead of passing the `--ghs` option to the `compile` command every time, Tachyon supports the `GHS_ROOT` environment variable to permanently store the path to GHS. (Optional)

### Compilation Caches
In combination with the compiler caching C++ files, Tachyon also caches Assembly files to avoid needlessly reassembling unmodified files between runs. This cache is currently stored at `<PROJECT_DIR>/objs/.asm.cache`, to clear/invalidate ONLY the Assembly cache, simply delete said file. To clear BOTH the C++ and the Assembly cache, run the `compile` command with `--no-cache`.
