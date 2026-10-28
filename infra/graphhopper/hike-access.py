#!/usr/bin/env python3
"""Build a hike-only derivative: foot-specific access, foot barriers, nested hiking routes.

Requires pyosmium 4.3.2. Never changes the source extract. Blocked barrier nodes
are copied 0.5 m down every incident segment, avoiding GH11's junction exception.
Unrestricted gates/stiles are passable, as in GH's FootAccessParser. A locked
barrier needs an explicit foot allowance. Relation access restrictions propagate to descendants without explicit foot permission.
"""
import argparse
from collections import Counter
import json
import math
import os
import subprocess
import osmium

RESTRICTED = {"no", "private", "restricted", "military", "emergency", "permit"}
ALLOWED = {"yes", "designated", "official", "permissive", "destination"}


def strict_access(obj):
    if obj.tags.get("access") not in RESTRICTED or obj.tags.get("foot") in ALLOWED:
        return obj
    tags = dict(obj.tags)
    tags["foot"] = "no"
    return obj.replace(tags=tags)


def blocked(tags):
    if tags.get("foot") in RESTRICTED:
        return True
    if tags.get("foot") in ALLOWED:
        return False
    if tags.get("access") in RESTRICTED:
        return True
    return tags.get("locked") == "yes" or tags.get("barrier") in {"fence", "wall"}


def expand(ref, relations, stack=frozenset()):
    if ref in stack or ref not in relations:
        return []
    result = []
    for kind, member, role in relations[ref][1]:
        if kind == "w":
            result.append((member, role))
        elif kind == "r":
            children = expand(member, relations, stack | {ref})
            result.extend(reversed(children) if role == "backward" else children)
    return result


class Inventory(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.barriers = {}
        self.relations = {}
        self.max_node = 0

    def node(self, node):
        self.max_node = max(self.max_node, node.id)
        tags = dict(node.tags)
        if "barrier" in tags or "ford" in tags or blocked(tags):
            self.barriers[node.id] = (node.location.lon, node.location.lat, tags)

    def relation(self, relation):
        self.relations[relation.id] = (dict(relation.tags), [(m.type, m.ref, m.role) for m in relation.members])


class Plan(osmium.SimpleHandler):
    def __init__(self, inventory):
        super().__init__()
        self.inventory = inventory
        self.next_id = inventory.max_node + 1
        self.insertions = {}
        self.nodes = []
        self.incidence = Counter()

    def way(self, way):
        inserts = {}
        refs = list(way.nodes)
        for i, ref in enumerate(refs):
            barrier = self.inventory.barriers.get(ref.ref)
            if barrier is None:
                continue
            self.incidence[ref.ref] += 1
            lon, lat, tags = barrier
            if not blocked(tags):
                continue
            for j in (i - 1, i + 1):
                if j < 0 or j >= len(refs):
                    continue
                neighbor = refs[j]
                if not neighbor.location.valid():
                    raise ValueError(f"missing node {neighbor.ref} at restricted barrier {ref.ref}")
                dx = (neighbor.lon - lon) * math.cos(math.radians(lat)) * 111320
                dy = (neighbor.lat - lat) * 111320
                length = math.hypot(dx, dy)
                if length < 0.01:
                    # Same-coordinate nodes still get a separate blocker.
                    fraction = 0.5
                else:
                    fraction = min(0.5 / length, 0.25)
                position = (lon + (neighbor.lon - lon) * fraction, lat + (neighbor.lat - lat) * fraction)
                node_id = self.next_id
                self.next_id += 1
                self.nodes.append(osmium.osm.mutable.Node(id=node_id, location=position,
                                  tags={**tags, "barrier": "fence", "foot": "no"}))
                # before/after index lets both ends of a segment carry blockers.
                inserts[(i, j > i)] = node_id
        if inserts:
            nodes = []
            for i, ref in enumerate(refs):
                if (i, False) in inserts:
                    nodes.append(inserts[(i, False)])
                nodes.append(ref.ref)
                if (i, True) in inserts:
                    nodes.append(inserts[(i, True)])
            self.insertions[way.id] = nodes


class Copier(osmium.SimpleHandler):
    def __init__(self, writer, inventory, plan):
        super().__init__()
        self.writer, self.inventory, self.plan = writer, inventory, plan
        self.counts = Counter()
        self.wrote_nodes = False
        self.restricted_ways = set()
        for ref, (tags, _) in inventory.relations.items():
            if blocked(tags):
                self.restricted_ways.update(w for w, _ in expand(ref, inventory.relations))

    def node(self, node):
        tags = dict(strict_access(node).tags)
        if node.id in self.inventory.barriers:
            for key in ("barrier", "ford"):
                if key in tags:
                    tags[f"ogv:original_{key}"] = tags.pop(key)
            self.counts["blocked_barrier_nodes" if blocked(self.inventory.barriers[node.id][2]) else "foot_passable_barrier_nodes"] += 1
        self.writer.add_node(node.replace(tags=tags))

    def way(self, way):
        if not self.wrote_nodes:
            for node in self.plan.nodes:
                self.writer.add_node(node)
            self.wrote_nodes = True
        tags = dict(strict_access(way).tags)
        if way.id in self.restricted_ways and tags.get("foot") not in ALLOWED:
            tags["foot"] = "no"
            self.counts["relation_restricted_ways"] += 1
        if tags != dict(way.tags):
            self.counts["strict_access_ways"] += 1
        self.writer.add_way(way.replace(tags=tags, nodes=self.plan.insertions.get(way.id, [n.ref for n in way.nodes])))

    def relation(self, relation):
        tags = dict(strict_access(relation).tags)
        if tags.get("route") in {"hiking", "foot"}:
            members = expand(relation.id, self.inventory.relations)
            if any(m.type == "r" for m in relation.members):
                self.counts["expanded_hiking_relations"] += 1
            self.writer.add_relation(relation.replace(tags=tags, members=[("w", w, role) for w, role in members]))
        else:
            self.writer.add_relation(relation.replace(tags=tags))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    if os.path.realpath(args.input) == os.path.realpath(args.output):
        parser.error("input and output must differ")
    if os.path.exists(args.output):
        parser.error("output already exists; choose a new derivative")
    inventory = Inventory()
    inventory.apply_file(args.input, filters=[
        osmium.filter.EntityFilter(osmium.osm.NODE | osmium.osm.RELATION),
        osmium.filter.KeyFilter("barrier", "ford", "access", "foot", "locked").enable_for(osmium.osm.NODE),
    ])
    inventory.max_node = int(subprocess.check_output([
        "osmium", "fileinfo", "-e", "-g", "data.maxid.nodes", args.input], text=True))
    print("Inventoried foot barriers and relations", flush=True)
    plan = Plan(inventory)
    plan.apply_file(args.input, locations=True, idx="flex_mem", filters=[osmium.filter.EntityFilter(osmium.osm.WAY)])
    print(f"Planned {len(plan.nodes)} blocker nodes", flush=True)
    with osmium.SimpleWriter(args.output, overwrite=False) as writer:
        copier = Copier(writer, inventory, plan)
        processor = osmium.FileProcessor(args.input).with_filter(
            osmium.filter.KeyFilter("barrier", "ford", "access", "foot", "locked").enable_for(osmium.osm.NODE)
        ).handler_for_filtered(writer)
        for obj in processor:
            if obj.is_node():
                copier.node(obj)
            elif obj.is_way():
                copier.way(obj)
            elif obj.is_relation():
                copier.relation(obj)
    counts = dict(copier.counts)
    counts.update(inserted_blocker_nodes=len(plan.nodes),
                  barrier_nodes_on_multiple_ways=sum(n > 1 for n in plan.incidence.values()))
    print(json.dumps(counts, sort_keys=True))


if __name__ == "__main__":
    main()
