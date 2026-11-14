package com.opengravel.gh;

import com.graphhopper.routing.ev.*;
import com.graphhopper.routing.util.EncodingManager;
import com.graphhopper.storage.BaseGraph;
import com.graphhopper.storage.DAType;
import com.graphhopper.storage.GHDirectory;
import com.graphhopper.storage.StorableProperties;
import com.graphhopper.storage.index.LocationIndexTree;
import com.graphhopper.storage.index.Snap;
import com.graphhopper.util.EdgeExplorer;
import com.graphhopper.util.EdgeIterator;
import com.graphhopper.util.EdgeIteratorState;

import java.io.BufferedReader;
import java.io.InputStreamReader;

/**
 * Read-only look at a built v2 graph: why a point reads through or not.
 *
 * java -cp og-ext.jar:graphhopper-web-11.0.jar com.opengravel.gh.OgInspect GRAPH_DIR < points.txt
 * Each input line: "label lat lon". For each, the nearest road a motorcycle may use, its stored values,
 * and the through reasoning recomputed from the graph (bridge or not, length of its part, big parts on
 * each side of a bridge), plus how many usable roads meet at each end of that edge.
 */
public final class OgInspect {
    public static void main(String[] args) throws Exception {
        GHDirectory dir = new GHDirectory(args[0], DAType.RAM_STORE);
        StorableProperties props = new StorableProperties(dir);
        if (!props.loadExisting()) throw new IllegalStateException("no graph at " + args[0]);
        EncodingManager em = EncodingManager.fromProperties(props);
        BaseGraph graph = new BaseGraph.Builder(em).setDir(dir).build();
        if (!graph.loadExisting()) throw new IllegalStateException("cannot load graph");
        LocationIndexTree index = new LocationIndexTree(graph, dir);
        if (!index.loadExisting()) throw new IllegalStateException("cannot load location index");

        OgThroughPass.Inputs in = OgThroughPass.inputs(graph, em);
        OgThroughFlags.Analysis a = OgThroughFlags.analyze(graph.getNodes(), in.from, in.to, in.meters, in.usableOnce);
        BooleanEncodedValue throughEnc = em.getBooleanEncodedValue(OgThroughPass.KEY);
        DecimalEncodedValue curveEnc = em.getDecimalEncodedValue(OgCurveField.KEY);
        EnumEncodedValue<RoadClass> rcEnc = em.getEnumEncodedValue(RoadClass.KEY, RoadClass.class);
        EdgeExplorer explorer = graph.createEdgeExplorer();

        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = reader.readLine()) != null) {
            String[] f = line.trim().split("\\s+");
            if (f.length < 3) continue;
            double lat = Double.parseDouble(f[1]), lon = Double.parseDouble(f[2]);
            Snap snap = index.findClosest(lat, lon, edge -> in.usable[edge.getEdge()]);
            if (!snap.isValid()) { System.out.println(f[0] + " no usable road nearby"); continue; }
            EdgeIteratorState s = snap.getClosestEdge();
            int e = in.alias[s.getEdge()];
            System.out.printf("%s edge %d %s '%s' %.0f m, snapped %.0f m away: og_through %s og_curve %.2f | bridge %s, part %.1f km, big parts below/other side %d/%d, roads at ends %d/%d%n",
                    f[0], e, s.get(rcEnc), s.getName(), s.getDistance(), snap.getQueryDistance(), s.get(throughEnc), s.get(curveEnc),
                    a.bridge[e], a.partMetersOfEdge[e] / 1000, a.bigBelow[e], a.bigOther[e],
                    usableDegree(explorer, in, in.from[e]), usableDegree(explorer, in, in.to[e]));
        }
    }

    static int usableDegree(EdgeExplorer explorer, OgThroughPass.Inputs in, int node) {
        int d = 0;
        EdgeIterator it = explorer.setBaseNode(node);
        while (it.next()) if (in.usableOnce[it.getEdge()]) d++;
        return d;
    }
}
