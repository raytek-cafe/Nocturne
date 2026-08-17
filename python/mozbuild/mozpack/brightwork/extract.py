# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of this file was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import os
import re
import shutil

import mozpack.path as mozpath
from mozpack.manifests import InstallManifest

from mozpack.brightwork.recipe import export_recipe, rebase_source

_INCLUDE_RE = re.compile(r'^\s*[#%@]\s*include(?:subst)?\s+"?([^"\s]+)"?')
MBLIBS = ("__init__.py", "dirutils.py", "makeutil.py", "preprocessor.py", "util.py")
TPLIBS = ("jsmin", "packaging", "python-hglib")


def _present_platforms(output_dir):
    return sorted(
        name[len("adk-"):] for name in os.listdir(output_dir)
        if name.startswith("adk-") and os.path.isdir(os.path.join(output_dir, name))
    )


def extract_standalone(buildconfig, manifest_paths, output_dir):
    from mozpack.brightwork.recipe import platform_from_defines

    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)
    platform = platform_from_defines(buildconfig.defines)
    adk_dir = os.path.join(output_dir, "adk-" + platform)
    if os.path.isdir(adk_dir):
        shutil.rmtree(adk_dir)
    recipe = export_recipe(buildconfig, adk_dir, manifest_paths)
    source_files, source_bytes = _copy_source_closure(adk_dir, recipe, os.path.join(output_dir, "src"))
    _vendor_python(buildconfig.topsrcdir, os.path.join(output_dir, "tools"))
    _write_driver(output_dir)
    return {
        "platform": platform,
        "source_files": source_files,
        "source_bytes": source_bytes,
        "platforms": _present_platforms(output_dir),
    }


def _copy_source_closure(adk_dir, recipe, src_out):
    top = recipe.topsrcdir
    sources = set()
    for rel in recipe.manifests:
        manifest = InstallManifest(path=os.path.join(adk_dir, rel))
        for _dest, entry in manifest._dests.items():
            install_type = entry[0]
            if install_type in (InstallManifest.LINK, InstallManifest.COPY, InstallManifest.PREPROCESS):
                source = entry[1]
                if rebase_source(source, top, "/__p__") is not None and os.path.isfile(source):
                    sources.add(source)
                    if install_type == InstallManifest.PREPROCESS:
                        _collect_includes(source, top, sources)
            elif install_type in (InstallManifest.PATTERN_LINK, InstallManifest.PATTERN_COPY):
                _, base, pattern, _dest = entry
                if rebase_source(base, top, "/__p__") is None or not os.path.isdir(base):
                    continue
                from mozpack.files import FileFinder
                for found, _ in FileFinder(base).find(pattern):
                    sources.add(os.path.join(base, found))
    nbytes = 0
    sources = {source for source in sources if rebase_source(source, top, "/__p__") is not None}
    for source in sources:
        rel = mozpath.relpath(mozpath.normsep(source), mozpath.normsep(top))
        output = os.path.join(src_out, *mozpath.split(rel))
        os.makedirs(os.path.dirname(output), exist_ok=True)
        shutil.copy2(source, output)
        nbytes += os.path.getsize(source)
    return len(sources), nbytes


def _collect_includes(path, top, accumulator):
    try:
        with open(path, "r", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return
    base = os.path.dirname(path)
    for line in lines:
        match = _INCLUDE_RE.match(line)
        if not match:
            continue
        include = match.group(1)
        candidate = os.path.join(top, include.lstrip("/")) if include.startswith("/") else os.path.normpath(os.path.join(base, include))
        if os.path.isfile(candidate) and candidate not in accumulator:
            accumulator.add(candidate)
            _collect_includes(candidate, top, accumulator)


def _vendor_python(topsrcdir, tools_dir):
    if os.path.isdir(tools_dir):
        shutil.rmtree(tools_dir)
    os.makedirs(tools_dir, exist_ok=True)
    mozbuild_src = os.path.join(topsrcdir, "python", "mozbuild")
    shutil.copytree(
        os.path.join(mozbuild_src, "mozpack"),
        os.path.join(tools_dir, "mozpack"),
        ignore=shutil.ignore_patterns("test", "__pycache__", "*.pyc"),
    )
    destination = os.path.join(tools_dir, "mozbuild")
    os.makedirs(destination, exist_ok=True)
    for name in MBLIBS:
        shutil.copy2(os.path.join(mozbuild_src, "mozbuild", name), os.path.join(destination, name))
    third_party = os.path.join(topsrcdir, "third_party", "python")
    for name in TPLIBS:
        source = os.path.join(third_party, name)
        if os.path.isdir(source):
            shutil.copytree(source, os.path.join(tools_dir, os.path.basename(name)), ignore=shutil.ignore_patterns("test", "tests", "__pycache__", "*.pyc"))


_BUILD_PY = '''#!/usr/bin/env python3
import argparse
import os
import sys
from dataclasses import replace

HERE = os.path.abspath(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(HERE, "tools"))
for entry in sorted(os.listdir(os.path.join(HERE, "tools"))):
    path = os.path.join(HERE, "tools", entry)
    if os.path.isdir(path):
        sys.path.insert(0, path)

from mozpack.brightwork.build import build_from_recipe
from mozpack.brightwork.token import BrightworkToken, write_metadata_into_dir


def _available_platforms():
    return sorted(
        name[len("adk-"):] for name in os.listdir(HERE)
        if name.startswith("adk-") and os.path.isdir(os.path.join(HERE, name))
    )


def main():
    available = _available_platforms()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=os.path.join(HERE, "dist"))
    parser.add_argument("--metadata", default=os.path.join(HERE, "metadata.json"))
    parser.add_argument("--platform", action="append", choices=available or None)
    parser.add_argument("--fast", action="store_true")
    args = parser.parse_args()
    if not available:
        raise SystemExit("No adk-<platform> directories found next to build.py.")
    targets = args.platform or available
    with open(args.metadata, "rb") as fh:
        token = BrightworkToken.from_metadata_bytes(fh.read())
    built = []
    for platform in targets:
        gre, skipped = build_from_recipe(
            os.path.join(HERE, "adk-" + platform),
            os.path.join(HERE, "src"),
            os.path.join(args.out, platform),
            token,
            compress=not args.fast,
            write_metadata=False,
        )
        built.append(platform)
        print("Built", gre)
        browser_jar = os.path.join(args.out, platform, "browser", "omni.ja")
        if os.path.isfile(browser_jar):
            print("Built", browser_jar)
        if skipped:
            print(
                "%d resource(s) not in the source tree for %s"
                % (len(skipped), platform)
            )
            for dest, _ in skipped:
                print("   ", dest)
    write_metadata_into_dir(
        args.out,
        replace(token, platforms=built),
        icon_source_dir=os.path.dirname(os.path.abspath(args.metadata)),
    )
    print("Wrote", os.path.join(args.out, "brightwork.json"))
'''


def _write_driver(output_dir):
    from mozpack.brightwork.token import default_metadata_bytes

    with open(os.path.join(output_dir, "build.py"), "w", encoding="utf-8") as fh:
        fh.write(_BUILD_PY)
    os.chmod(os.path.join(output_dir, "build.py"), 0o755)
    metadata_path = os.path.join(output_dir, "metadata.json")
    if not os.path.exists(metadata_path):
        with open(metadata_path, "wb") as fh:
            fh.write(default_metadata_bytes())
    with open(os.path.join(output_dir, "README.md"), "w", encoding="utf-8") as fh:
        fh.write(
            "# Brightwork Addon Template\n\n"
            "Edit files under `src/`, then run `python build.py` to build the "
            "Brightwork package. Use `--platform win` or `--platform linux` "
            "to select a target and `--fast` for uncompressed development jars.\n"
        )
    with open(os.path.join(output_dir, ".gitignore"), "w", encoding="utf-8") as fh:
        fh.write("/dist/\n__pycache__/\n*.pyc\n")
