# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import json
import os
import re
import shutil
from dataclasses import asdict, dataclass, field

import mozpack.path as mozpath
from mozpack.copier import FileCopier, FileRegistry
from mozpack.manifests import InstallManifest

RECIPE_VERSION = 2
RECIPE_FILENAME = "recipe.json"
RESOURCE_TOPLEVEL = frozenset(
    [
        "modules", "moz-src", "actors", "dictionaries", "hyphenation",
        "localization", "default.locale", "contentaccessible",
    ]
)


def platform_from_defines(defines):
    defines = defines or {}
    if defines.get("XP_WIN") or str(defines.get("OS_TARGET", "")).upper() in ("WINNT", "WIN64"):
        return "win"
    return "linux"


@dataclass
class BrightworkRecipe:
    topsrcdir: str
    omnijar_name: str = "omni.ja"
    manifests: list = field(default_factory=list)
    non_resources: list = field(default_factory=list)
    defines: dict = field(default_factory=dict)
    platform: str = ""
    recipe_version: int = RECIPE_VERSION

    def to_json(self):
        return json.dumps(asdict(self), indent=2, sort_keys=True)

    @classmethod
    def from_json(cls, data):
        obj = json.loads(data)
        version = obj.get("recipe_version")
        if version != RECIPE_VERSION:
            raise ValueError("Unsupported brightwork recipe version %r (expected %d)" % (version, RECIPE_VERSION))
        return cls(**obj)

    @classmethod
    def load(cls, adk_dir):
        with open(os.path.join(adk_dir, RECIPE_FILENAME), encoding="utf-8") as fh:
            return cls.from_json(fh.read())

    def save(self, adk_dir):
        os.makedirs(adk_dir, exist_ok=True)
        with open(os.path.join(adk_dir, RECIPE_FILENAME), "w", encoding="utf-8") as fh:
            fh.write(self.to_json())


def is_resource_dest(dest):
    parts = mozpath.split(mozpath.normsep(dest))
    if parts and parts[0] == "browser":
        parts = parts[1:]
    if not parts:
        return False
    if parts[-1].endswith(".manifest") or parts[-1] == "greprefs.js":
        return True
    head = parts[0]
    if head == "chrome":
        return len(parts) == 1 or parts[1] != "icons"
    if head == "components":
        return parts[-1].endswith((".js", ".xpt"))
    if head == "res":
        return len(parts) == 1 or parts[1] not in ("cursors", "touchbar", "MainMenu.nib")
    if head == "defaults":
        return len(parts) != 3 or not (parts[2] == "channel-prefs.js" and parts[1] in ("pref", "preferences"))
    return head in RESOURCE_TOPLEVEL


def rebase_source(source, old_root, new_root):
    source = mozpath.normsep(os.path.normpath(source))
    old_root = mozpath.normsep(os.path.normpath(old_root))
    if source == old_root:
        return new_root
    prefix = old_root.rstrip("/") + "/"
    if not source.startswith(prefix):
        return None
    return mozpath.join(new_root, source[len(prefix):])


def export_recipe(buildconfig, output_dir, manifest_paths):
    os.makedirs(output_dir, exist_ok=True)
    manifests_dir = os.path.join(output_dir, "manifests")
    os.makedirs(manifests_dir, exist_ok=True)
    bundled = []
    for source in manifest_paths:
        name = os.path.basename(source)
        shutil.copy2(source, os.path.join(manifests_dir, name))
        bundled.append(mozpath.join("manifests", name))
    recipe = BrightworkRecipe(
        topsrcdir=mozpath.normsep(buildconfig.topsrcdir),
        omnijar_name=buildconfig.substs.get("OMNIJAR_NAME", "omni.ja"),
        manifests=bundled,
        defines=dict(buildconfig.defines),
        platform=platform_from_defines(buildconfig.defines),
    )
    recipe.save(output_dir)
    _bundle_generated(buildconfig, output_dir, recipe)
    return recipe


GENERATED_DIRNAME = "generated"


def _source_stageable_dests(adk_dir, recipe):
    from mozpack.files import FileFinder

    reproducible = set()
    for rel in recipe.manifests:
        manifest = InstallManifest(path=os.path.join(adk_dir, rel))
        for dest, entry in manifest._dests.items():
            install_type = entry[0]
            if install_type in (InstallManifest.LINK, InstallManifest.COPY):
                if rebase_source(entry[1], recipe.topsrcdir, "/__p__") is not None and os.path.isfile(entry[1]):
                    reproducible.add(mozpath.normsep(dest))
            elif install_type in (InstallManifest.PATTERN_LINK, InstallManifest.PATTERN_COPY):
                _, base, pattern, dest_base = entry
                if rebase_source(base, recipe.topsrcdir, "/__p__") is not None and os.path.isdir(base):
                    for found, _ in FileFinder(base).find(pattern):
                        reproducible.add(mozpath.normsep(mozpath.join(dest_base, found)))
            elif install_type == InstallManifest.CONTENT:
                reproducible.add(mozpath.normsep(dest))
    return reproducible


def _added_dir_map(adk_dir, recipe):
    from collections import defaultdict

    top = recipe.topsrcdir
    rel_dests = defaultdict(set)
    staged_rels = set()
    for relm in recipe.manifests:
        manifest = InstallManifest(path=os.path.join(adk_dir, relm))
        for dest, entry in manifest._dests.items():
            if entry[0] not in (InstallManifest.LINK, InstallManifest.COPY, InstallManifest.PREPROCESS):
                continue
            source = mozpath.normsep(entry[1])
            if not source.startswith(top + "/"):
                continue
            rel = source[len(top) + 1:]
            staged_rels.add(rel)
            rel_dests[mozpath.dirname(rel)].add(mozpath.dirname(mozpath.normsep(dest)))
    return {key: next(iter(value)) for key, value in rel_dests.items() if len(value) == 1}, staged_rels


_ADDED_DENY_NAMES = frozenset(["moz.build", "jar.mn", "jar.inc.mn", "thumbs.db", "desktop.ini"])
_ADDED_DENY_SUFFIXES = ("~", ".orig", ".rej", ".swp", ".bak", ".in")


def _is_ignorable_added(name):
    if name.startswith("."):
        return True
    lowered = name.lower()
    return lowered in _ADDED_DENY_NAMES or lowered.endswith(_ADDED_DENY_SUFFIXES)


def _nearest_mapped_dir(reldir, dir_map):
    parts = mozpath.split(reldir) if reldir else []
    for index in range(len(parts), -1, -1):
        ancestor = "/".join(parts[:index])
        if ancestor in dir_map:
            return dir_map[ancestor], "/".join(parts[index:])
    return None


def _infer_added_files(adk_dir, recipe, src_root, registry, resources_only):
    from mozpack.files import File

    dir_map, staged_rels = _added_dir_map(adk_dir, recipe)
    added = 0
    for root, _dirs, files in os.walk(src_root):
        reldir = mozpath.relpath(mozpath.normsep(root), src_root)
        if reldir == ".":
            reldir = ""
        mapped = _nearest_mapped_dir(reldir, dir_map)
        if not mapped:
            continue
        dest_dir, subpath = mapped
        for name in files:
            if _is_ignorable_added(name):
                continue
            rel = mozpath.join(reldir, name) if reldir else name
            if rel in staged_rels:
                continue
            dest = mozpath.join(dest_dir, subpath, name) if subpath else mozpath.join(dest_dir, name)
            if resources_only and not is_resource_dest(dest):
                continue
            if registry.contains(dest):
                continue
            registry.add(dest, File(os.path.join(root, name)))
            added += 1
    return added


_NS_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def apply_namespaces(adk_dir, src_root, staging):
    recipe = BrightworkRecipe.load(adk_dir)
    _, staged_rels = _added_dir_map(adk_dir, recipe)
    known_top = {rel.split("/", 1)[0] for rel in staged_rels}
    src_root = os.path.abspath(src_root)
    if not os.path.isdir(src_root):
        return []
    browser_root = os.path.join(staging, "browser")
    lines = []
    registered = []
    for child in sorted(os.listdir(src_root)):
        if child in known_top:
            continue
        package_dir = os.path.join(src_root, child)
        if not os.path.isdir(package_dir):
            continue
        providers = [provider for provider in ("content", "skin", "locale") if os.path.isdir(os.path.join(package_dir, provider))]
        if not providers:
            continue
        if not _NS_NAME_RE.match(child):
            print("brightwork: skipping namespace %r -- invalid chrome package name" % child)
            continue
        for provider in providers:
            source_provider = os.path.join(package_dir, provider)
            if provider == "locale":
                for locale in sorted(os.listdir(source_provider)):
                    locale_dir = os.path.join(source_provider, locale)
                    if not os.path.isdir(locale_dir):
                        continue
                    dest = os.path.join(browser_root, "chrome", child, "locale", locale)
                    os.makedirs(dest, exist_ok=True)
                    shutil.copytree(locale_dir, dest, dirs_exist_ok=True)
                    lines.append("locale %s %s chrome/%s/locale/%s/" % (child, locale, child, locale))
            else:
                dest = os.path.join(browser_root, "chrome", child, provider)
                os.makedirs(dest, exist_ok=True)
                shutil.copytree(source_provider, dest, dirs_exist_ok=True)
                if provider == "skin":
                    lines.append("skin %s classic/1.0 chrome/%s/skin/" % (child, child))
                else:
                    lines.append("content %s chrome/%s/content/" % (child, child))
        registered.append(child)
    if lines:
        manifest_path = os.path.join(browser_root, "chrome.manifest")
        with open(manifest_path, "a", encoding="utf-8") as fh:
            fh.write("\n# Brightwork custom namespaces\n")
            for line in lines:
                fh.write(line + "\n")
    return registered


def _bundle_generated(buildconfig, adk_dir, recipe):
    from mozpack.files import FileFinder

    distbin = os.path.join(buildconfig.topobjdir, "dist", "bin")
    generated_root = os.path.join(adk_dir, GENERATED_DIRNAME)
    reproducible = _source_stageable_dests(adk_dir, recipe)
    count = 0
    for dest, _ in FileFinder(distbin, ignore_broken_symlinks=True).find("**"):
        dest = mozpath.normsep(dest)
        if not is_resource_dest(dest) or dest in reproducible:
            continue
        source = os.path.join(distbin, *mozpath.split(dest))
        if not os.path.isfile(source):
            continue
        output = os.path.join(generated_root, *mozpath.split(dest))
        os.makedirs(os.path.dirname(output), exist_ok=True)
        shutil.copy2(source, output)
        count += 1
    return count


def _preprocess_or_none(path, marker, defines, silence):
    import io
    from mozbuild.preprocessor import Preprocessor

    try:
        preprocessor = Preprocessor(defines=defines, marker=marker)
        preprocessor.setSilenceDirectiveWarnings(silence)
        output = io.StringIO()
        with open(path, encoding="utf-8") as source:
            preprocessor.processFile(input=source, output=output)
        return output.getvalue().encode("utf-8"), None
    except Exception as error:
        return None, error


_UNRESOLVED_PP_VAR = re.compile(r"@[A-Za-z0-9_]+@")


def _missing_local_include(error):
    from mozbuild.preprocessor import Preprocessor

    if not isinstance(error, Preprocessor.Error) or getattr(error, "key", None) != "FILE_NOT_FOUND":
        return None
    inner = error.args[0] if getattr(error, "args", None) else None
    if not isinstance(inner, tuple) or len(inner) < 4 or not isinstance(inner[3], str):
        return None
    missing = inner[3]
    if _UNRESOLVED_PP_VAR.search(missing):
        return None
    return getattr(error, "line", inner[1]), missing


def stage_from_recipe(adk_dir, src_root, staging_dir, resources_only=True):
    from mozpack.files import File, FileFinder

    recipe = BrightworkRecipe.load(adk_dir)
    src_root = mozpath.normsep(os.path.abspath(src_root))
    generated_root = os.path.join(adk_dir, GENERATED_DIRNAME)
    registry = FileRegistry()
    skipped = []
    errors = []
    for rel in recipe.manifests:
        manifest = InstallManifest(path=os.path.join(adk_dir, rel))
        _replay_manifest(manifest, recipe, src_root, generated_root, registry, skipped, errors, resources_only)
    if errors:
        detail = "\n".join("  %s (line %s): #include %s -- not found in the package src tree" % (dest, line, os.path.basename(target)) for dest, line, target in errors)
        raise ValueError("Refusing to build: %d preprocessed file(s) reference an #include that is missing from src. Add the file to src/ or fix the directive:\n%s" % (len(errors), detail))
    if os.path.isdir(generated_root):
        for dest, _ in FileFinder(generated_root).find("**"):
            dest = mozpath.normsep(dest)
            if not registry.contains(dest):
                registry.add(dest, File(os.path.join(generated_root, *mozpath.split(dest))))
    _infer_added_files(adk_dir, recipe, src_root, registry, resources_only)
    reg_paths = {dest for dest, _ in registry}
    skipped = [(dest, source) for dest, source in skipped if not (mozpath.normsep(dest) in reg_paths or any(path.startswith(mozpath.normsep(dest).rstrip("/") + "/") for path in reg_paths))]
    copier = FileCopier()
    for dest, file_obj in registry:
        copier.add(dest, file_obj)
    copier.copy(staging_dir)
    return registry, skipped


def _generated_fallback(generated_root, dest):
    candidate = os.path.join(generated_root, *mozpath.split(dest))
    return candidate if os.path.isfile(candidate) else None


def _replay_manifest(manifest, recipe, src_root, generated_root, registry, skipped, errors, resources_only):
    from mozpack.files import File, FileFinder, GeneratedFile

    for dest in sorted(manifest._dests):
        if resources_only and not is_resource_dest(dest):
            continue
        entry = manifest._dests[dest]
        install_type = entry[0]
        if install_type in (InstallManifest.LINK, InstallManifest.COPY):
            rebased = rebase_source(entry[1], recipe.topsrcdir, src_root)
            if rebased is None or not os.path.exists(rebased):
                generated = _generated_fallback(generated_root, dest)
                if generated:
                    registry.add(dest, File(generated))
                else:
                    skipped.append((dest, entry[1]))
                continue
            registry.add(dest, File(rebased))
        elif install_type == InstallManifest.CONTENT:
            content = manifest._decode_field_entry(entry[1]).encode("utf-8")
            registry.add(dest, GeneratedFile(content))
        elif install_type == InstallManifest.PREPROCESS:
            data = None
            pp_error = None
            rebased = rebase_source(entry[1], recipe.topsrcdir, src_root)
            if rebased is not None and os.path.isfile(rebased):
                defines = dict(recipe.defines)
                defines.update(manifest._decode_field_entry(entry[4]))
                data, pp_error = _preprocess_or_none(rebased, entry[3], defines, bool(int(entry[5])))
            if data is not None:
                registry.add(dest, GeneratedFile(data))
            else:
                generated = _generated_fallback(generated_root, dest)
                missing = _missing_local_include(pp_error)
                if missing is not None:
                    errors.append((dest, missing[0], missing[1]))
                if generated:
                    registry.add(dest, File(generated))
                else:
                    skipped.append((dest, entry[1]))
        elif install_type in (InstallManifest.PATTERN_LINK, InstallManifest.PATTERN_COPY):
            _, base, pattern, dest_base = entry
            rebased_base = rebase_source(base, recipe.topsrcdir, src_root)
            if rebased_base is None or not os.path.isdir(rebased_base):
                skipped.append((dest, base))
                continue
            for found, _ in FileFinder(rebased_base).find(pattern):
                fdest = mozpath.join(dest_base, found)
                if not resources_only or is_resource_dest(fdest):
                    registry.add(fdest, File(mozpath.join(rebased_base, found)))
        else:
            skipped.append((dest, entry[1]))
