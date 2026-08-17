# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import os
import shutil
import tempfile
import unittest
import zipfile

import mozunit

from mozpack.brightwork import BRIGHTWORK_ABI
from mozpack.brightwork.build import (
    build_from_recipe,
    package_omnijar,
    verify_omnijar,
)
from mozpack.brightwork.recipe import (
    BrightworkRecipe,
    _bundle_generated,
    _source_stageable_dests,
    is_resource_dest,
    platform_from_defines,
    rebase_source,
    stage_from_recipe,
)
from mozpack.brightwork.token import (
    BrightworkToken,
    inject_abi_into_jar,
    is_compatible,
    parse_abi_bytes,
    read_abi_from_jar,
)
from mozpack.manifests import InstallManifest
from mozpack.mozjar import JarReader, JarWriter


class TestBrightworkToken(unittest.TestCase):
    def test_abi_roundtrip(self):
        # brightwork.abi is a single line with the abi version
        t = BrightworkToken()
        self.assertEqual(t.to_abi_bytes(), b"%d\n" % BRIGHTWORK_ABI)
        self.assertEqual(parse_abi_bytes(t.to_abi_bytes()), {"abi": BRIGHTWORK_ABI})

    def test_json_roundtrip(self):
        t = BrightworkToken(name="Photon", version="1.2.0", author="me", icon="i.png")
        t2 = BrightworkToken.from_json_bytes(t.to_json_bytes())
        self.assertEqual(t2.name, "Photon")
        self.assertEqual(t2.version, "1.2.0")
        self.assertEqual(t2.author, "me")
        self.assertEqual(t2.icon, "i.png")
        self.assertEqual(t2.abi, BRIGHTWORK_ABI)
        import json

        self.assertNotIn("builtBy", json.loads(t.to_json_bytes()))

    def test_metadata_input_gets_current_abi(self):
        meta = b'{"name": "Theme", "version": "2.0", "brightworkAbi": 999}'
        t = BrightworkToken.from_metadata_bytes(meta)
        self.assertEqual(t.name, "Theme")
        self.assertEqual(t.version, "2.0")
        self.assertEqual(t.abi, BRIGHTWORK_ABI)
        import json

        self.assertEqual(
            json.loads(t.to_json_bytes())["brightworkAbi"], BRIGHTWORK_ABI
        )

    def test_compatibility_is_abi_only(self):
        self.assertTrue(is_compatible(1, 1))
        self.assertFalse(is_compatible(2, 1))

    def test_platforms_roundtrip_in_json_not_metadata(self):
        from dataclasses import replace

        t = replace(BrightworkToken(name="P"), platforms=["win", "linux"])
        import json

        data = json.loads(t.to_json_bytes())
        self.assertEqual(data["platforms"], ["win", "linux"])
        t2 = BrightworkToken.from_json_bytes(t.to_json_bytes())
        self.assertEqual(t2.platforms, ["win", "linux"])
        # platforms is set by the packager, never honoured from authored input
        authored = b'{"name": "P", "platforms": ["win"]}'
        self.assertEqual(BrightworkToken.from_metadata_bytes(authored).platforms, [])

    def test_abi_in_jar_json_beside_it(self):
        fd, tmp = tempfile.mkstemp(suffix=".ja")
        os.close(fd)
        try:
            jw = JarWriter(file=tmp, compress=True)
            jw.add("chrome/global/skin/foo.css", b"body{}")
            inject_abi_into_jar(jw, BrightworkToken(name="X"))
            jw.finish()
            jr = JarReader(tmp)
            self.assertIn("brightwork.abi", jr)
            self.assertNotIn("brightwork.json", jr)
            self.assertEqual(read_abi_from_jar(jr), BRIGHTWORK_ABI)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)


class TestBrightworkCompare(unittest.TestCase):
    def _jar(self, entries):
        fd, tmp = tempfile.mkstemp(suffix=".ja")
        os.close(fd)
        jw = JarWriter(file=tmp, compress=True)
        for name, data in entries.items():
            jw.add(name, data)
        jw.finish()
        return tmp

    def test_diff_detects_missing_extra_and_changed(self):
        from mozpack.brightwork.compare import diff_entries, omnijar_entries

        ref = self._jar(
            {
                "chrome/browser/skin/browser-aero.css": b"aero{}",
                "modules/Shared.sys.mjs": b"export const a = 1;",
                "modules/WindowsJumpLists.sys.mjs": b"win-only",
            }
        )
        cand = self._jar(
            {
                # browser-aero.css missing -> a real gap (titlebar/glitches)
                "modules/Shared.sys.mjs": b"export const a = 222;",  # changed
                "modules/LinuxOnly.sys.mjs": b"extra",  # extra
            }
        )
        try:
            d = diff_entries(omnijar_entries(ref), omnijar_entries(cand))
            self.assertIn("chrome/browser/skin/browser-aero.css", d["missing"])
            self.assertIn("modules/WindowsJumpLists.sys.mjs", d["missing"])
            self.assertIn("modules/LinuxOnly.sys.mjs", d["extra"])
            self.assertIn("modules/Shared.sys.mjs", d["changed"])
            self.assertEqual(d["ref_count"], 3)
            self.assertEqual(d["cand_count"], 2)
        finally:
            for p in (ref, cand):
                if os.path.exists(p):
                    os.remove(p)

    def test_identical_jars_have_no_diff(self):
        from mozpack.brightwork.compare import diff_entries, omnijar_entries

        ent = {"modules/A.sys.mjs": b"x", "chrome.manifest": b"content a a/"}
        a = self._jar(ent)
        b = self._jar(ent)
        try:
            d = diff_entries(omnijar_entries(a), omnijar_entries(b))
            self.assertEqual(d["missing"], [])
            self.assertEqual(d["extra"], [])
            self.assertEqual(d["changed"], [])
        finally:
            for p in (a, b):
                if os.path.exists(p):
                    os.remove(p)


class TestBrightworkAppend(unittest.TestCase):
    def setUp(self):
        self.dirs = []

    def tearDown(self):
        for d in self.dirs:
            shutil.rmtree(d, ignore_errors=True)

    def _tmp(self):
        d = tempfile.mkdtemp()
        self.dirs.append(d)
        return d

    def _write(self, root, rel, data):
        p = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(data)

    def test_delta_added_changed_removed(self):
        from mozpack.brightwork.append import build_append_package

        old = self._tmp()
        new = self._tmp()
        # unchanged, changed, removed, added
        self._write(old, "src/a.css", "A")
        self._write(new, "src/a.css", "A")  # same
        self._write(old, "src/b.js", "OLD")
        self._write(new, "src/b.js", "NEW")  # changed
        self._write(old, "src/gone.txt", "x")  # removed (not in new)
        self._write(new, "adk-win/new.txt", "fresh")  # added
        # build artifacts/caches must be ignored
        self._write(new, "dist/win/omni.ja", "huge")  # root dist -> skipped
        self._write(new, "src/__pycache__/x.pyc", "bytecode")  # skipped
        self._write(new, "metadata.json", '{"name":"X","version":"2.0"}')
        self._write(old, "metadata.json", '{"name":"X","version":"1.0"}')

        out = self._tmp()
        zp = os.path.join(self._tmp(), "delta.zip")
        s = build_append_package(old, new, out, zip_path=zp)

        self.assertEqual(s["added"], ["adk-win/new.txt"])
        self.assertEqual(s["changed"], ["metadata.json", "src/b.js"])
        self.assertEqual(s["removed"], ["src/gone.txt"])

        # changed/added copied; unchanged + removed + skipped NOT copied
        self.assertTrue(os.path.isfile(os.path.join(out, "src", "b.js")))
        self.assertTrue(os.path.isfile(os.path.join(out, "adk-win", "new.txt")))
        self.assertFalse(os.path.exists(os.path.join(out, "src", "a.css")))
        self.assertFalse(os.path.exists(os.path.join(out, "src", "gone.txt")))
        self.assertFalse(os.path.exists(os.path.join(out, "dist")))
        self.assertFalse(
            os.path.exists(os.path.join(out, "src", "__pycache__"))
        )
        # no manifest is written
        self.assertFalse(
            os.path.exists(os.path.join(out, "brightwork-append.json"))
        )

        # zip contains exactly the changed/added payload
        with zipfile.ZipFile(zp) as z:
            names = set(z.namelist())
        self.assertIn("src/b.js", names)
        self.assertIn("adk-win/new.txt", names)
        self.assertNotIn("src/a.css", names)
        self.assertNotIn("brightwork-append.json", names)

    def test_identical_trees_empty_delta(self):
        from mozpack.brightwork.append import build_append_package

        old = self._tmp()
        new = self._tmp()
        self._write(old, "src/a.css", "same")
        self._write(new, "src/a.css", "same")
        s = build_append_package(old, new, self._tmp())
        self.assertEqual((s["added"], s["changed"], s["removed"]), ([], [], []))

    def test_accepts_zip_inputs(self):
        from mozpack.brightwork.append import build_append_package

        old = self._tmp()
        new = self._tmp()
        self._write(old, "pkg/f.txt", "1")
        self._write(new, "pkg/f.txt", "2")
        # zip each with a single shared top dir; _resolve_tree descends into it
        oz = os.path.join(self._tmp(), "old.zip")
        nz = os.path.join(self._tmp(), "new.zip")
        for root, zp in ((old, oz), (new, nz)):
            with zipfile.ZipFile(zp, "w") as z:
                z.write(os.path.join(root, "pkg", "f.txt"), "sdk/pkg/f.txt")
        s = build_append_package(oz, nz, self._tmp())
        self.assertEqual(s["changed"], ["pkg/f.txt"])


class TestBrightworkRecipe(unittest.TestCase):
    def test_is_resource_dest(self):
        self.assertTrue(is_resource_dest("chrome/global/skin/foo.css"))
        self.assertTrue(is_resource_dest("browser/chrome/browser/foo.js"))
        self.assertTrue(is_resource_dest("modules/Bar.sys.mjs"))
        self.assertTrue(is_resource_dest("chrome.manifest"))
        self.assertTrue(is_resource_dest("browser/chrome.manifest"))
        self.assertTrue(is_resource_dest("greprefs.js"))
        self.assertFalse(is_resource_dest("firefox-bin"))
        self.assertFalse(is_resource_dest("libxul.so"))

    def test_rebase_source(self):
        self.assertEqual(
            rebase_source("/old/src/browser/a.css", "/old/src", "/new/tree"),
            "/new/tree/browser/a.css",
        )
        self.assertIsNone(rebase_source("/obj/gen.js", "/old/src", "/new/tree"))

    def test_recipe_json_roundtrip(self):
        r = BrightworkRecipe(
            topsrcdir="/old/src",
            manifests=["manifests/dist_bin"],
            defines={"MOZ_X": "1"},
            platform="win",
        )
        r2 = BrightworkRecipe.from_json(r.to_json())
        self.assertEqual(r2.topsrcdir, "/old/src")
        self.assertEqual(r2.defines, {"MOZ_X": "1"})
        self.assertEqual(r2.platform, "win")

    def test_platform_from_defines(self):
        self.assertEqual(platform_from_defines({"XP_WIN": "1"}), "win")
        self.assertEqual(platform_from_defines({"OS_TARGET": "WINNT"}), "win")
        self.assertEqual(
            platform_from_defines({"XP_UNIX": "1", "XP_LINUX": "1"}), "linux"
        )
        self.assertEqual(platform_from_defines({}), "linux")


class TestBrightworkBuild(unittest.TestCase):
    def setUp(self):
        self.dirs = []

    def tearDown(self):
        for d in self.dirs:
            shutil.rmtree(d, ignore_errors=True)

    def _tmp(self):
        d = tempfile.mkdtemp()
        self.dirs.append(d)
        return d

    def _staged_tree(self):
        staged = self._tmp()
        os.makedirs(os.path.join(staged, "chrome/global/skin"))
        os.makedirs(os.path.join(staged, "modules"))
        os.makedirs(os.path.join(staged, "res/cursors"))

        with open(os.path.join(staged, "chrome.manifest"), "w") as f:
            f.write("content global chrome/global/\n")
        with open(os.path.join(staged, "chrome/global/skin/foo.css"), "w") as f:
            f.write("body{color:magenta}")
        with open(os.path.join(staged, "modules/Bar.sys.mjs"), "w") as f:
            f.write("export const x = 1;")
        with open(os.path.join(staged, "res/cursors/wait.cur"), "wb") as f:
            f.write(b"\x00\x01")
        return staged

    def test_package_omnijar(self):
        staged = self._staged_tree()
        dest = self._tmp()
        tok = BrightworkToken(name="Photon")
        out = package_omnijar(staged, dest, tok)

        jr = JarReader(out)
        names = set(jr.entries.keys())
        self.assertIn("chrome/global/skin/foo.css", names)
        self.assertIn("modules/Bar.sys.mjs", names)
        self.assertIn("chrome.manifest", names)
        self.assertIn("brightwork.abi", names)
        self.assertNotIn("brightwork.json", names)
        self.assertFalse(os.path.exists(os.path.join(dest, "brightwork.json")))
        self.assertNotIn("res/cursors/wait.cur", names)
        self.assertTrue(os.path.exists(os.path.join(dest, "res/cursors/wait.cur")))

        self.assertEqual(
            verify_omnijar(out, expected_abi=BRIGHTWORK_ABI), BRIGHTWORK_ABI
        )

    def test_infer_added_files_from_siblings(self):
        # A new file dropped beside existing ones inherits their jar dest which means junk
        # and build files need to be skipped
        src = self._tmp()
        adk = self._tmp()
        dest = self._tmp()
        os.makedirs(os.path.join(src, "browser/themes/shared"))
        with open(os.path.join(src, "browser/themes/shared/existing.svg"), "w") as f:
            f.write("<svg/>")
        with open(os.path.join(src, "browser/themes/shared/new-icon.svg"), "w") as f:
            f.write("<svg/>")
        with open(os.path.join(src, "browser/themes/shared/.DS_Store"), "w") as f:
            f.write("junk")

        m = InstallManifest()
        m.add_copy(os.path.join(src, "rootchrome.manifest"), "chrome.manifest")
        m.add_copy(
            os.path.join(src, "browser/themes/shared/existing.svg"),
            "chrome/browser/skin/existing.svg",
        )
        with open(os.path.join(src, "rootchrome.manifest"), "w") as f:
            f.write("content global chrome/global/\n")
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)

        tok = BrightworkToken(name="Add")
        build_from_recipe(adk, src, dest, tok)
        jr = JarReader(os.path.join(dest, "omni.ja"))
        names = set(jr.entries.keys())
        # inherits existing.svg's dest dir
        self.assertIn("chrome/browser/skin/new-icon.svg", names)
        self.assertNotIn("chrome/browser/skin/.DS_Store", names)
        self.assertTrue(os.path.exists(os.path.join(dest, "brightwork.json")))

    def test_new_chrome_namespace(self):
        src = self._tmp()
        adk = self._tmp()
        dest = self._tmp()
        # an existing mapped tree
        os.makedirs(os.path.join(src, "browser/base/content"))
        with open(os.path.join(src, "browser/base/content/x.js"), "w") as f:
            f.write("//x")
        with open(os.path.join(src, "rootbrowser.manifest"), "w") as f:
            f.write("content browser chrome/browser/content/browser/\n")
        # a new namespace
        for sub, fn in [("content", "p.html"), ("skin", "s.css")]:
            os.makedirs(os.path.join(src, "mytheme", sub))
            with open(os.path.join(src, "mytheme", sub, fn), "w") as f:
                f.write("/* */")

        m = InstallManifest()
        m.add_copy(os.path.join(src, "rootbrowser.manifest"), "browser/chrome.manifest")
        m.add_copy(
            os.path.join(src, "browser/base/content/x.js"),
            "browser/chrome/browser/content/browser/x.js",
        )
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)

        build_from_recipe(adk, src, dest, BrightworkToken())
        jr = JarReader(os.path.join(dest, "browser", "omni.ja"))
        names = set(jr.entries.keys())
        self.assertIn("chrome/mytheme/content/p.html", names)
        self.assertIn("chrome/mytheme/skin/s.css", names)
        manifest = jr["chrome.manifest"].read().decode()
        self.assertIn("content mytheme chrome/mytheme/content/", manifest)
        self.assertIn("skin mytheme classic/1.0 chrome/mytheme/skin/", manifest)

    def test_build_from_recipe_skips_generated(self):
        src = self._tmp()
        adk = self._tmp()
        dest = self._tmp()
        os.makedirs(os.path.join(src, "browser/themes/shared"))
        os.makedirs(os.path.join(src, "toolkit/modules"))
        with open(os.path.join(src, "rootchrome.manifest"), "w") as f:
            f.write("content global chrome/global/\n")
        with open(os.path.join(src, "browser/themes/shared/foo.css"), "w") as f:
            f.write("toolbar{background:magenta}")
        with open(os.path.join(src, "toolkit/modules/Bar.sys.mjs"), "w") as f:
            f.write("export const x = 1;")

        m = InstallManifest()
        m.add_copy(os.path.join(src, "rootchrome.manifest"), "chrome.manifest")
        m.add_copy(
            os.path.join(src, "browser/themes/shared/foo.css"),
            "chrome/global/skin/foo.css",
        )
        m.add_copy(
            os.path.join(src, "toolkit/modules/Bar.sys.mjs"), "modules/Bar.sys.mjs"
        )
        # A build-generated source we cannot overwrite.
        m.add_copy("/objdir/gen/built.js", "chrome/global/built.js")
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)

        tok = BrightworkToken(name="Photon")
        out, skipped = build_from_recipe(adk, src, dest, tok)

        jr = JarReader(out)
        names = set(jr.entries.keys())
        self.assertIn("chrome/global/skin/foo.css", names)
        self.assertIn("modules/Bar.sys.mjs", names)
        self.assertIn("chrome.manifest", names)
        self.assertNotIn("chrome/global/built.js", names)
        self.assertEqual(
            skipped, [("chrome/global/built.js", "/objdir/gen/built.js")]
        )

    def test_preprocessed_with_generated_include_uses_bundled_output(self):
        src = self._tmp()
        adk = self._tmp()
        dest = self._tmp()
        os.makedirs(os.path.join(src, "toolkit/modules"))
        with open(os.path.join(src, "rootchrome.manifest"), "w") as f:
            f.write("content global chrome/global/\n")
        # The raw source references an objdir header that does NOT exist here.
        with open(
            os.path.join(src, "toolkit/modules/AppConstants.sys.mjs"), "w"
        ) as f:
            f.write("#include @TOPOBJDIR@/brightwork-abi.h\nexport const A = 1;\n")

        m = InstallManifest()
        m.add_copy(os.path.join(src, "rootchrome.manifest"), "chrome.manifest")
        m.add_preprocess(
            os.path.join(src, "toolkit/modules/AppConstants.sys.mjs"),
            "modules/AppConstants.sys.mjs",
            "deps",
            defines={"TOPOBJDIR": "/nonexistent/objdir"},
        )
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)

        # Simulate what export's _bundle_generated captures from dist/bin: the
        # fully-preprocessed output.
        gen = os.path.join(adk, "generated", "modules")
        os.makedirs(gen)
        with open(os.path.join(gen, "AppConstants.sys.mjs"), "w") as f:
            f.write("export const A = 1;\nexport const ABI = 1;\n")

        out, skipped = build_from_recipe(adk, src, dest, BrightworkToken())
        jr = JarReader(out)
        body = jr["modules/AppConstants.sys.mjs"].read().decode()
        # Came from the bundled processed output, not the raw #include source.
        self.assertIn("export const ABI = 1;", body)
        self.assertNotIn("#include", body)
        self.assertEqual(skipped, [])

    def test_bundle_generated_captures_preprocess_under_pattern_dir(self):
        src = self._tmp()
        adk = self._tmp()
        os.makedirs(os.path.join(src, "toolkit/modules"))
        os.makedirs(os.path.join(src, "toolkit/policies"))
        # a real module the pattern legitimately reproduces from src
        with open(os.path.join(src, "toolkit/modules/Real.sys.mjs"), "w") as f:
            f.write("export const r = 1;")
        # the preprocessed schema stub (output is assembled at build time)
        with open(os.path.join(src, "toolkit/policies/schema.sys.mjs"), "w") as f:
            f.write("#include @TOPOBJDIR@/gen.inc\n")

        m = InstallManifest()
        # pattern that covers modules/* (its dest_base is a prefix of the schema)
        m.add_pattern_copy(os.path.join(src, "toolkit/modules"), "**", "modules")
        # preprocessed file whose dest lands under modules/
        m.add_preprocess(
            os.path.join(src, "toolkit/policies/schema.sys.mjs"),
            "modules/policies/schema.sys.mjs",
            "deps",
            defines={"TOPOBJDIR": "/objdir"},
        )
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        recipe = BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"])
        recipe.save(adk)

        repro = _source_stageable_dests(adk, recipe)
        self.assertIn("modules/Real.sys.mjs", repro)  # pattern reproduces this
        self.assertNotIn("modules/policies/schema.sys.mjs", repro)  # it does not

        # Fake dist/bin holding the *built* outputs the export reads from.
        objdir = self._tmp()
        db = os.path.join(objdir, "dist", "bin")
        os.makedirs(os.path.join(db, "modules", "policies"))
        with open(os.path.join(db, "modules", "Real.sys.mjs"), "w") as f:
            f.write("export const r = 1;")
        with open(os.path.join(db, "modules", "policies", "schema.sys.mjs"), "w") as f:
            f.write("export const schema = {};// assembled output")

        class BC:
            topobjdir = objdir

        _bundle_generated(BC(), adk, recipe)
        gen = os.path.join(adk, "generated")
        self.assertTrue(
            os.path.isfile(os.path.join(gen, "modules", "policies", "schema.sys.mjs"))
        )
        self.assertFalse(os.path.isfile(os.path.join(gen, "modules", "Real.sys.mjs")))

    def test_editing_preprocessed_include_takes_effect(self):
        # Regression: a preprocessed file (browser.xhtml-style) is re-run from
        # src so edits to it AND to the sources it #includes
        # (navigator-toolbox.inc.xhtml-style) show up on rebuild, instead of
        # being frozen to the generated/ snapshot.
        src = self._tmp()
        adk = self._tmp()
        os.makedirs(os.path.join(src, "b/content"))
        with open(os.path.join(src, "rootchrome.manifest"), "w") as f:
            f.write("content global chrome/global/\n")
        with open(os.path.join(src, "b/content/main.xhtml"), "w") as f:
            f.write("#include part.inc.xhtml\n<root/>\n")
        inc = os.path.join(src, "b/content/part.inc.xhtml")
        with open(inc, "w") as f:
            f.write("<part>ORIGINAL</part>\n")

        m = InstallManifest()
        m.add_copy(os.path.join(src, "rootchrome.manifest"), "chrome.manifest")
        m.add_preprocess(
            os.path.join(src, "b/content/main.xhtml"),
            "chrome/browser/content/main.xhtml",
            "deps",
            marker="#",
        )
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)

        # A stale generated/ snapshot that must NOT win over the live src.
        gen = os.path.join(adk, "generated", "chrome", "browser", "content")
        os.makedirs(gen)
        with open(os.path.join(gen, "main.xhtml"), "w") as f:
            f.write("<part>STALE</part>\n<root/>\n")

        def build_and_read():
            dest = self._tmp()
            build_from_recipe(adk, src, dest, BrightworkToken())
            jr = JarReader(os.path.join(dest, "omni.ja"))
            return jr["chrome/browser/content/main.xhtml"].read().decode()

        body = build_and_read()
        self.assertIn("ORIGINAL", body)  # re-preprocessed from src
        self.assertNotIn("STALE", body)  # not the generated/ snapshot
        self.assertNotIn("#include", body)  # actually preprocessed

        # Edit the *included* source -> the change must appear on rebuild.
        with open(inc, "w") as f:
            f.write("<part>EDITED</part>\n")
        body2 = build_and_read()
        self.assertIn("EDITED", body2)
        self.assertNotIn("ORIGINAL", body2)

    def test_missing_canary_is_refused(self):
        src = self._tmp()
        adk = self._tmp()
        dest = self._tmp()
        os.makedirs(os.path.join(src, "toolkit/modules"))
        with open(os.path.join(src, "rootchrome.manifest"), "w") as f:
            f.write("content global chrome/global/\n")
        with open(
            os.path.join(src, "toolkit/modules/AppConstants.sys.mjs"), "w"
        ) as f:
            f.write("#include @TOPOBJDIR@/brightwork-abi.h\nexport const A = 1;\n")

        m = InstallManifest()
        m.add_copy(os.path.join(src, "rootchrome.manifest"), "chrome.manifest")
        m.add_preprocess(
            os.path.join(src, "toolkit/modules/AppConstants.sys.mjs"),
            "modules/AppConstants.sys.mjs",
            "deps",
            defines={"TOPOBJDIR": "/nonexistent/objdir"},
        )
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)

        with self.assertRaises(ValueError):
            build_from_recipe(adk, src, dest, BrightworkToken())

    def test_missing_local_include_is_refused(self):
        # A preprocessed file that #includes a concrete file missing from src
        # (a typo, or a name that doesn't match the file -- e.g. shipping
        # browser-appmenu.inc.xhtml while the directive says browser-appmenu.inc)
        # must FAIL the build, not silently ship the frozen generated/ copy.
        src = self._tmp()
        adk = self._tmp()
        dest = self._tmp()
        os.makedirs(os.path.join(src, "b/content"))
        with open(os.path.join(src, "rootchrome.manifest"), "w") as f:
            f.write("content global chrome/global/\n")
        with open(os.path.join(src, "b/content/main.xhtml"), "w") as f:
            f.write("<root>\n#include appmenu.inc\n</root>\n")
        # Ship a *similarly* named file, but not the one the directive asks for.
        with open(os.path.join(src, "b/content/appmenu.inc.xhtml"), "w") as f:
            f.write("<menu/>\n")

        m = InstallManifest()
        m.add_copy(os.path.join(src, "rootchrome.manifest"), "chrome.manifest")
        m.add_preprocess(
            os.path.join(src, "b/content/main.xhtml"),
            "chrome/browser/content/main.xhtml",
            "deps",
            marker="#",
        )
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)

        # A stale generated/ snapshot exists; it must NOT mask the error.
        gen = os.path.join(adk, "generated", "chrome", "browser", "content")
        os.makedirs(gen)
        with open(os.path.join(gen, "main.xhtml"), "w") as f:
            f.write("<root><frozen/></root>\n")

        with self.assertRaises(ValueError) as ctx:
            build_from_recipe(adk, src, dest, BrightworkToken())
        # The message must name the offending include so it's actually fixable.
        self.assertIn("appmenu.inc", str(ctx.exception))

    def test_multiplatform_fat_package_layout(self):
        # Mirror the build.py driver: build two platforms into <out>/<plat>/ with
        # write_metadata=False, then write one root brightwork.json listing the
        # platforms. Produces the fat layout the installer flattens per-OS.
        from dataclasses import replace

        from mozpack.brightwork.token import write_metadata_into_dir

        def make_adk(tag):
            src = self._tmp()
            adk = self._tmp()
            os.makedirs(os.path.join(src, "a"))
            with open(os.path.join(src, "a/foo.css"), "w") as f:
                f.write("toolbar{content:'%s'}" % tag)
            with open(os.path.join(src, "rootchrome.manifest"), "w") as f:
                f.write("content global chrome/global/\n")
            m = InstallManifest()
            m.add_copy(os.path.join(src, "rootchrome.manifest"), "chrome.manifest")
            m.add_copy(os.path.join(src, "a/foo.css"), "chrome/global/skin/foo.css")
            os.makedirs(os.path.join(adk, "manifests"))
            m.write(path=os.path.join(adk, "manifests", "dist_bin"))
            BrightworkRecipe(
                topsrcdir=src, manifests=["manifests/dist_bin"], platform=tag
            ).save(adk)
            return adk, src

        out = self._tmp()
        token = BrightworkToken(name="Cross Theme")
        built = []
        for tag in ("win", "linux"):
            adk, src = make_adk(tag)
            build_from_recipe(
                adk, src, os.path.join(out, tag), token, write_metadata=False
            )
            built.append(tag)
        write_metadata_into_dir(out, replace(token, platforms=built))

        # fat layout: per-platform jars + one root metadata, no root omni.ja
        self.assertTrue(os.path.isfile(os.path.join(out, "win", "omni.ja")))
        self.assertTrue(os.path.isfile(os.path.join(out, "linux", "omni.ja")))
        self.assertFalse(os.path.exists(os.path.join(out, "omni.ja")))

        import json

        meta = json.load(open(os.path.join(out, "brightwork.json")))
        self.assertEqual(meta["platforms"], ["win", "linux"])
        # each platform jar is a real, ABI-stamped omni.ja
        for tag in ("win", "linux"):
            self.assertEqual(
                verify_omnijar(os.path.join(out, tag, "omni.ja")), BRIGHTWORK_ABI
            )

    def test_icon_copied_beside_json_as_basename(self):
        # Testing that the icon gets copied next to the brightwork.json to resolve its name.
        src = self._tmp()
        adk = self._tmp()
        dest = self._tmp()
        metadir = self._tmp()
        os.makedirs(os.path.join(src, "a"))
        with open(os.path.join(src, "a/foo.css"), "w") as f:
            f.write("x{}")
        with open(os.path.join(src, "rootchrome.manifest"), "w") as f:
            f.write("content global chrome/global/\n")
        m = InstallManifest()
        m.add_copy(os.path.join(src, "rootchrome.manifest"), "chrome.manifest")
        m.add_copy(os.path.join(src, "a/foo.css"), "chrome/global/skin/foo.css")
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)
        # the icon lives in a subdir of the metadata dir, referenced relatively
        os.makedirs(os.path.join(metadir, "assets"))
        with open(os.path.join(metadir, "assets", "logo.png"), "wb") as f:
            f.write(b"\x89PNG")

        tok = BrightworkToken(name="Iconic", icon="assets/logo.png")
        build_from_recipe(adk, src, dest, tok, icon_source_dir=metadir)

        import json

        self.assertTrue(os.path.exists(os.path.join(dest, "logo.png")))
        meta = json.load(open(os.path.join(dest, "brightwork.json")))
        self.assertEqual(meta["icon"], "logo.png")

    def test_missing_icon_is_dropped(self):
        from mozpack.brightwork.token import write_metadata_into_dir

        dest = self._tmp()
        write_metadata_into_dir(
            dest, BrightworkToken(name="X", icon="nope.png"), icon_source_dir=dest
        )
        import json

        meta = json.load(open(os.path.join(dest, "brightwork.json")))
        self.assertEqual(meta["icon"], "")

    def test_stage_filters_non_resources(self):
        src = self._tmp()
        adk = self._tmp()
        staging = self._tmp()
        os.makedirs(os.path.join(src, "a"))
        with open(os.path.join(src, "a/foo.css"), "w") as f:
            f.write("x{}")
        m = InstallManifest()
        m.add_copy(os.path.join(src, "a/foo.css"), "chrome/foo.css")
        m.add_copy(os.path.join(src, "a/foo.css"), "firefox-bin-not-a-resource")
        os.makedirs(os.path.join(adk, "manifests"))
        m.write(path=os.path.join(adk, "manifests", "dist_bin"))
        BrightworkRecipe(topsrcdir=src, manifests=["manifests/dist_bin"]).save(adk)

        stage_from_recipe(adk, src, staging)
        staged = []
        for root, _, files in os.walk(staging):
            for f in files:
                staged.append(os.path.relpath(os.path.join(root, f), staging))
        self.assertIn("chrome/foo.css", staged)
        self.assertNotIn("firefox-bin-not-a-resource", staged)


class TestBrightworkExtract(unittest.TestCase):
    def setUp(self):
        self.dirs = []

    def tearDown(self):
        for d in self.dirs:
            shutil.rmtree(d, ignore_errors=True)

    def _tmp(self):
        d = tempfile.mkdtemp()
        self.dirs.append(d)
        return d

    def test_collect_includes_recursive(self):
        from mozpack.brightwork.extract import _collect_includes

        top = self._tmp()
        os.makedirs(os.path.join(top, "a/locales"))
        with open(os.path.join(top, "a/main.js"), "w") as f:
            f.write("#include locales/supported.json\n#include /a/abs.inc\n")
        with open(os.path.join(top, "a/locales/supported.json"), "w") as f:
            f.write('#include nested.txt\n{"x":1}')
        with open(os.path.join(top, "a/locales/nested.txt"), "w") as f:
            f.write("hi")
        with open(os.path.join(top, "a/abs.inc"), "w") as f:
            f.write("abs")

        acc = set()
        _collect_includes(os.path.join(top, "a/main.js"), top, acc)
        rel = {os.path.relpath(p, top) for p in acc}
        self.assertIn(os.path.join("a", "locales", "supported.json"), rel)
        self.assertIn(os.path.join("a", "locales", "nested.txt"), rel)  # recursive
        self.assertIn(os.path.join("a", "abs.inc"), rel)  # absolute (/ = top)


if __name__ == "__main__":
    mozunit.main()
