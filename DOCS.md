# Tachyon Documentation
This document does not include command-line usage! All information you need for command-line usage is available on `tachyon --help`.

## Index
- [Environment Variables](#environment-variables)
- [Project Folder Structure](#project-folder-structure)
    - [Default Folder Structure](#default-folder-structure)
- [Project Configuration](#project-configuration) (project.yaml)
- [Modules](#modules) (ModulesDir/*.yaml)
- [Patches & Hooks](#patches--hooks)
- [Symbol Maps](#symbol-maps) (syms/main.map, syms/*.x)
- [Address Offsets Maps](#address-offsets-maps) (conv/*.offs)
- [Linker Directives](#linker-directives) (linker/*.ld)
- [Compilation Caches](#compilation-caches)

### Environment Variables
**Note:** *All environment variables are optional and have less priority than their equivalent flags.*
- `GHS_ROOT`: Instead of passing the `--ghs` option to the `compile` command every time, Tachyon supports this environment variable to permanently store the path to GHS.
- `CEMU_ROOT`: Instead of passing the `--cemu` option to the `launch` command every time, Tachyon supports this environment variable to permanently store the path to Cemu.
- `TACHYON_DEFAULT_GAME_ROOT`: Instead of passing the `--game` option to the `launch` command every time, Tachyon supports this environment variable to permanently store the path to a default game folder.

### Project Folder Structure
All Tachyon-based projects must use the following minimal folder structure:
```cmake
{IncludeDir}/
    # your C++ header (.h) & Assembly (.S) files
{SourceDir}/ 
    # your C++ source (.cpp) & Assembly (.S) files
{ModulesDir}/
    # your Tachyon Modules YAML (.yaml) files
{RpxDir}/
    # your base vanilla RPX (.rpx) files
[MetadataDir]/
    conv/
        # your Tachyon Address Offsets (.offs) files
    syms/
        main.map # your primary symbol map file
    project.yaml # the main project configuration file
```
The folder all of the above are inside will be referred to as the **root**.

The folder names as `{Example}` are customizable through the field `Example` in `project.yaml`. They can be placed anywhere within the **root**, even nested inside other folders, except for each other, with the exception of the **MetadataDir**, which can be referred to with the `+` symbol on the paths.

The folder names as `[Example]` are customizable through certain command-line options when calling the `compile` command, they are as follows:
- **MetadataDir**: Customizable through the `--meta`/`-m` option.
    - NOTE: This folder can only be renamed, it cannot be moved outside of the **root** nor nested inside other folders.

The folder and file names not using either of the syntaxes above are hardcoded and cannot be customized.

#### Default Folder Structure
All of the above folder customization options are not required, and all customizable folders have default values as follows:
- **IncludeDir** = `include`
- **SourceDir** = `src`
- **ModulesDir** = `modules`
- **RpxDir** = `rpxs`
- **MetadataDir** = `project`

All relative to the **root** folder. The resulting default folder structure looks like this:
```cmake
include/
    # your C++ header (.h) & Assembly (.S) files
source/ 
    # your C++ source (.cpp) & Assembly (.S) files
modules/
    # your Tachyon Modules YAML (.yaml) files
rpxs/
    # your base vanilla RPX (.rpx) files
project/
    conv/
        # your Tachyon Address Offsets (.offs) files
    syms/
        main.map # your primary symbol map file
    project.yaml # the main project configuration file
```

### Project Configuration
Project configuration is done through the main configuration file, `[MetadataDir]/project.yaml`, containing the following structure:
```yaml
---
Name: # project name (REQUIRED)
ModulesDir: # path to modules folder (default: modules)
IncludeDir: # path to headers folder (default: include)
SourceDir: # path to sources folder (default: src)
RpxDir: # path to rpxs files folder (default: rpxs)
Modules:
  - # list of names of global modules to compile (REQUIRED)
  - # ...
Defines:
  - # list of global C++ defines to set on compilation (default: empty list)
  - # ...

Targets: # key/value pairs of indefinite target configurations
  TargetName: # a single target configuration (At least 1 required)
    Extends: # name of a template target to inherit settings from (default: none)
    AddrMap: # name of conv/*.offs file to use with this target (default: TargetName)
    BaseRpx: # name of {RpxDir}/*.rpx file to use with this target (default: TargetName)
    Modules:
      - # list of names of additional modules to compile with this target (default: empty list)
      - # ...
    Defines:
      - # list of additional C++ defines to set with this target (default: empty list)
      - # ...
    Remove/Modules:
      - # list of names of global modules to remove from compilation with this target (default: empty list)
      - # ...
    Remove/Defines:
      - # list of global C++ defines to remove from this target (default: empty list)
      - # ...
    

  Template/TemplateName: # a target configuration template, identified by the "Template/" prefix (optional)
    # other non-template targets can inherit the settings defined here with the Extends setting
    # templates cannot be nested, so the Extends setting is not allowed on them.
    # aside from Extends, all target settings are also valid here.
    #
    # AddrMap and BaseRpx will default to TemplateName instead of TargetName here
    # if AddrMap/BaseRpx are set on both template and an extending target, the extending target has priority.
    #
    # all the list settings are merged together if set on both template and extending target.
```
To create an "empty" target using all default settings, give it `~` as the value.

In the value for **ModulesDir**, **IncludeDir**, **SourceDir** and **RpxDir**, the special prefix `+/` can be used to reference the **MetadataDir** given its name can be changed per run (similar to `~/` to reference the home folder on Linux)

### Modules
Tachyon projects are structured in "modules", enabled/disabled by the `project.yaml`, which are defined by YAML files located inside `{ModulesDir}`, which in turn declare source files (`.cpp` / `.S`) to compile and assemble aswell as binary patches/hooks to apply directly to the base RPX file.

Each module file is structured as follows:
```yaml
---
Files:
  - # list of .cpp and .S files to compile/assemble when this module is enabled (REQUIRED, but can be empty list with [] as value)
  - # ...

Hooks:
  - # list of patches/hooks to apply when this module is enabled (REQUIRED, but can be empty list with [] as value)
  # example patch/hook structure
  - type: # the type of the patch/hook, see the Patches & Hooks section of the docs for details
    addr: # a stringified hex number with 0x prefix, indicating the where to apply the patch
    ????: # other hook-type specific fields exist, see the Patches & Hooks section of the docs for details
```

### Patches & Hooks
This section documents the different types of structures you can write on the `Hooks` list of a [module](#modules). The current valid types, and their extra fields besides the base `type` and `addr` common to all hook types, are as follows:
- `patch`
    - The most basic and versatile hook, simply inserts `data` at `addr`
    - **Additional field:** `data`
        - A value to be encoded according to `datatype` and inserted at the `addr`
    - **Optional field:** `datatype` (Default: `raw`)
        - A string representing a C++ data type to interpret the value of `data` as, the supported types are:
            - `raw`: A sequence of hex bytes, value of `data` should be a string.
            - `f32`/`f64`/`float`/`double`: A 32/64 bit floating point number, value of `data` should be a numeric literal.
            - `u16`/`u32`/`u64`/`ushort`/`uint`/`ulonglong`: A 16/32/64 bit unsigned integer, value of `data` should be a positive numeric literal.
            - `s16`/`s32`/`s64`/`short`/`int`/`longlong`: A 16/32/64 bit signed integer, value of `data` should be a numeric literal.
            - `char`: A single char patch is not supported and will result in misaligned data. This is also why `u8`/`s8` don't exist. Refer to array types below.
            - `string`: A null-terminated C string. Due to alignment, must be an odd length. Null terminator is automatically added. Value of `data` should be a string.
            - `#[]`: Where `#` is any of the types above, you may suffix a type with `[]` to make an array of it. Value of `data` will be an array of values of the respective type.
                - The difference between `char[]` and `string` is a `char[]` doesn't automatically null-terminate and uses **ASCII** encoding, while `string` uses **UTF8**.
                - To write a null character on a `char[]`, write down `null` as a literal.
                - Multidimensional arrays such as `int[][]` are not supported.
- `nop`
    - A shorthand for a `patch` hook with `60000000` (`nop`) as `data`
- `multinop`
    - A shorthand for multiple `nop` hooks in a sequence
    - **Additional field:** `count`
        - A decimal integer number, specifying how many `nop`'s to apply starting from `addr`
- `returnvalue`
    - This hook type is currently volatile and should be avoided.
- `return`
    - A shortcut for a `patch` hook with `4E800020` (`blr`) as `data`
- `branch`
    - Inserts the respective branch instruction `instr` at `addr` jumping to the address of the symbol `func`
    - **Additional field:** `instr`
        - The branch instruction to use: `b` or `bl`
    - **Additional field:** `func`
        - The symbol whose address the branch instruction should jump to
- `funcptr`
    - Inserts the address of the symbol `func` at `addr`
    - **Additional field:** `func`
        - The symbol whose address to write at `addr`

*All hook fields are required unless explicitly marked as optional.*

### Symbol Maps
The primary symbol map for a project is located at `[MetadataDir]/syms/main.map` and has a very basic syntax similar to any other symbol map file.

- Indentation and whitespace are free-form
- `#` is used for comments
    - Both full line and end-of-line comments are supported
    - There is no multi-line comment support
- Line-separated list of key value pairs in the format: `SYMBOL = ADDRESS;`
    - Where `SYMBOL` is the symbol's text
    - Where `ADDRESS` is the symbol's address as a hex or decimal number
        - Alternatively `ADDRESS` can also a previously defined `SYMBOL` which instructs the parser to re-use that `SYMBOL`'s address for the current one.
- Anything not fitting the above syntax rules is a syntax error

The primary symbol map is not the one actually given to the compiler, as it must be converted to different regions according to the build targets through the `conv/*.offs` files. The resulting converted symbol maps of a compilation are placed in `syms/` aswell next to the `main.map`, with `{Target}.x` as name. Those are temporary and can be safely deleted after compilation if desired.

### Address Offsets Maps
The `*.offs` files inside the `[MetadataDir]/conv` folder are used for converting the addresses of the primary symbol map (`syms/main.map`) to different regions and versions of the game/app being modified.

The addresses in `main.map` can be of any region/version of your choosing, but must be consistent throughout the `main.map`. For build targets of the same region/version as your `main.map` addresses, where no conversion is necessary, a matching `*.offs` file is still required, even if empty or with a comment such as `// main`. This empty file requirement may be dropped in the future.

The offset files support both `#` and `//` comments at both start and end of lines, but no multi-line comments.

Address conversion offsets are arranged in a line-separated list of the following indentation and whitespace agnostic format:
- `RANGE_START - RANGE_END: SIGN OFFSET`
    - Where `RANGE_START` is an unprefixed (no `0x`) hex number (inclusive)
    - Where `RANGE_END` is an unprefixed (no `0x`) hex number (exclusive)
    - Where `SIGN` is either `+` or `-`. Anything else is a syntax error
        - This is REQUIRED even for positive offsets!
    - Where `OFFSET` is a hex (`0x` prefix) or decimal (no prefix) number

Besides address conversion offsets, the `*.offs` files also store the offsets pointing to the *end address* of the **text**, **data** and **syms** section groups of the base RPX file. For targets targetting emulators (Cemu), these are not required and should be omitted to be autocalculated, but for targets targetting real Wii U hardware, they must be provided as they cannot be autocalculated due to real hardware shifting the addresses on load.
```cmake
TextAddr = ADDRESS
DataAddr = ADDRESS
SymsAddr = ADDRESS
```
Where `ADDRESS` is a hex (`0x` prefix) or decimal (no prefix) positive number. If these values are not provided for a console-targetting build it will cause build errors.

### Linker Directives
The `{Target}.ld` files inside the `[MetadataDir]/linker` folder are temporary files produced during a compilation run, they should never be edited and can be safely deleted after each run, including the folder itself. (They will both always be re-created every compilation run)

### Compilation Caches
In combination with the compiler caching C++ files, Tachyon also caches Assembly files to avoid needlessly reassembling unmodified files between runs. This cache is currently stored at `<PROJECT_DIR>/objs/.asm.cache`, to clear/invalidate ONLY the Assembly cache, simply delete said file. To clear BOTH the C++ and the Assembly cache, run the `compile` command with `--no-cache`.

### Console Compilation
Support for compilation to real Wii U hardware is not finished and currently unavailable. This will be handled soon at a later update.
