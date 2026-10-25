"""Run in powerplex's curve-venv; pure geometry tests do not require pyosmium."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(importlib.util.find_spec("osmium"),"pyosmium PBF round-trip runs in powerplex curve-venv")
class PbfTests(unittest.TestCase):
    def test_only_curvature_tags_change_and_tag_values_fit_osm(self):
        import osmium
        here=Path(__file__).parent
        source=here.parent/"fixtures/tiny.osm"
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/"curve.osm.pbf"
            subprocess.run([sys.executable,str(here/"curve.py"),str(source),str(output)],check=True,capture_output=True)
            snapshots=[]
            for file in (source,output):
                snapshot={}
                class Capture(osmium.SimpleHandler):
                    def node(self,node):
                        snapshot[("n",node.id)]=(node.lat,node.lon,dict(node.tags))
                    def way(self,way):
                        tags=dict(way.tags)
                        if file==output:
                            self_test.assertIn("og:curve",tags)
                            self_test.assertTrue(all(len(value.encode())<=255 for value in tags.values()))
                        snapshot[("w",way.id)]=([n.ref for n in way.nodes],{k:v for k,v in tags.items() if not k.startswith("og:curve")})
                    def relation(self,relation):
                        snapshot[("r",relation.id)]=([(m.type,m.ref,m.role) for m in relation.members],dict(relation.tags))
                self_test=self
                Capture().apply_file(str(file))
                snapshots.append(snapshot)
            self.assertEqual(snapshots[0],snapshots[1])
            manifest=json.loads(Path(str(output)+".json").read_text())
            self.assertEqual(manifest["ways"],2)
            self.assertEqual(len(manifest["inputSha256"]),64)
            self.assertEqual(len(manifest["outputSha256"]),64)


if __name__=="__main__": unittest.main()
