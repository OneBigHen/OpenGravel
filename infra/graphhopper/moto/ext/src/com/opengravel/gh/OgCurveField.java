package com.opengravel.gh;

import com.graphhopper.routing.ev.*;
import com.graphhopper.storage.BaseGraph;
import com.graphhopper.util.EdgeExplorer;
import com.graphhopper.util.EdgeIterator;
import com.graphhopper.util.EdgeIteratorState;
import com.graphhopper.util.FetchMode;
import com.graphhopper.util.PointList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.stream.IntStream;

/**
 * og_curve: how bendy the road is around each edge, 0 to 1.
 *
 * Raw pass: road-bends-v1 on the edge's own geometry, extended {@link #EXTEND_METERS} into the
 * continuing edge at each end so an arc cut by a side road is not lost; only the metres inside
 * this edge are credited. The continuing edge has the same road class and either the same name
 * or the smallest turn under {@link #STRAIGHT_ON_DEGREES}. No continuation means a junction corner,
 * which earns nothing.
 *
 * Window pass: og_curve = min(1, D / {@link #FULL_SHARE}), where D is weighted bend metres within
 * {@link #WINDOW_METERS} either way along the same continuation chain divided by the metres
 * covered. Roads that do not earn (town streets, service, links, roundabouts, non-rural) read 0.
 */
public final class OgCurveField {
    public static final String KEY = "og_curve";
    public static final double EXTEND_METERS = 40;
    public static final double STRAIGHT_ON_DEGREES = 35;
    /** A same-name road may bend through a junction, but not turn back on itself. */
    public static final double SAME_NAME_MAX_DEGREES = 120;
    public static final double WINDOW_METERS = 500;
    public static final double FULL_SHARE = 0.20;
    /** Bearings at an edge end are read over this many metres. */
    static final double BEARING_METERS = 20;

    private static final Logger logger = LoggerFactory.getLogger(OgCurveField.class);

    private OgCurveField() {
    }

    public static DecimalEncodedValue create() {
        return new DecimalEncodedValueImpl(KEY, 5, 1.0 / 31, false);
    }

    /** Per-edge facts read once from the graph. */
    static final class Edges {
        int count;
        int[] base, adj;
        byte[] roadClass;
        boolean[] earns, busy;
        String[] name;
        long[] wayId;
        double[] meters;
        /** Bearing leaving the base node into the edge, and leaving the adj node into the edge. */
        double[] outOfBase, outOfAdj;
    }

    public static void compute(BaseGraph graph, EncodedValueLookup lookup) {
        long started = System.nanoTime();
        DecimalEncodedValue curveEnc = lookup.getDecimalEncodedValue(KEY);
        Edges edges = read(graph, lookup);
        int n = edges.count;

        // Continuation at each end: cont[2e + end] = continuing edge (or -1), enter[2e + end] = the end we enter it at.
        int[] cont = new int[2 * n];
        byte[] enter = new byte[2 * n];
        Arrays.fill(cont, -1);
        int nodes = graph.getNodes();
        int[] degree = new int[nodes + 1];
        for (int e = 0; e < n; e++) { degree[edges.base[e]]++; degree[edges.adj[e]]++; }
        int[] start = new int[nodes + 1];
        for (int v = 0; v < nodes; v++) start[v + 1] = start[v] + degree[v];
        int[] incident = new int[start[nodes]];
        int[] fill = Arrays.copyOf(start, nodes);
        for (int e = 0; e < n; e++) { incident[fill[edges.base[e]]++] = e; incident[fill[edges.adj[e]]++] = e; }
        IntStream.range(0, n).parallel().forEach(e -> {
            for (int end = 0; end < 2; end++) {
                int node = end == 0 ? edges.base[e] : edges.adj[e];
                int other = end == 0 ? edges.adj[e] : edges.base[e];
                // Arriving at `node` along e: the reverse of leaving `node` into e.
                double arrive = (end == 0 ? edges.outOfBase[e] : edges.outOfAdj[e]) + Math.PI;
                int best = -1, bestEnd = 0;
                double bestTurn = Double.MAX_VALUE;
                boolean bestSameName = false;
                for (int i = start[node]; i < start[node + 1]; i++) {
                    int f = incident[i];
                    if (f == e || edges.roadClass[f] != edges.roadClass[e]) continue;
                    int fEnd = edges.base[f] == node ? 0 : 1;
                    int fOther = fEnd == 0 ? edges.adj[f] : edges.base[f];
                    // An artificial copy of this very edge (via-way turn restrictions) is not a continuation.
                    if (fOther == other && edges.wayId[f] == edges.wayId[e] && Math.abs(edges.meters[f] - edges.meters[e]) < 0.5) continue;
                    double leave = fEnd == 0 ? edges.outOfBase[f] : edges.outOfAdj[f];
                    double turn = Math.abs(OgBendMath.signedTurn(arrive, leave)) * 180 / Math.PI;
                    boolean sameName = !edges.name[e].isEmpty() && edges.name[e].equals(edges.name[f]) && turn < SAME_NAME_MAX_DEGREES;
                    boolean better = sameName && !bestSameName || sameName == bestSameName && turn < bestTurn;
                    if (better) { best = f; bestEnd = fEnd; bestTurn = turn; bestSameName = sameName; }
                }
                if (best >= 0 && (bestSameName || bestTurn < STRAIGHT_ON_DEGREES)) {
                    cont[2 * e + end] = best;
                    enter[2 * e + end] = (byte) bestEnd;
                }
            }
        });
        long continued = Arrays.stream(cont).filter(c -> c >= 0).count();

        // Raw pass: weighted bend metres inside each earning edge.
        double[] raw = new double[n];
        IntStream.range(0, n).parallel().forEach(e -> {
            if (!edges.earns[e]) return;
            PointList own = graph.getEdgeIteratorState(e, edges.adj[e]).fetchWayGeometry(FetchMode.ALL);
            double[][] before = cont[2 * e] < 0 ? null : outward(graph, edges, cont[2 * e], enter[2 * e]);
            double[][] after = cont[2 * e + 1] < 0 ? null : outward(graph, edges, cont[2 * e + 1], enter[2 * e + 1]);
            int cap = own.size() + (before == null ? 0 : before[0].length) + (after == null ? 0 : after[0].length);
            double[] lat = new double[cap], lon = new double[cap];
            int m = 0;
            if (before != null) for (int i = before[0].length - 1; i >= 1; i--) { lat[m] = before[0][i]; lon[m] = before[1][i]; m++; }
            int ownStart = m;
            for (int i = 0; i < own.size(); i++) { lat[m] = own.getLat(i); lon[m] = own.getLon(i); m++; }
            int ownEnd = m - 1;
            if (after != null) for (int i = 1; i < after[0].length; i++) { lat[m] = after[0][i]; lon[m] = after[1][i]; m++; }
            double from = 0;
            for (int i = 1; i <= ownStart; i++) from += OgBendMath.haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
            double to = from;
            for (int i = ownStart + 1; i <= ownEnd; i++) to += OgBendMath.haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
            raw[e] = Math.min(to - from, OgBendMath.measure(lat, lon, m, true, edges.busy[e], from, to).bendMeters);
        });

        // Window pass along the continuation chain.
        double[] value = new double[n];
        IntStream.range(0, n).parallel().forEach(e -> {
            if (!edges.earns[e]) return;
            double covered = edges.meters[e], bend = raw[e];
            for (int end = 0; end < 2; end++) {
                double left = WINDOW_METERS;
                int c = cont[2 * e + end], k = c < 0 ? 0 : enter[2 * e + end];
                for (int steps = 0; c >= 0 && c != e && left > 0 && steps < 1000; steps++) {
                    double l = edges.meters[c];
                    double share = l <= left ? 1 : left / l;
                    covered += share * l;
                    bend += share * raw[c];
                    left -= l;
                    int exit = 1 - k;
                    int next = cont[2 * c + exit];
                    k = next < 0 ? 0 : enter[2 * c + exit];
                    c = next;
                }
            }
            value[e] = covered > 0 ? Math.min(1, bend / covered / FULL_SHARE) : 0;
        });

        double max = curveEnc.getMaxStorableDecimal();
        long nonZero = 0;
        double sum = 0, lengthSum = 0;
        for (int e = 0; e < n; e++) {
            double v = Math.min(max, value[e]);
            graph.getEdgeIteratorState(e, Integer.MIN_VALUE).set(curveEnc, v);
            if (v > 0) nonZero++;
            sum += v * edges.meters[e];
            lengthSum += edges.meters[e];
        }
        logger.info("og_curve: {} edges, {} continued ends, {} edges above 0, length-weighted mean {}, {} s",
                n, continued, nonZero, String.format("%.4f", lengthSum > 0 ? sum / lengthSum : 0), String.format("%.1f", (System.nanoTime() - started) / 1e9));
    }

    /** Points of edge f leaving the given end, cut at {@link #EXTEND_METERS}: [lat[], lon[]], first point is the shared node. */
    static double[][] outward(BaseGraph graph, Edges edges, int f, int fromEnd) {
        int farNode = fromEnd == 0 ? edges.adj[f] : edges.base[f];
        PointList pl = graph.getEdgeIteratorState(f, farNode).fetchWayGeometry(FetchMode.ALL);
        double[] lat = new double[pl.size()], lon = new double[pl.size()];
        int m = 0;
        lat[m] = pl.getLat(0); lon[m] = pl.getLon(0); m++;
        double run = 0;
        for (int i = 1; i < pl.size(); i++) {
            double d = OgBendMath.haversine(pl.getLat(i - 1), pl.getLon(i - 1), pl.getLat(i), pl.getLon(i));
            if (run + d >= EXTEND_METERS) {
                double t = d > 0 ? (EXTEND_METERS - run) / d : 0;
                lat[m] = pl.getLat(i - 1) + (pl.getLat(i) - pl.getLat(i - 1)) * t;
                lon[m] = pl.getLon(i - 1) + (pl.getLon(i) - pl.getLon(i - 1)) * t;
                m++;
                break;
            }
            run += d;
            lat[m] = pl.getLat(i); lon[m] = pl.getLon(i); m++;
        }
        return new double[][]{Arrays.copyOf(lat, m), Arrays.copyOf(lon, m)};
    }

    static Edges read(BaseGraph graph, EncodedValueLookup lookup) {
        EnumEncodedValue<RoadClass> rcEnc = lookup.getEnumEncodedValue(RoadClass.KEY, RoadClass.class);
        BooleanEncodedValue linkEnc = lookup.getBooleanEncodedValue(RoadClassLink.KEY);
        BooleanEncodedValue roundaboutEnc = lookup.getBooleanEncodedValue(Roundabout.KEY);
        EnumEncodedValue<UrbanDensity> udEnc = lookup.hasEncodedValue(UrbanDensity.KEY) ? lookup.getEnumEncodedValue(UrbanDensity.KEY, UrbanDensity.class) : null;
        IntEncodedValue wayEnc = lookup.hasEncodedValue(OSMWayID.KEY) ? lookup.getIntEncodedValue(OSMWayID.KEY) : null;
        Edges r = new Edges();
        int n = graph.getEdges();
        r.count = n;
        r.base = new int[n]; r.adj = new int[n]; r.roadClass = new byte[n];
        r.earns = new boolean[n]; r.busy = new boolean[n]; r.name = new String[n]; r.wayId = new long[n];
        r.meters = new double[n]; r.outOfBase = new double[n]; r.outOfAdj = new double[n];
        IntStream.range(0, n).parallel().forEach(e -> {
            EdgeIteratorState s = graph.getEdgeIteratorState(e, Integer.MIN_VALUE);
            r.base[e] = s.getBaseNode();
            r.adj[e] = s.getAdjNode();
            RoadClass rc = s.get(rcEnc);
            r.roadClass[e] = (byte) rc.ordinal();
            String ud = udEnc == null ? "rural" : s.get(udEnc).name();
            r.earns[e] = OgBendMath.earns(rc.name(), ud, s.get(linkEnc), s.get(roundaboutEnc));
            r.busy[e] = OgBendMath.busy(rc.name());
            String name = s.getName();
            r.name[e] = name == null ? "" : name;
            r.wayId[e] = wayEnc == null ? 0 : s.get(wayEnc);
            PointList pl = s.fetchWayGeometry(FetchMode.ALL);
            int size = pl.size();
            double[] lat = new double[size], lon = new double[size];
            for (int i = 0; i < size; i++) { lat[i] = pl.getLat(i); lon[i] = pl.getLon(i); }
            r.meters[e] = OgBendMath.length(lat, lon, size);
            r.outOfBase[e] = endBearing(lat, lon, false);
            r.outOfAdj[e] = endBearing(lat, lon, true);
        });
        return r;
    }

    /** Bearing leaving one end into the edge, read over about {@link #BEARING_METERS}. */
    static double endBearing(double[] lat, double[] lon, boolean fromAdj) {
        int size = lat.length;
        int a = fromAdj ? size - 1 : 0;
        int step = fromAdj ? -1 : 1;
        int b = a + step;
        double run = OgBendMath.haversine(lat[a], lon[a], lat[b], lon[b]);
        while (run < BEARING_METERS && b + step >= 0 && b + step < size) {
            run += OgBendMath.haversine(lat[b], lon[b], lat[b + step], lon[b + step]);
            b += step;
        }
        return OgBendMath.bearing(lat[a], lon[a], lat[b], lon[b]);
    }
}
