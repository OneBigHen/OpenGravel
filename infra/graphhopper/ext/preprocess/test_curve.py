import json
import base64
import zlib
import math
from pathlib import Path
import unittest
from curve import Road, distance, identity, make_tag, masked_integral, raw_measure, score_roads, window_integrals


def arc():
    return [(40.8+80*math.sin(i*.08)/110540, -75.7+80*math.cos(i*.08)/(111320*math.cos(math.radians(40.8)))) for i in range(41)]


def table(tag):
    text=zlib.decompress(base64.b64decode(tag[4:])).decode()
    return [tuple(map(int,row.split(":"))) for row in text.split(";")[1:]]


class CurveTests(unittest.TestCase):
    def test_shared_franco_primitive(self):
        fixtures=json.loads((Path(__file__).parents[1]/"fixtures/franco.json").read_text())
        for fixture in fixtures:
            line=[(p["lat"],p["lon"]) for p in fixture["line"]]
            with self.subTest(fixture=fixture["id"]):
                self.assertAlmostEqual(raw_measure(line),fixture["weightedMeters"],places=5)

    def test_local_window_does_not_light_up_straight_miles(self):
        line=arc()
        lat,lon=line[-1]
        line += [(lat+i*.001,lon) for i in range(1,31)]
        positions,areas=window_integrals(line)
        self.assertGreater(areas[35],0)
        self.assertAlmostEqual(areas[-1]-areas[-10],0,places=5)
        self.assertTrue(all(0 <= b-a <= q-p+1e-8 for a,b,p,q in zip(areas,areas[1:],positions,positions[1:])))

    def test_degree_two_named_way_boundary_matches_unsplit_road(self):
        line=arc()
        nodes=list(range(1,len(line)+1))
        degree={node:2 for node in nodes}; degree[nodes[0]]=degree[nodes[-1]]=1
        key=identity({"name":"test ridge"})
        whole={1:Road(nodes,[v for p in line for v in p],key,False)}
        # The second OSM way is reversed on purpose. Curves must survive its artificial boundary.
        split={1:Road(nodes[:21],[v for p in line[:21] for v in p],key,False),
               2:Road(nodes[20:][::-1],[v for p in line[20:][::-1] for v in p],key,False)}
        out={}; score_roads(whole,degree,set(),lambda wid,tag:out.update({wid:tag}))
        expected=table(out[1]); out={}
        self.assertEqual(score_roads(split,degree,set(),lambda wid,tag:out.update({wid:tag})),1)
        left,right=table(out[1]),table(out[2])
        self.assertLessEqual(abs(left[-1][3]+right[-1][3]-expected[-1][3]),1)  # independently rounded millimetres
        self.assertGreater(right[-1][3],0)

    def test_junction_corner_and_street_farming(self):
        line=[(40.8,-75.7),(40.8001,-75.7),(40.8001,-75.6999)]
        self.assertGreater(raw_measure(line),0)
        _,areas=window_integrals(line,{1})
        self.assertEqual(areas[-1],0)
        points=arc(); nodes=list(range(len(points)))
        road=Road(nodes,[v for p in points for v in p],identity({"name":"street"}),True)
        out={}; score_roads({7:road},{n:2 for n in nodes},set(),lambda wid,tag:out.update({wid:tag}))
        self.assertEqual(table(out[7])[-1][3],0)

    def test_suppress_tight_return_near_junction_by_physical_distance(self):
        line=[(40.8+y/110540,-75.7+x/(111320*math.cos(math.radians(40.8))))
              for x,y in [(0,0),(20,0),(20,15),(-10,15),(-10,-10),(15,-10),(15,5)]]
        self.assertGreater(raw_measure(line),0)
        _,areas=window_integrals(line,{0})
        self.assertEqual(areas[-1],0)

    def test_segment_portion_inside_junction_radius_is_clipped(self):
        _,_,area=masked_integral([0,35,70],[1,0],[0])
        self.assertEqual(area[-1],5)

    def test_shared_name_ref_and_class_change_still_join(self):
        points=arc(); nodes=list(range(len(points))); degree={n:2 for n in nodes}
        roads={1:Road(nodes[:21],[v for p in points[:21] for v in p],identity({"highway":"secondary","name":"Ridge","ref":"PA 1;PA 2"}),False),
               2:Road(nodes[20:],[v for p in points[20:] for v in p],identity({"highway":"tertiary","name":"Ridge"}),False)}
        self.assertEqual(score_roads(roads,degree,{20},lambda *_:None),1)
        self.assertTrue(identity({"ref":"PA 1;PA 2"}).intersection(identity({"ref":"PA 2"})))

    def test_no_join_across_junction_or_different_name(self):
        points=arc(); nodes=list(range(len(points)))
        for degree_at_join,key in [(3,identity({"name":"same"})),(2,identity({"name":"different"}))]:
            degree={n:2 for n in nodes};degree[20]=degree_at_join
            roads={1:Road(nodes[:21],[v for p in points[:21] for v in p],identity({"name":"same"}),False),
                   2:Road(nodes[20:],[v for p in points[20:] for v in p],key,False)}
            self.assertEqual(score_roads(roads,degree,set(),lambda *_:None),2)


if __name__=="__main__": unittest.main()
