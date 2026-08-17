# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import os

import mozpack.path as mozpath
from mozpack.copier import FileCopier
from mozpack.files import FileFinder
from mozpack.packager import Component, SimpleManifestSink
from mozpack.packager.formats import OmniJarFormatter

from mozpack.brightwork import token as bwtoken

RES_PATTERNS = (
    "chrome.manifest", "chrome/**", "components/**", "modules/**", "moz-src/**",
    "actors/**", "defaults/**", "res/**", "localization/**", "default.locale/**",
    "contentaccessible/**", "dictionaries/**", "hyphenation/**", "greprefs.js",
)


def package_omnijar(staged_dir, dest_dir, token, omnijar_name="omni.ja",
                    compress=True, non_resources=(), jarlog=None,
                    patterns=RES_PATTERNS):
    staged_dir = os.path.abspath(staged_dir)
    dest_dir = os.path.abspath(dest_dir)
    bwtoken.write_abi_into_dir(staged_dir, token)

    finder = FileFinder(staged_dir, ignore_broken_symlinks=True)
    copier = FileCopier()
    formatter = OmniJarFormatter(
        copier, omnijar_name, compress=compress, non_resources=list(non_resources)
    )
    sink = SimpleManifestSink(finder, formatter)
    seen = set()
    for pattern in (*patterns, bwtoken.ABI_FILENAME):
        for path, _ in finder.find(pattern):
            if path in seen:
                continue
            seen.add(path)
            sink.add(Component(""), path)
    if not seen:
        raise ValueError("No resources found under %s" % staged_dir)
    sink.close(auto_root_manifest=True)
    _apply_preload(copier, jarlog)
    copier.copy(dest_dir)
    return mozpath.join(dest_dir, omnijar_name)


def build_from_recipe(adk_dir, src_root, dest_dir, token, omnijar_name=None,
                      compress=True, jarlog=None, icon_source_dir=None,
                      write_metadata=True):
    import shutil
    import tempfile

    from mozpack.brightwork.recipe import BrightworkRecipe, apply_namespaces, stage_from_recipe

    recipe = BrightworkRecipe.load(adk_dir)
    name = omnijar_name or recipe.omnijar_name
    staging = tempfile.mkdtemp(prefix="brightwork-stage-")
    try:
        _, skipped = stage_from_recipe(adk_dir, src_root, staging)
        canary = mozpath.normsep(os.path.join("modules", "AppConstants.sys.mjs"))
        if any(mozpath.normsep(dest) == canary for dest, _ in skipped):
            raise ValueError(
                "Refusing to build: the startup canary modules/AppConstants.sys.mjs "
                "could not be staged. Re-run `mach brightwork-extract` on the build machine."
            )
        namespaces = apply_namespaces(adk_dir, src_root, staging)
        if namespaces:
            print("brightwork: registered namespaces: " + ", ".join(namespaces))
        gre = package_omnijar(
            staging, dest_dir, token, omnijar_name=name, compress=compress,
            non_resources=recipe.non_resources, jarlog=jarlog,
        )
        browser_stage = os.path.join(staging, "browser")
        if os.path.isdir(browser_stage):
            package_omnijar(
                browser_stage, os.path.join(dest_dir, "browser"), token,
                omnijar_name=name, compress=compress,
                non_resources=recipe.non_resources, jarlog=jarlog,
            )
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    if write_metadata:
        bwtoken.write_metadata_into_dir(dest_dir, token, icon_source_dir=icon_source_dir)
    return gre, skipped


def _apply_preload(copier, jarlog):
    if not jarlog or not os.path.exists(jarlog):
        return
    from mozpack.copier import Jarrer
    from mozpack.mozjar import JarLog

    log = JarLog(jarlog)
    for path, file_obj in copier:
        if isinstance(file_obj, Jarrer) and path in log:
            file_obj.preload(log[path])


def verify_omnijar(path, expected_abi=None):
    from mozpack.mozjar import JarReader

    abi = bwtoken.read_abi_from_jar(JarReader(path))
    if abi is None:
        raise ValueError("%s carries no brightwork.abi" % path)
    if expected_abi is not None and abi != int(expected_abi):
        raise ValueError("%s declares ABI %s, expected %s" % (path, abi, expected_abi))
    return abi
