package com.opengravel.gh;

/**
 * road-bends-v1 in Java: the same maths as src/domain/geometry/road-bends.ts (measureRoadBends),
 * for one road (one road run) and with an optional credit window.
 *
 * A bend is at least 30 m of same-direction arc under 175 m radius, sampled every 10 m, weighted
 * 1 / 1.3 / 1.6 / 2 below 175 / 100 / 60 / 30 m radius. Roads that do not earn score 0; busy roads
 * (motorway, trunk, primary) earn only under 100 m radius. Only metres whose chainage lies inside
 * [creditFrom, creditTo] are credited, so a line extended into the next edge of the same road
 * credits just this edge's share of an arc that runs across the junction.
 * Pinned to the TypeScript by tests/fixtures/road-bends (OgChecks).
 */
public final class OgBendMath {
    public static final double SAMPLE = 10;
    public static final double RADIUS = 175;
    public static final double BUSY_RADIUS = 100;
    public static final double MIN_ARC = 30;
    public static final double FLIP_ARC = 20;
    static final double EARTH_RADIUS = 6_371_000;

    private OgBendMath() {
    }

    public static final class Result {
        public final double bendMeters;
        public final double tightMeters;
        public final double totalMeters;

        Result(double bendMeters, double tightMeters, double totalMeters) {
            this.bendMeters = bendMeters;
            this.tightMeters = tightMeters;
            this.totalMeters = totalMeters;
        }
    }

    /** Road classes as GraphHopper names them (any case). */
    public static boolean earns(String roadClass, String urbanDensity, boolean link, boolean roundabout) {
        String rc = roadClass.toLowerCase();
        String ud = urbanDensity.toLowerCase();
        if (rc.equals("residential") || rc.equals("service") || rc.equals("living_street") || rc.equals("missing") || rc.equals("other"))
            return false;
        if (rc.endsWith("_link") || link || roundabout) return false;
        return !ud.equals("residential") && !ud.equals("city");
    }

    public static boolean busy(String roadClass) {
        String rc = roadClass.toLowerCase();
        return rc.equals("motorway") || rc.equals("trunk") || rc.equals("primary");
    }

    static double radiusWeight(double radius) {
        if (radius < 30) return 2;
        if (radius < 60) return 1.6;
        if (radius < 100) return 1.3;
        if (radius < RADIUS) return 1;
        return 0;
    }

    public static double haversine(double lat1, double lon1, double lat2, double lon2) {
        double a1 = Math.toRadians(lat1), a2 = Math.toRadians(lat2);
        double dLat = a2 - a1, dLon = Math.toRadians(lon2 - lon1);
        double s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a1) * Math.cos(a2) * Math.pow(Math.sin(dLon / 2), 2);
        return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(s));
    }

    static double bearing(double lat1, double lon1, double lat2, double lon2) {
        double rad = Math.PI / 180;
        double y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
        double x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
        return Math.atan2(y, x);
    }

    static double signedTurn(double from, double to) {
        return ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    }

    /** Length of a polyline in metres. */
    public static double length(double[] lat, double[] lon, int n) {
        double sum = 0;
        for (int i = 1; i < n; i++) sum += haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
        return sum;
    }

    /** The whole line, credited in full (the TypeScript measure for one road run, no junctions). */
    public static Result measure(double[] lat, double[] lon, int n, boolean earns, boolean busy) {
        return measure(lat, lon, n, earns, busy, Double.NEGATIVE_INFINITY, Double.POSITIVE_INFINITY);
    }

    /**
     * Weighted bend metres of the line, crediting only chainage inside [creditFrom, creditTo]
     * (measured along the original line). Returns zeros for a road that does not earn.
     */
    public static Result measure(double[] lat, double[] lon, int n, boolean earns, boolean busy, double creditFrom, double creditTo) {
        if (n < 3 || !earns) return new Result(0, 0, n < 2 ? 0 : length(lat, lon, n));
        // Resample by travelled distance, keeping both ends.
        int cap = (int) (length(lat, lon, n) / SAMPLE) + n + 4;
        double[] pLat = new double[cap], pLon = new double[cap], ch = new double[cap];
        int m = 0;
        pLat[m] = lat[0]; pLon[m] = lon[0]; ch[m] = 0; m++;
        double covered = 0;
        for (int i = 1; i < n; i++) {
            double aLat = lat[i - 1], aLon = lon[i - 1], bLat = lat[i], bLon = lon[i];
            double len = haversine(aLat, aLon, bLat, bLon);
            for (double at = Math.ceil((covered + 1e-9) / SAMPLE) * SAMPLE; at < covered + len; at += SAMPLE) {
                double t = (at - covered) / len;
                if (m == cap) { cap *= 2; pLat = java.util.Arrays.copyOf(pLat, cap); pLon = java.util.Arrays.copyOf(pLon, cap); ch = java.util.Arrays.copyOf(ch, cap); }
                pLat[m] = aLat + (bLat - aLat) * t; pLon[m] = aLon + (bLon - aLon) * t; ch[m] = at; m++;
            }
            covered += len;
        }
        double lastStep = haversine(pLat[m - 1], pLon[m - 1], lat[n - 1], lon[n - 1]);
        if (lastStep > 0.01) {
            if (m == cap) { cap += 1; pLat = java.util.Arrays.copyOf(pLat, cap); pLon = java.util.Arrays.copyOf(pLon, cap); ch = java.util.Arrays.copyOf(ch, cap); }
            pLat[m] = lat[n - 1]; pLon[m] = lon[n - 1]; ch[m] = covered; m++;
        } else {
            pLat[m - 1] = lat[n - 1]; pLon[m - 1] = lon[n - 1]; ch[m - 1] = covered;
        }
        double total = ch[m - 1];
        if (!(total > 0)) return new Result(0, 0, 0);

        double[] turns = new double[m];
        for (int i = 2; i < m; i++)
            turns[i] = signedTurn(bearing(pLat[i - 2], pLon[i - 2], pLat[i - 1], pLon[i - 1]), bearing(pLat[i - 1], pLon[i - 1], pLat[i], pLon[i]));
        int reach = Math.max(1, (int) Math.round(FLIP_ARC / SAMPLE));
        int[] direction = new int[m];
        for (int i = 2; i < m; i++) {
            double sum = 0;
            for (int j = Math.max(2, i - reach); j <= Math.min(m - 1, i + reach); j++) sum += turns[j];
            direction[i] = Math.abs(sum) > 1e-12 ? (int) Math.signum(sum) : 0;
        }
        double[] weight = new double[m];
        for (int i = 2; i < m; i++) {
            if (direction[i] == 0) continue;
            double degrees = Math.abs(turns[i]) * 180 / Math.PI;
            if (!(degrees > 0)) continue;
            double radius = SAMPLE / (degrees * Math.PI / 180);
            if (busy && !(radius < BUSY_RADIUS)) continue;
            weight[i] = radiusWeight(radius);
        }

        double bend = 0, tight = 0, arc = 0, arcIn = 0, arcWeightedIn = 0;
        int lobe = 0;
        for (int i = 1; i < m; i++) {
            double meters = ch[i] - ch[i - 1];
            boolean flush = !(weight[i] > 0) || (lobe != 0 && direction[i] != lobe);
            if (flush) {
                if (arc >= MIN_ARC) { bend += arcWeightedIn; tight += arcIn; }
                arc = 0; arcIn = 0; arcWeightedIn = 0; lobe = 0;
                if (!(weight[i] > 0)) continue;
            }
            if (arc == 0) lobe = direction[i];
            double inside = Math.max(0, Math.min(ch[i], creditTo) - Math.max(ch[i - 1], creditFrom));
            arc += meters;
            arcIn += inside;
            arcWeightedIn += inside * weight[i];
        }
        if (arc >= MIN_ARC) { bend += arcWeightedIn; tight += arcIn; }
        return new Result(Math.min(total, bend), Math.min(total, tight), total);
    }
}
