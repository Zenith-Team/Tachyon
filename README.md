# Tachyon
An experimental Wii U custom code project compiler.

## Requirements
* Green Hills Software MULTI (`compile` command only)

The following are only required if running from source:
* Windows
    * [Node.js](https://nodejs.org/) v18 or higher
* Linux
    * Latest version of [Bun](https://github.com/oven-sh/bun)

## Installation
`git clone` the repository, then run the install script (`tachyon-install.sh`) below next to the cloned folder.
```sh
#!/usr/bin/env bash
rm -rf "$BUN_INSTALL/install/global/node_modules/tachyon"
cp -rf "./Tachyon" "$BUN_INSTALL/install/global/node_modules/tachyon"
chmod +x "$BUN_INSTALL/install/global/node_modules/tachyon/tachyon.sh"
ln -sf "$BUN_INSTALL/install/global/node_modules/tachyon/tachyon.sh" "$BUN_INSTALL/bin/tachyon"
chmod +x "$BUN_INSTALL/bin/tachyon"
echo Tachyon installed.
```

## Usage
```sh
tachyon --help
```

### Environment Variables
Instead of passing the `--ghs` option to the `compile` command every time, Tachyon supports the `GHS_ROOT` environment variable to permanently store the path to GHS. (Optional)
