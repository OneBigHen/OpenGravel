package com.opengravel.gh;

import com.graphhopper.routing.ev.*;
import com.graphhopper.storage.BaseGraph;
import com.graphhopper.util.EdgeIteratorState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.Comparator;
import java.util.stream.IntStream;

/**
 * og_through and og_through_street on the imported graph (see {@link OgThroughFlags}).
 *
 * og_through: edges a motorcycle may legally use (car access either way, road access not private
 * or no). og_through_street: the same, without unpaved surfaces and without tracks rougher than
 * grade 1 (a track of unknown grade is not known to be grade 1, so it is left out too).
 */
public final class OgThroughPass {
    public static final String KEY = "og_through";
    public static final String STREET_KEY = "og_through_street";
    private static final Logger logger = LoggerFactory.getLogger(OgThroughPass.class);

    private OgThroughPass() {
    }

    public static BooleanEncodedValue create(String key) {
        return new SimpleBooleanEncodedValue(key, false);
    }

    public static void compute(BaseGraph graph, EncodedValueLookup lookup) {
        long started = System.nanoTime();
        BooleanEncodedValue accessEnc = lookup.getBooleanEncodedValue(VehicleAccess.key("car"));
        EnumEncodedValue<RoadAccess> roadAccessEnc = lookup.hasEncodedValue(RoadAccess.KEY) ? lookup.getEnumEncodedValue(RoadAccess.KEY, RoadAccess.class) : null;
        EnumEncodedValue<Surface> surfaceEnc = lookup.hasEncodedValue(Surface.KEY) ? lookup.getEnumEncodedValue(Surface.KEY, Surface.class) : null;
        EnumEncodedValue<TrackType> trackEnc = lookup.hasEncodedValue(TrackType.KEY) ? lookup.getEnumEncodedValue(TrackType.KEY, TrackType.class) : null;
        EnumEncodedValue<RoadClass> rcEnc = lookup.getEnumEncodedValue(RoadClass.KEY, RoadClass.class);
        IntEncodedValue wayEnc = lookup.hasEncodedValue(OSMWayID.KEY) ? lookup.getIntEncodedValue(OSMWayID.KEY) : null;
        int n = graph.getEdges();
        int[] from = new int[n], to = new int[n];
        double[] meters = new double[n];
        long[] wayId = new long[n];
        boolean[] usable = new boolean[n], street = new boolean[n];
        IntStream.range(0, n).parallel().forEach(e -> {
            EdgeIteratorState s = graph.getEdgeIteratorState(e, Integer.MIN_VALUE);
            from[e] = s.getBaseNode();
            to[e] = s.getAdjNode();
            meters[e] = s.getDistance();
            wayId[e] = wayEnc == null ? 0 : s.get(wayEnc);
            RoadAccess ra = roadAccessEnc == null ? RoadAccess.YES : s.get(roadAccessEnc);
            usable[e] = (s.get(accessEnc) || s.getReverse(accessEnc)) && ra != RoadAccess.PRIVATE && ra != RoadAccess.NO;
            Surface surface = surfaceEnc == null ? Surface.MISSING : s.get(surfaceEnc);
            TrackType track = trackEnc == null ? TrackType.MISSING : s.get(trackEnc);
            boolean unpaved = surface == Surface.UNPAVED || surface == Surface.COMPACTED || surface == Surface.FINE_GRAVEL
                    || surface == Surface.GRAVEL || surface == Surface.GROUND || surface == Surface.DIRT
                    || surface == Surface.GRASS || surface == Surface.SAND;
            boolean rough = track == TrackType.GRADE2 || track == TrackType.GRADE3 || track == TrackType.GRADE4 || track == TrackType.GRADE5
                    || s.get(rcEnc) == RoadClass.TRACK && track != TrackType.GRADE1;
            street[e] = usable[e] && !unpaved && !rough;
        });

        // Fold artificial copies (same two nodes, same OSM way, same length) into their original.
        int[] alias = foldCopies(from, to, meters, wayId);
        boolean[] usableOnce = new boolean[n], streetOnce = new boolean[n];
        int copies = 0;
        for (int e = 0; e < n; e++) {
            if (alias[e] != e) { copies++; continue; }
            usableOnce[e] = usable[e];
            streetOnce[e] = street[e];
        }
        boolean[] through = OgThroughFlags.compute(graph.getNodes(), from, to, meters, usableOnce);
        boolean[] throughStreet = OgThroughFlags.compute(graph.getNodes(), from, to, meters, streetOnce);

        BooleanEncodedValue throughEnc = lookup.hasEncodedValue(KEY) ? lookup.getBooleanEncodedValue(KEY) : null;
        BooleanEncodedValue streetEnc = lookup.hasEncodedValue(STREET_KEY) ? lookup.getBooleanEncodedValue(STREET_KEY) : null;
        double usableM = 0, throughM = 0, streetM = 0, throughStreetM = 0;
        for (int e = 0; e < n; e++) {
            int o = alias[e];
            boolean t = usable[e] && through[o];
            boolean ts = street[e] && throughStreet[o];
            EdgeIteratorState s = graph.getEdgeIteratorState(e, Integer.MIN_VALUE);
            if (throughEnc != null) s.set(throughEnc, t);
            if (streetEnc != null) s.set(streetEnc, ts);
            if (o == e) {
                if (usable[e]) usableM += meters[e];
                if (t) throughM += meters[e];
                if (street[e]) streetM += meters[e];
                if (ts) throughStreetM += meters[e];
            }
        }
        logger.info("og_through: {} edges ({} artificial copies folded); through {} of {} km usable; street through {} of {} km; {} s",
                n, copies, Math.round(throughM / 1000), Math.round(usableM / 1000), Math.round(throughStreetM / 1000), Math.round(streetM / 1000),
                String.format("%.1f", (System.nanoTime() - started) / 1e9));
    }

    /** alias[e] = the first edge with the same two nodes, OSM way and length (itself when unique). */
    static int[] foldCopies(int[] from, int[] to, double[] meters, long[] wayId) {
        int n = from.length;
        Integer[] order = new Integer[n];
        for (int e = 0; e < n; e++) order[e] = e;
        Comparator<Integer> byPair = Comparator.<Integer>comparingInt(e -> Math.min(from[e], to[e]))
                .thenComparingInt(e -> Math.max(from[e], to[e]))
                .thenComparingLong(e -> wayId[e])
                .thenComparingLong(e -> Math.round(meters[e] * 100))
                .thenComparingInt(e -> e);
        Arrays.parallelSort(order, byPair);
        int[] alias = new int[n];
        for (int i = 0; i < n; i++) {
            int e = order[i];
            alias[e] = e;
            if (i > 0) {
                int p = order[i - 1];
                if (Math.min(from[p], to[p]) == Math.min(from[e], to[e]) && Math.max(from[p], to[p]) == Math.max(from[e], to[e])
                        && wayId[p] == wayId[e] && Math.round(meters[p] * 100) == Math.round(meters[e] * 100))
                    alias[e] = alias[p];
            }
        }
        return alias;
    }
}
