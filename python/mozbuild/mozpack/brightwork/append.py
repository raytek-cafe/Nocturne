# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of this file was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import hashlib
import os
import shutil
import tempfile
import zipfile

_SKIP_DIR_NAMES = {"__pycache__", ".git"}
_SKIP_SUFFIXES = (".pyc",)
_SKIP_ROOT_DIRS = {"dist"}


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _hash_tree(root):
    result = {}
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        if rel_dir == ".":
            rel_dir = ""
        dirnames[:] = [
            name for name in dirnames
            if name not in _SKIP_DIR_NAMES
            and not (not rel_dir and name in _SKIP_ROOT_DIRS)
        ]
        for filename in filenames:
            if filename.endswith(_SKIP_SUFFIXES):
                continue
            rel = f"{rel_dir}/{filename}" if rel_dir else filename
            result[rel] = _sha256(os.path.join(dirpath, filename))
    return result


def _resolve_tree(path):
    if os.path.isdir(path):
        return path, None
    if os.path.isfile(path) and zipfile.is_zipfile(path):
        tmp = tempfile.mkdtemp(prefix="bw-append-src-")
        with zipfile.ZipFile(path) as archive:
            archive.extractall(tmp)
        children = os.listdir(tmp)
        if len(children) == 1 and os.path.isdir(os.path.join(tmp, children[0])):
            return os.path.join(tmp, children[0]), lambda: shutil.rmtree(tmp, ignore_errors=True)
        return tmp, lambda: shutil.rmtree(tmp, ignore_errors=True)
    raise ValueError("%s is neither a directory nor a .zip" % path)


def _zip_dir(src_dir, zip_path):
    zip_path = os.path.abspath(zip_path)
    os.makedirs(os.path.dirname(zip_path) or ".", exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for dirpath, _dirs, files in os.walk(src_dir):
            for filename in sorted(files):
                full = os.path.join(dirpath, filename)
                arc = os.path.relpath(full, src_dir).replace(os.sep, "/")
                archive.write(full, arc)


def build_append_package(old_path, new_path, output_dir, zip_path=None):
    old_root, old_cleanup = _resolve_tree(old_path)
    new_root, new_cleanup = _resolve_tree(new_path)
    try:
        old_hashes = _hash_tree(old_root)
        new_hashes = _hash_tree(new_root)
        added = sorted(path for path in new_hashes if path not in old_hashes)
        changed = sorted(
            path for path in new_hashes
            if path in old_hashes and new_hashes[path] != old_hashes[path]
        )
        removed = sorted(path for path in old_hashes if path not in new_hashes)
        output_dir = os.path.abspath(output_dir)
        if os.path.isdir(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir)
        nbytes = 0
        for rel in added + changed:
            source = os.path.join(new_root, *rel.split("/"))
            dest = os.path.join(output_dir, *rel.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(source, dest)
            nbytes += os.path.getsize(source)
        if zip_path:
            _zip_dir(output_dir, zip_path)
        return {
            "added": added,
            "changed": changed,
            "removed": removed,
            "bytes": nbytes,
            "output_dir": output_dir,
            "zip": os.path.abspath(zip_path) if zip_path else None,
        }
    finally:
        if old_cleanup:
            old_cleanup()
        if new_cleanup:
            new_cleanup()
