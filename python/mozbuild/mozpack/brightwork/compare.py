# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of this file was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import os
import sys

import mozpack.path as mozpath
from mozpack.mozjar import JarReader


def omnijar_entries(path):
    return {
        name: entry["uncompressed_size"]
        for name, entry in JarReader(path).entries.items()
    }


def diff_entries(reference, candidate):
    reference_names = set(reference)
    candidate_names = set(candidate)
    return {
        "ref_count": len(reference),
        "cand_count": len(candidate),
        "ref_bytes": sum(reference.values()),
        "cand_bytes": sum(candidate.values()),
        "missing": sorted(reference_names - candidate_names),
        "extra": sorted(candidate_names - reference_names),
        "changed": sorted(
            name for name in reference_names & candidate_names
            if reference[name] != candidate[name]
        ),
    }


def _group_by_top(names):
    groups = {}
    for name in names:
        parts = mozpath.split(name)
        key = "/".join(parts[:2]) if len(parts) > 1 else parts[0]
        groups[key] = groups.get(key, 0) + 1
    return sorted(groups.items(), key=lambda item: (-item[1], item[0]))


def _resolve_pair(path):
    if os.path.isdir(path):
        gre = os.path.join(path, "omni.ja")
        app = os.path.join(path, "browser", "omni.ja")
        if not os.path.isfile(gre):
            raise SystemExit("no omni.ja under %s" % path)
        return gre, app if os.path.isfile(app) else None
    return path, None


def _print_diff(label, reference_path, candidate_path, sample):
    diff = diff_entries(omnijar_entries(reference_path), omnijar_entries(candidate_path))

    def mib(size):
        return size / (1024 * 1024)

    print("=== %s ===" % label)
    print("  reference: %s" % reference_path)
    print("  candidate: %s" % candidate_path)
    print(
        "  entries:   reference %d (%.1f MiB)  vs  candidate %d (%.1f MiB)"
        % (diff["ref_count"], mib(diff["ref_bytes"]), diff["cand_count"], mib(diff["cand_bytes"]))
    )
    print(
        "  missing from candidate: %d   extra in candidate: %d   size-changed: %d"
        % (len(diff["missing"]), len(diff["extra"]), len(diff["changed"]))
    )
    if diff["missing"]:
        print("  -- MISSING (in reference, absent from candidate), by area:")
        for key, count in _group_by_top(diff["missing"]):
            print("       %5d  %s/" % (count, key))
        if sample:
            print("     sample of missing files:")
            for name in diff["missing"][:sample]:
                print("       - %s" % name)
    if diff["extra"]:
        print("  -- EXTRA (in candidate, not in reference): %d" % len(diff["extra"]))
        if sample:
            for name in diff["extra"][:sample]:
                print("       + %s" % name)
    print()
    return len(diff["missing"])


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    sample = 20
    if "--full" in argv:
        argv.remove("--full")
        sample = 10**9
    if len(argv) != 2:
        print(__doc__)
        return 2

    ref_gre, ref_app = _resolve_pair(argv[0])
    cand_gre, cand_app = _resolve_pair(argv[1])
    total_missing = _print_diff("GRE omni.ja", ref_gre, cand_gre, sample)
    if ref_app and cand_app:
        total_missing += _print_diff("APP (browser) omni.ja", ref_app, cand_app, sample)
    elif ref_app or cand_app:
        print("note: one side has a browser/omni.ja and the other does not; compared GRE jars only.\n")
    if total_missing:
        print("RESULT: candidate is missing %d file(s) the reference ships." % total_missing)
        return 1
    print("RESULT: candidate contains every entry the reference does.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
