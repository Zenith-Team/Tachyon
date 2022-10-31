# Tachyon
An experimental Wii U custom code project compiler.

## Requirements
* Green Hills Software MULTI for PowerPC (required only for the `compile` command)
* [Node.js](https://nodejs.org/) v18.6 or higher

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
