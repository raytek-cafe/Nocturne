#!/usr/bin/env python3
import os

REPLACEMENTS = [
    ("Nocturne", "Skyfox"),
    ("Eclipse r3dfox", "Skyfox"),
    ("nocturne", "skyfox"),
    ("r3dfox", "skyfox"),
    ("NOCTURNE", "SKYFOX"),
]

SKIP_FILES = {"README.md", "rebrand.py"}

ROOT = "."

def is_binary(path):
    try:
        with open(path, "rb") as f:
            chunk = f.read(8192)
        return b"\x00" in chunk
    except Exception:
        return True

def apply_replacements(s):
    for old, new in REPLACEMENTS:
        s = s.replace(old, new)
    return s

def process_file_contents(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            original = f.read()
    except Exception as e:
        print(f"  [skip] Cannot read {path}: {e}")
        return
    updated = apply_replacements(original)
    if updated != original:
        with open(path, "w", encoding="utf-8", errors="replace") as f:
            f.write(updated)
        print(f"  [content] {path}")

def rename_paths(root):
    """Walk bottom-up so children are renamed before parents."""
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        for fname in filenames:
            new_fname = apply_replacements(fname)
            if new_fname != fname:
                old = os.path.join(dirpath, fname)
                new = os.path.join(dirpath, new_fname)
                os.rename(old, new)
                print(f"  [rename] {old} -> {new}")
        new_dir = apply_replacements(os.path.basename(dirpath))
        if new_dir != os.path.basename(dirpath):
            parent = os.path.dirname(dirpath)
            old_dir = dirpath
            new_dirpath = os.path.join(parent, new_dir)
            os.rename(old_dir, new_dirpath)
            print(f"  [rename] {old_dir} -> {new_dirpath}")

def main():
    print("=== Skyfox Branding Machine ===")
    print("\n=== Step 1: Replacing contents in text files ===")
    for dirpath, _, filenames in os.walk(ROOT):
        for fname in filenames:
            if fname in SKIP_FILES:
                continue
            path = os.path.join(dirpath, fname)
            if is_binary(path):
                continue
            process_file_contents(path)
    print("\n=== Step 2: Renaming files and folders ===")
    rename_paths(ROOT)
    print("\nDone.")

if __name__ == "__main__":
    main()