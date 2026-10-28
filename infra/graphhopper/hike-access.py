#!/usr/bin/env python3
"""Create a hike-only PBF in which an explicit access=no also sets foot=no.

GraphHopper normally lets foot=designated override access=no. This deliberately
stricter profile preserves all other tags and leaves the original extract intact.
Requires pyosmium 4.3.2; input and output must be different files.
"""
import argparse
import os
import osmium


def strict_access(obj):
    if obj.tags.get("access") != "no":
        return obj
    tags = dict(obj.tags)
    tags["foot"] = "no"
    return obj.replace(tags=tags)


class Copier(osmium.SimpleHandler):
    def __init__(self, writer):
        super().__init__()
        self.writer = writer
        self.changed = 0

    def copy(self, obj):
        if obj.tags.get("access") == "no":
            self.changed += 1
        self.writer.add(strict_access(obj))

    node = copy
    way = copy
    relation = copy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    if os.path.realpath(args.input) == os.path.realpath(args.output):
        parser.error("input and output must differ")
    with osmium.SimpleWriter(args.output, overwrite=False) as writer:
        copier = Copier(writer)
        copier.apply_file(args.input)
    print(f"Set foot=no on {copier.changed} objects with access=no")


if __name__ == "__main__":
    main()
