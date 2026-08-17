# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import json
from dataclasses import dataclass, field, replace

from mozpack.brightwork import BRIGHTWORK_ABI

ABI_FILENAME = "brightwork.abi"
JSON_FILENAME = "brightwork.json"
METADATA_FILENAME = "metadata.json"


@dataclass
class BrightworkToken:
    abi: int = BRIGHTWORK_ABI
    name: str = "Untitled brightwork addon"
    version: str = "0.0.0"
    author: str = ""
    description: str = ""
    homepage: str = ""
    icon: str = ""
    platforms: list = field(default_factory=list)
    extra: dict = field(default_factory=dict)

    def to_abi_bytes(self):
        return ("%d\n" % self.abi).encode("utf-8")

    def to_json_bytes(self):
        data = {
            "name": self.name,
            "version": self.version,
            "author": self.author,
            "description": self.description,
            "homepage": self.homepage,
            "icon": self.icon,
            "platforms": list(self.platforms),
            "brightworkAbi": self.abi,
        }
        data.update(self.extra)
        return (json.dumps(data, indent=2, sort_keys=False) + "\n").encode("utf-8")

    @classmethod
    def from_metadata_bytes(cls, data):
        obj = json.loads(data)
        known = {
            "name", "version", "author", "description", "homepage", "icon",
            "platforms", "brightworkAbi",
        }
        return cls(
            abi=BRIGHTWORK_ABI,
            name=obj.get("name", "") or "Untitled brightwork package",
            version=obj.get("version", "0.0.0"),
            author=obj.get("author", ""),
            description=obj.get("description", ""),
            homepage=obj.get("homepage", ""),
            icon=obj.get("icon", ""),
            extra={k: v for k, v in obj.items() if k not in known},
        )

    @classmethod
    def from_json_bytes(cls, data):
        obj = json.loads(data)
        known = {
            "name", "version", "author", "description", "homepage", "icon",
            "platforms", "brightworkAbi",
        }
        platforms = obj.get("platforms", [])
        if not isinstance(platforms, list):
            platforms = []
        return cls(
            abi=int(obj.get("brightworkAbi", BRIGHTWORK_ABI)),
            name=obj.get("name", "") or "Untitled brightwork package",
            version=obj.get("version", "0.0.0"),
            author=obj.get("author", ""),
            description=obj.get("description", ""),
            homepage=obj.get("homepage", ""),
            icon=obj.get("icon", ""),
            platforms=[str(p) for p in platforms],
            extra={k: v for k, v in obj.items() if k not in known},
        )


def default_metadata_bytes(name="My Brightwork Addon"):
    data = {
        "name": name,
        "version": "1.0.0",
        "author": "",
        "description": "",
        "homepage": "",
        "icon": "",
    }
    return (json.dumps(data, indent=2, sort_keys=False) + "\n").encode("utf-8")


def parse_abi_bytes(data):
    text = data.decode("utf-8", "replace") if isinstance(data, bytes) else data
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        raise ValueError("brightwork.abi is empty")
    return {"abi": int(lines[0])}


def is_compatible(token_abi, running_abi):
    return int(token_abi) == int(running_abi)


def write_abi_into_dir(staging_dir, token):
    import os

    os.makedirs(staging_dir, exist_ok=True)
    with open(os.path.join(staging_dir, ABI_FILENAME), "wb") as fh:
        fh.write(token.to_abi_bytes())


def write_metadata_into_dir(dest_dir, token, icon_source_dir=None):
    import os
    import shutil

    os.makedirs(dest_dir, exist_ok=True)
    out_token = token
    if token.icon:
        source = None
        if icon_source_dir:
            source = os.path.join(
                icon_source_dir, *token.icon.replace("\\", "/").split("/")
            )
        if source and os.path.isfile(source):
            base = os.path.basename(source)
            shutil.copy2(source, os.path.join(dest_dir, base))
            out_token = replace(token, icon=base)
        else:
            out_token = replace(token, icon="")

    with open(os.path.join(dest_dir, JSON_FILENAME), "wb") as fh:
        fh.write(out_token.to_json_bytes())


def read_abi_from_jar(jar_reader):
    if ABI_FILENAME in jar_reader:
        return parse_abi_bytes(jar_reader[ABI_FILENAME].read())["abi"]
    return None
