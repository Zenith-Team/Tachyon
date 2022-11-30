# Tachyon
An experimental Wii U custom code project compiler.

## Requirements
* Green Hills Software MULTI for PowerPC (required only for the `compile` command)
* [Node.js](https://nodejs.org/) v18.11 or higher
* For installation:
  * `npm` v9 or higher (Node.js 18 comes with `npm` v8, use `npm i -g npm@9` to upgrade)
  * `git` v2.37 or higher

## Installation
```sh
npm i -g Zenith-Team/Tachyon
```
#### Alternatively...
If you run into permission errors with `npm` using the command above, you can install directly through `git`:
```sh
git clone https://github.com/Zenith-Team/Tachyon tachyon && cd tachyon && npm i -D && npm link && cd ..
```
> **Note**: You still need `npm` installed.

> **Warning**: Make sure you run the alternative command in a folder you don't mind leaving a new `tachyon` folder on, as this command behaves like a portable installation.

## Usage
```sh
tachyon --help
```

## Documentation
Detailed documentation on using the project system:
[**Tachyon Docs**](DOCS.md)

Technical information on the file formats used by Tachyon:
[**Tachyon Spec**](SPEC.md)
