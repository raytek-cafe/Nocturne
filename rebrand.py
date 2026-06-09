#!/usr/bin/env python3
import os
import re

# ordered replacements 
REPLACEMENTS = [
    ("Skyfox", "Skyfox"),
    ("Skyfox", "Skyfox"),
    ("skyfox", "skyfox"),
    ("skyfox", "skyfox"),
    ("SKYFOX", "SKYFOX"),
]

SKIP_FILES = {"README.md"}

# text file extensions to process contents of
TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".html", ".css", ".json", ".xml", ".yaml", ".yml",
    ".md", ".txt", ".sh", ".bat", ".ini", ".cfg", ".toml", ".c", ".cpp",
    ".h", ".cs", ".java", ".rs", ".go", ".rb", ".php", ".dtd", ".xul",
    ".properties", ".manifest", ".rc", ".def",
}

ROOT = "."  


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
        # Rename files
        for fname in filenames:
            new_fname = apply_replacements(fname)
            if new_fname != fname:
                old = os.path.join(dirpath, fname)
                new = os.path.join(dirpath, new_fname)
                os.rename(old, new)
                print(f"  [rename] {old} -> {new}")

        # Rename the directory itself
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
            ext = os.path.splitext(fname)[1].lower()
            if ext in TEXT_EXTENSIONS:
                process_file_contents(os.path.join(dirpath, fname))

    print("\n=== Step 2: Renaming files and folders ===")
    rename_paths(ROOT)

    print("\nDone.")


if __name__ == "__main__":
    main()