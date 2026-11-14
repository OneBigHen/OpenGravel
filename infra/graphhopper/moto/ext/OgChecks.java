package com.opengravel.gh;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Checks the router's copy of the bend maths against the app's (shared fixtures written by
 * scripts/geometry/write-road-bend-fixtures.ts), and the through flags on small synthetic graphs.
 *
 * java -cp og-ext.jar:graphhopper-web-11.0.jar com.opengravel.gh.OgChecks tests/fixtures/road-bends
 * Exit 0 only when every check passes.
 */
public final class OgChecks {
    private static int failures = 0;

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("usage: OgChecks FIXTURE_DIR");
        File[] files = new File(args[0]).listFiles((d, name) -> name.endsWith(".json"));
        if (files == null || files.length < 10) fail("expected at least 10 fixtures in " + args[0]);
        else {
            Arrays.sort(files);
            for (File f : files) checkFixture(new ObjectMapper().readTree(f));
        }
        checkThroughFlags();
        System.out.println(failures == 0 ? "OgChecks: all passed" : "OgChecks: " + failures + " failed");
        System.exit(failures == 0 ? 0 : 1);
    }

    static void checkFixture(JsonNode fx) {
        String name = fx.get("name").asText();
        JsonNode line = fx.get("line");
        int n = line.size();
        double[] lat = new double[n], lon = new double[n];
        for (int i = 0; i < n; i++) { lat[i] = line.get(i).get("lat").asDouble(); lon[i] = line.get(i).get("lon").asDouble(); }
        JsonNode run = fx.get("run");
        boolean earns = OgBendMath.earns(run.get("roadClass").asText(), run.get("urbanDensity").asText(),
                run.path("roadClassLink").asBoolean(false), run.path("roundabout").asBoolean(false));
        boolean busy = OgBendMath.busy(run.get("roadClass").asText());
        double expected = fx.get("expected").get("bendMeters").asDouble();
        double got = OgBendMath.measure(lat, lon, n, earns, busy).bendMeters;
        expectClose(name + " raw bend metres", got, expected);

        if (!fx.path("splitIndex").isNull() && fx.has("splitIndex")) {
            // A side road meets the arc: the router has two edges. Each is measured on its own geometry
            // extended EXTEND_METERS into the other, crediting only its own metres; together they must
            // give the whole arc. Without the extension the cut arc loses its ends.
            int s = fx.get("splitIndex").asInt();
            double[] aLat = Arrays.copyOfRange(lat, 0, s + 1), aLon = Arrays.copyOfRange(lon, 0, s + 1);
            double[] bLat = Arrays.copyOfRange(lat, s, n), bLon = Arrays.copyOfRange(lon, s, n);
            double aLen = OgBendMath.length(aLat, aLon, aLat.length);
            double[][] intoB = cut(bLat, bLon, OgCurveField.EXTEND_METERS);
            double[][] intoA = cut(reverse(aLat), reverse(aLon), OgCurveField.EXTEND_METERS);
            double[][] lineA = join(aLat, aLon, intoB[0], intoB[1]);
            double[][] lineB = join(reverse(intoA[0]), reverse(intoA[1]), bLat, bLon);
            double prefix = OgBendMath.length(intoA[0], intoA[1], intoA[0].length);
            double partA = OgBendMath.measure(lineA[0], lineA[1], lineA[0].length, earns, busy, 0, aLen).bendMeters;
            double partB = OgBendMath.measure(lineB[0], lineB[1], lineB[0].length, earns, busy, prefix, Double.POSITIVE_INFINITY).bendMeters;
            double bare = OgBendMath.measure(aLat, aLon, aLat.length, earns, busy).bendMeters + OgBendMath.measure(bLat, bLon, bLat.length, earns, busy).bendMeters;
            expectClose(name + " two edges with 40 m extension", partA + partB, expected);
            System.out.printf("  (%s without the extension the two edges would read %.1f m)%n", name, bare);
        }
    }

    static void expectClose(String what, double got, double expected) {
        double tolerance = Math.max(15, Math.abs(expected) * 0.05);
        boolean ok = Math.abs(got - expected) <= tolerance;
        if (!ok) failures++;
        System.out.printf("%s %s: java %.1f, typescript %.1f%n", ok ? "PASS" : "FAIL", what, got, expected);
    }

    static void fail(String what) {
        failures++;
        System.out.println("FAIL " + what);
    }

    static double[] reverse(double[] a) {
        double[] r = new double[a.length];
        for (int i = 0; i < a.length; i++) r[i] = a[a.length - 1 - i];
        return r;
    }

    /** The first `meters` of a line, interpolating the cut point. */
    static double[][] cut(double[] lat, double[] lon, double meters) {
        List<double[]> pts = new ArrayList<>();
        pts.add(new double[]{lat[0], lon[0]});
        double run = 0;
        for (int i = 1; i < lat.length; i++) {
            double d = OgBendMath.haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
            if (run + d >= meters) {
                double t = (meters - run) / d;
                pts.add(new double[]{lat[i - 1] + (lat[i] - lat[i - 1]) * t, lon[i - 1] + (lon[i] - lon[i - 1]) * t});
                break;
            }
            run += d;
            pts.add(new double[]{lat[i], lon[i]});
        }
        double[][] r = new double[2][pts.size()];
        for (int i = 0; i < pts.size(); i++) { r[0][i] = pts.get(i)[0]; r[1][i] = pts.get(i)[1]; }
        return r;
    }

    /** a then b, dropping b's first point (it is a's last). */
    static double[][] join(double[] aLat, double[] aLon, double[] bLat, double[] bLon) {
        double[][] r = new double[2][aLat.length + bLat.length - 1];
        System.arraycopy(aLat, 0, r[0], 0, aLat.length);
        System.arraycopy(aLon, 0, r[1], 0, aLon.length);
        System.arraycopy(bLat, 1, r[0], aLat.length, bLat.length - 1);
        System.arraycopy(bLon, 1, r[1], aLon.length, bLon.length - 1);
        return r;
    }

    /** Small graphs with known answers. */
    static void checkThroughFlags() {
        // Tree: 50 km of road, but every edge is an only-way-in: all dead-end territory.
        Graph tree = new Graph();
        tree.edge(0, 1, 10_000); tree.edge(1, 2, 10_000); tree.edge(1, 3, 10_000); tree.edge(3, 4, 10_000); tree.edge(3, 5, 10_000);
        expectAll("tree", tree.through(), 0, 5, false);

        // Ring of 30 km: through. Ring of 5 km on its own: too small, dead-end territory.
        Graph ring = new Graph();
        for (int i = 0; i < 10; i++) ring.edge(i, (i + 1) % 10, 3_000);
        expectAll("30 km ring", ring.through(), 0, 10, true);
        Graph small = new Graph();
        for (int i = 0; i < 5; i++) small.edge(i, (i + 1) % 5, 1_000);
        expectAll("5 km ring", small.through(), 0, 5, false);

        // Lollipop: 30 km ring with a 3 km stick. Ring through, stick not.
        Graph lolly = new Graph();
        for (int i = 0; i < 10; i++) lolly.edge(i, (i + 1) % 10, 3_000);
        lolly.edge(0, 10, 1_000); lolly.edge(10, 11, 1_000); lolly.edge(11, 12, 1_000);
        boolean[] l = lolly.through();
        expectAll("lollipop ring", l, 0, 10, true);
        expectAll("lollipop stick", l, 10, 13, false);

        // Dumbbell: two 25 km rings joined by a 2 km road. The joining road leads somewhere at both ends.
        Graph bell = new Graph();
        for (int i = 0; i < 5; i++) bell.edge(i, (i + 1) % 5, 5_000);
        for (int i = 0; i < 5; i++) bell.edge(10 + i, 10 + (i + 1) % 5, 5_000);
        bell.edge(0, 20, 1_000); bell.edge(20, 10, 1_000);
        expectAll("dumbbell", bell.through(), 0, 12, true);

        // Two parallel roads between the same junctions are a loop, not a bridge.
        Graph parallel = new Graph();
        for (int i = 0; i < 10; i++) parallel.edge(i, (i + 1) % 10, 3_000);
        parallel.edge(0, 10, 1_000); parallel.edge(10, 11, 12_000); parallel.edge(10, 11, 12_000, 99); parallel.edge(11, 12, 2_000);
        boolean[] p = parallel.through();
        expectAll("parallel roads form a 24 km part, and its access road leads somewhere", p, 10, 13, true);
        expectAll("parallel-roads spur end", p, 13, 14, false);

        // An artificial copy of a spur edge (same nodes, way and length) folds into the original,
        // so the copy cannot make the spur look like a loop.
        int[] alias = OgThroughPass.foldCopies(new int[]{0, 1, 1, 1}, new int[]{1, 2, 2, 2}, new double[]{5, 7, 7, 7.5}, new long[]{1, 2, 2, 2});
        boolean folded = alias[0] == 0 && alias[1] == 1 && alias[2] == 1 && alias[3] == 3;
        if (!folded) failures++;
        System.out.println((folded ? "PASS" : "FAIL") + " artificial copies fold into their original: " + Arrays.toString(alias));
    }

    static void expectAll(String what, boolean[] through, int from, int to, boolean expected) {
        boolean ok = true;
        for (int e = from; e < to; e++) ok &= through[e] == expected;
        if (!ok) failures++;
        System.out.println((ok ? "PASS " : "FAIL ") + what + ": edges " + from + ".." + (to - 1) + " expected " + expected + ", got " + Arrays.toString(Arrays.copyOfRange(through, from, to)));
    }

    static final class Graph {
        final List<int[]> ends = new ArrayList<>();
        final List<Double> meters = new ArrayList<>();
        int nodes = 0;

        void edge(int a, int b, double m) { edge(a, b, m, 0); }

        void edge(int a, int b, double m, long way) {
            ends.add(new int[]{a, b});
            meters.add(m);
            nodes = Math.max(nodes, Math.max(a, b) + 1);
        }

        boolean[] through() {
            int n = ends.size();
            int[] from = new int[n], to = new int[n];
            double[] len = new double[n];
            boolean[] usable = new boolean[n];
            for (int i = 0; i < n; i++) { from[i] = ends.get(i)[0]; to[i] = ends.get(i)[1]; len[i] = meters.get(i); usable[i] = true; }
            return OgThroughFlags.compute(nodes, from, to, len, usable);
        }
    }
}
