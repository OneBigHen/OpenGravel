"""Unit/preprocessing tests; --integration also uses the actual isolated GH11 jar."""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("hike_access", HERE / "hike-access.py")
access = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(access)


def fixture():
    root = ET.Element("osm", version="0.6")
    restrictions = [
        {"barrier": "gate"}, {"barrier": "stile"},
        {"barrier": "gate", "access": "private", "foot": "yes"},
        {"barrier": "stile", "foot": "no"}, {"barrier": "gate", "locked": "yes"},
        {"barrier": "gate", "locked": "yes", "foot": "yes"}, {}, {}, {}, {}, {}, {},
    ]
    for i, tags in enumerate(restrictions):
        for j in range(3):
            n = ET.SubElement(root, "node", id=str(i * 3 + j + 1), lat=str(40 + i * 0.02), lon=str(-75 + j * 0.01))
            if j == 1:
                for k, v in tags.items(): ET.SubElement(n, "tag", k=k, v=v)
    for node_id, lon in ((100, -75), (101, -74.98)):
        ET.SubElement(root, "node", id=str(node_id), lat="40.001", lon=str(lon))
    for row in (12, 13):
        for offset, lon, delta in ((0, -75, 0), (1, -74.99, 0), (2, -74.98, 0), (3, -74.99, 0.002)):
            ET.SubElement(root, "node", id=str(200 + (row - 12) * 10 + offset), lat=str(40 + row * 0.02 + delta), lon=str(lon))
    for row in (14, 15):
        for offset, lon in enumerate((-75, -74.995, -74.985, -74.98)):
            ET.SubElement(root, "node", id=str(220 + (row - 14) * 10 + offset), lat=str(40 + row * 0.02), lon=str(lon))
    way_tags = [{}, {}, {}, {}, {}, {}, {"access": "private", "foot": "designated"},
                {"access": "no", "foot": "designated"}, {"sac_scale": "demanding_mountain_hiking"},
                {"highway": "trunk", "foot": "yes"}, {"highway": "primary", "foot": "yes"}, {"foot": "no"}]
    for i, tags in enumerate(way_tags):
        for j in range(2):
            w = ET.SubElement(root, "way", id=str(i * 2 + j + 1))
            for ref in (i * 3 + j + 1, i * 3 + j + 2): ET.SubElement(w, "nd", ref=str(ref))
            for k, v in {"highway": "path", **tags}.items(): ET.SubElement(w, "tag", k=k, v=v)
    road = ET.SubElement(root, "way", id="100")
    for node_id in (100, 101): ET.SubElement(road, "nd", ref=str(node_id))
    ET.SubElement(road, "tag", k="highway", v="service")
    for row in (12, 13):
        base = 200 + (row - 12) * 10
        for number, refs, highway in ((base, (base, base + 1, base + 2), "path" if row == 12 else "service"),
                                      (base + 1, (base, base + 3, base + 2), "path")):
            way = ET.SubElement(root, "way", id=str(number))
            for ref in refs: ET.SubElement(way, "nd", ref=str(ref))
            ET.SubElement(way, "tag", k="highway", v=highway)
    for row, road_class in ((14, "trunk"), (15, "motorway")):
        base = 220 + (row - 14) * 10
        for offset in range(3):
            way = ET.SubElement(root, "way", id=str(base + offset))
            for ref in (base + offset, base + offset + 1): ET.SubElement(way, "nd", ref=str(ref))
            ET.SubElement(way, "tag", k="highway", v=road_class if offset == 1 else "path")
            ET.SubElement(way, "tag", k="foot", v="yes")
    # Parent's network must reach its grandchild way in the actual GH graph.
    for relation_id, kind, ref in ((1, "relation", 2), (2, "way", 201)):
        relation = ET.SubElement(root, "relation", id=str(relation_id))
        ET.SubElement(relation, "member", type=kind, ref=str(ref), role="")
        ET.SubElement(relation, "tag", k="type", v="route")
        ET.SubElement(relation, "tag", k="route", v="hiking")
    return root


class HikeAccessTest(unittest.TestCase):
    def test_barrier_policy(self):
        for barrier in ("gate", "stile", "kissing_gate", "lift_gate", "cycle_barrier", "bollard"):
            self.assertFalse(access.blocked({"barrier": barrier}))
        self.assertFalse(access.blocked({"barrier": "gate", "access": "no", "foot": "designated"}))
        self.assertFalse(access.blocked({"barrier": "gate", "access": "private", "foot": "yes"}))
        self.assertTrue(access.blocked({"barrier": "stile", "foot": "no"}))
        self.assertTrue(access.blocked({"barrier": "gate", "locked": "yes"}))
        self.assertFalse(access.blocked({"barrier": "gate", "locked": "yes", "foot": "yes"}))
        self.assertTrue(access.blocked({"barrier": "fence"}))

    def test_nested_relation_expansion_and_cycle(self):
        relations = {1: ({}, [("r", 2, ""), ("w", 3, "")]),
                     2: ({}, [("w", 1, ""), ("r", 1, ""), ("r", 999, "")])}
        self.assertEqual(access.expand(1, relations), [(1, ""), (3, "")])

    def test_nested_relation_is_flattened_and_parent_restrictions_reach_member_ways(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / "input.osm", Path(tmp) / "output.osm"
            root = fixture()
            ET.SubElement(root.find("relation[@id='1']"), "tag", k="access", v="no")
            ET.ElementTree(root).write(source)
            subprocess.run([sys.executable, str(HERE / "hike-access.py"), str(source), str(output)], check=True, capture_output=True)
            result = ET.parse(output).getroot()
            members = result.find("relation[@id='1']").findall("member")
            self.assertEqual([(m.attrib["type"], m.attrib["ref"]) for m in members], [("way", "201")])
            tags = {t.attrib["k"]: t.attrib["v"] for t in result.find("way[@id='201']").findall("tag")}
            self.assertEqual(tags["foot"], "no")

    def test_junction_restrictions_move_to_every_approach(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / "input.osm", Path(tmp) / "output.osm"
            ET.ElementTree(fixture()).write(source)
            subprocess.run([sys.executable, str(HERE / "hike-access.py"), str(source), str(output)], check=True, capture_output=True)
            root = ET.parse(output).getroot()
            nodes = {int(n.attrib["id"]): n for n in root.findall("node")}
            tags = lambda n: {t.attrib["k"]: t.attrib["v"] for t in n.findall("tag")}
            self.assertNotIn("barrier", tags(nodes[2]))  # passable gate
            for way_id in (7, 8, 9, 10):  # both ways at each blocked junction
                way = root.find(f"way[@id='{way_id}']")
                refs = [int(n.attrib["ref"]) for n in way.findall("nd")]
                self.assertEqual(len(refs), 3)
                blocker = next(ref for ref in refs if ref > 213)
                self.assertEqual(tags(nodes[blocker])["foot"], "no")
                self.assertEqual(tags(nodes[blocker])["barrier"], "fence")
            for way_id in (13, 14, 15, 16):
                self.assertEqual(tags(root.find(f"way[@id='{way_id}']"))["foot"], "designated")


def integration(jar, overlay):
    # No web listener or external graph. All fixture files/cache live in the hike build directory.
    with tempfile.TemporaryDirectory(prefix="fixture-", dir=Path(overlay).parent) as tmp:
        source, output = Path(tmp) / "input.osm", Path(tmp) / "output.osm"
        ET.ElementTree(fixture()).write(source)
        subprocess.run([sys.executable, str(HERE / "hike-access.py"), str(source), str(output)], check=True)
        cp = f"{overlay}:{jar}"
        subprocess.run(["javac", "-cp", cp, "-d", tmp, str(HERE / "HikeGraphChecks.java")], check=True)
        subprocess.run(["java", "-cp", f"{tmp}:{cp}", "HikeGraphChecks", str(output), str(Path(tmp) / "graph"),
                        str(HERE / "custom-models/ogv-hike.json")], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--integration", nargs=2, metavar=("JAR", "OVERLAY_JAR"))
    args = parser.parse_args()
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(HikeAccessTest))
    if not result.wasSuccessful(): sys.exit(1)
    if args.integration: integration(*args.integration)
