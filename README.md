<a href="https://github.com/Zenith-Team/Tachyon" align="center">
    <img alt="tachyon5-banner" src="https://github.com/user-attachments/assets/5d221436-3b6f-4fbe-b77b-ec661913d578" />
</a>
<div align="center">
  <img alt="wiiu" height="56" src="https://github.com/user-attachments/assets/fc1f38b1-46a1-44ee-acfb-ac436d900dc6">
  <a href="https://go.nsmbu.net/discord">
    <img alt="discord" height="56" src="https://github.com/user-attachments/assets/495433d7-1ddc-47f1-8c8e-f4ef137754c2">
  </a>
  <a href="https://zenith.nsmbu.net/wiki/Tachyon">
    <img alt="docs" height="56" src="https://github.com/user-attachments/assets/dc583842-a4d3-4635-b036-33d5f9bfc4d5">
  </a>
</div>

## Overview
Tachyon is an all-in-one cross-platform toolkit for developing custom code & patches for Wii U titles. It primarily operates on projects built for the [Telkin](https://github.com/Zenith-Team/Telkin) loader, and abstracts dependency management & build tasks into an easy to use, modular, and fast development experience. The full lifecycle is handled by Tachyon from compiling to testing to deployment, making mod creation easier than ever!

## Features
* **Modern Toolchain**: Powered by [Red Hills](https://github.com/Zenith-Team/RedHills), [RedStandard](https://github.com/Zenith-Team/RedStandard), and [LLD](https://lld.llvm.org/), you are provided with state-of-the-art cross-platform C++ development tools.
  * Native compiler & linker binaries for Windows, macOS and Linux.
* **Fast Builds**: Cached objects and precompiled headers provide ultra-fast build times.
* **Dependency Management**: The built-in package manager allows depending on other modules and libraries seamlessly with one command.
* **Instant Testing**: Quickly test your project using [Cemu emulator](https://cemu.info/), with automated graphic pack generation, game launching and integrated configurable logs, all from within your IDE.
* **Deployment**: Package your module as a library for others to depend on, or bundle the entire workspace as a distributable mod for users to play on console or emulator.
* **IDE Integration**: Generates `compile_commands.json` from your project to get perfect intellisense in any IDE using [clangd](https://clangd.llvm.org/).
* **Native RPL Creation**: Natively outputs Wii U RPL files via integrated [rpxlib](https://github.com/jhmaster2000/rpxlib), no external dependencies needed.

## Requirements
* [Node.js](https://nodejs.org/) v24 or higher
* For installation:
  * `npm` v11 or higher (Included with Node.js)

## Installation
```sh
npm i -g --allow-remote=root https://github.com/Zenith-Team/Tachyon/releases/latest/download/tachyon.tgz
```

## Usage
Quick Start (Blank Project):
```sh
tachyon init
tachyon compile TARGET
tachyon launch TARGET
```

Or clone the [RedCore Example Mod](https://github.com/Zenith-Team/RedCore-Example-Mod) for NSMBU:
```sh
git clone https://github.com/Zenith-Team/RedCore-Example-Mod MyMod
cd MyMod
tachyon pm install
tachyon compile TARGET
tachyon launch TARGET
```

### Commands Table
| Command   | Description                                               |
|-----------|-----------------------------------------------------------|
| `init`    | Set up a new project using the init wizard                |
| `compile` | Compile the workspace code into an RPL                    |
| `package` | Build every target and package for distribution as a dep  |
| `bundle`  | Collect all artifacts and deps into a playable bundle     |
| `install` | Install dependencies or add new packages                  |
| `launch`  | Launch the workspace with Cemu for testing                |

Read more with `tachyon --help`.

## Limitations
* Tachyon does not and cannot produce **RPX** executable files, only **RPL** modules are currently supported.
  * This means Tachyon cannot be used for standalone Homebrew app development.

## Credits
- [jhmaster](https://github.com/jhmaster2000) - Build system, package manager, launcher, binary generation
- [Luminyx](https://github.com/Luminyx1) - Build system, package manager, binary generation

## License
Tachyon v5 is currently initially released as Source-Available only.

The reason for this is the codebase in its current public form has a lot of tech debt, from beginning as a simple single-file compiler script, as such a rewrite of the codebase is already underway, but could not be completed in time for the joint release with the rest of the toolchain Tachyon is a part of.

For that reason any contributions would be voided upon the completion of the rewrite, so please wait until then. The rewrite will be released under the MPL.
