# Tachyon
An experimental Wii U custom code project compiler.

## Requirements
* Green Hills Software MULTI (required only for the `compile` command)

The following are only required if running from source:
* [Node.js](https://nodejs.org/) v18.6 or higher

## Installation
- `git clone https://github.com/Zenith-Team/Tachyon`
- `cd Tachyon` + `bun install` + `cd ..`
- Create and run the install script below (`tachyon-install.sh`) next to the cloned folder:
```sh
#!/usr/bin/env bash
rm -rf "$BUN_INSTALL/install/global/node_modules/tachyon"
cp -rf "./Tachyon" "$BUN_INSTALL/install/global/node_modules/tachyon"
chmod +x "$BUN_INSTALL/install/global/node_modules/tachyon/tachyon.sh"
ln -sf "$BUN_INSTALL/install/global/node_modules/tachyon/tachyon.sh" "$BUN_INSTALL/bin/tachyon"
chmod +x "$BUN_INSTALL/bin/tachyon"
echo Tachyon installed.
```
> **Note**
> If you get an error about `cp: cannot create directory` when running the install script, run `bun add -g bun-repl` and try again.
>
> If you get no output from the command for the above solution, you need to update WSL kernel: `wsl --update` + `wsl --shutdown`

## Usage
```sh
tachyon --help
```
> **Note**
> If you have issues with it not being able to find relative paths, just use absolute paths for now.

### Environment Variables
Instead of passing the `--ghs` option to the `compile` command every time, Tachyon supports the `GHS_ROOT` environment variable to permanently store the path to GHS. (Optional)
