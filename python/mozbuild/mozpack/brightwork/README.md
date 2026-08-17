(Brightwork was made for Marble https://github.com/Erizur/Marble by Erizur. All credits to him.)

# Brightwork

Brightwork lets you replace the two omni.ja archives included in the Marble files dynamically.
It is esentially an advanced way to do userChrome edits, as this goes to the point of
being able to replace some of the browsers' js files directly and change their exposed properties.

Some of its features are:

- **Rebuilding the jas** without having to clone the entire repo.
- Being able to **load a custom archive at runtime** in place of the bundled ja, with the included ones from the browser as a fallback.

The fallback basically works by checking the ABI of the current addon at runtime. If it has a mismatch on its versioning, the browser goes back to the included omni.ja files builtin to Marble.

**WARNING: Because of how deep this mode of customization can go, you should not download unsafe brightwork addons if you don't know where they came from, as they can access your browser data and hijack your information if you're not careful. You should be safe if you have access to their code or have knowledge of what you're doing.**

## AI code usage warning

Because of this being a general **proof of concept** and because of how **complex** this task can become (Firefox's codebase is unironically large and a little complicated to navigate), most of the backend code (more specifically, the mach scripts and xpcom) was **conceptualized and developed** by an LLM. The frontend code (brightwork page in the addons section, localization, preferences, javascript, this README, designs and icons) was entirely written and done by hand me (AM_Erizur). The LLM-written code was tested extensively and corrected in some (many) cases.

Either way, you are free to completely ignore this feature if you don't feel confortable with knowing this and resort to other customization methods. I plan on continuing this by myself in the future.

## Package containment

Every brightwork `omni.ja` carries a file at its root, this being `brightwork.abi`, which is a single line file that indicates the version of the ABI this package is meant to run on. Basically, just an extra verification that gets packaged when you compile the omni.ja to avoid running it on an unsupported version, and to provide basic knowledge that this is a brightwork addon.

On the other hand, in the root folder where both omni.jas are located, a `brightwork.json` is provided for basic metadata (name, version, author, …) for the addons section.

## Building a Brightwork package

Brightwork packages are always built **outside** the Marble repository. The repo
itself only produces the original (bundled) `omni.ja` via a normal `./mach build`,
and exports the tooling to build custom ones elsewhere — there is no in-tree
"package a brightwork addon" command.

`brightwork-extract` exports every tool needed to create a brightwork addon into one small, portable directory, including the files that will be built in the omni.jas, a metadata template and the Brightwork _ADK_ (Addon Development Kit, mostly consistent of python scripts a mini-mach standalone clone), so the UI can be rebuilt without cloning the entire Marble repository. Note that you will need at least **Python 3.12** (only because this is what I had installed when testing this) to run the tools.

```bash
./mach brightwork-extract --output ./brightwork-repo
cd brightwork-repo
python build.py # will build the package including all files you added to the source directories, and copy over the metadata.
```

The extracted repo contains:

```
brightwork-repo/
  src/          # editable chrome sources (all generated deps that go in the .jas)
  adk/          # recipe + manifests + generated cached resources (don't edit)
  tools/        # vendored mozpack + mozbuild subset + deps (don't edit)
  build.py      # single command tool
  metadata.json # Brightwork metadata
  README.md
```

`build.py` adds only `tools/` to `sys.path` (mach-related stuff), so the repo builds in complete
isolation from any Firefox/Marble checkouts, tests and unnecessary boilerplate from other junk.

`build_from_recipe()` replays the ADK's install manifests against your source tree, rebasing their paths, re-running the preprocessor with the captured
defines, and packaging the result. One disadvantage is that a handful of *build-generated* files (e.g. `built_in_addons.json`) are not regenerated from your edits: they aren't produced from any file under `src/`, as they're outputs of build steps (code generators, headers, automated scripts) that the standalone repo doesn't carry. Without a proper source of generation, these files are skipped from editing (though these cases are VERY minimal). `brightwork-extract` bundles the already-built copies under `adk/generated/` and the build uses them directly. Note that files that *are* processed from a source (preprocessed/formatted `.sys.mjs` scripts, locales, etc.) come from `src/` and will be actually processed with all the changes you made to them.

### Suggested layout for repositories

```
brightwork/
  src/                       # the chrome sources you mod (browser/, toolkit/, …)
  adk/                       # brightwork-extract output (recipe + manifests + generated/)
  build.py                   # thin wrapper around mozpack.brightwork.build
  metadata.json              # this mod's name/version/author
  dist/                      # built omni.ja + browser/omni.ja + brightwork.json
  .github/workflows/ci.yml   # rebuild + verify_omnijar() on every push
```

If you want to run an automated CI instance, you should call `mozpack.brightwork.build.verify_omnijar(path, expected_abi=…)`
to confirm each artifact is well-formed and has no ABI inconsistencies (only if you did a half-assed upgrade of the tools or missed an upgrade spot) before publishing.

You are free to use the brightwork-sdk template that I provide under [this repository](https://github.com/Erizur/brightwork-sdk).

## Installing a package (runtime)

You are able to run a brightwork addon in two different ways. You can pass an environment variable while using mach run in order to define the brightwork directory, in which it will locate the metadata to load the addon, or manage it using the Extensions/Addon manager.

**Environment variable:**
```bash
MOZ_BRIGHTWORK_DIR=/tmp/bw ./mach run
```

**Per-install (default):** A Brightwork section will show up in the Addon Manager which you can use to add the brightwork data. Click on the gear icon to add a brightwork file or valid directory and wait until it appears on the list. You can activate it by pressing the indicator, and a popup should appear asking you to restart to apply.

After restarting, you'll see on your console logs (if running through a terminal or debugging):
```
brightwork: using custom GRE omni.ja (path of the loaded ja, version)
brightwork: using custom APP omni.ja (path of the loaded ja, version)
```
If the addon did not match the current ABI, it will avoid using it and Marble will fallback to the default interface.
