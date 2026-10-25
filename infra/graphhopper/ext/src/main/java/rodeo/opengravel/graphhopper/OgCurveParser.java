package rodeo.opengravel.graphhopper;

import com.graphhopper.reader.ReaderWay;
import com.graphhopper.routing.ev.DecimalEncodedValue;
import com.graphhopper.routing.ev.DecimalEncodedValueImpl;
import com.graphhopper.routing.ev.DefaultImportRegistry;
import com.graphhopper.routing.ev.EdgeIntAccess;
import com.graphhopper.routing.ev.ImportRegistry;
import com.graphhopper.routing.ev.ImportUnit;
import com.graphhopper.routing.util.parsers.TagParser;
import com.graphhopper.storage.IntsRef;
import com.graphhopper.util.DistanceCalcEarth;
import com.graphhopper.util.PointList;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.InflaterInputStream;

/** Extracts local edge integrals from the pre-pass's og:curve tag, never a way-wide score. */
public final class OgCurveParser implements TagParser {
    public static final String KEY = "og_curve";
    private static final String CACHE = "_og_curve_index";
    private final DecimalEncodedValue encoded;

    public OgCurveParser(DecimalEncodedValue encoded) { this.encoded = encoded; }
    public static DecimalEncodedValue create() { return new DecimalEncodedValueImpl(KEY, 4, 1d / 15, false); }

    public static ImportRegistry registry() {
        DefaultImportRegistry defaults = new DefaultImportRegistry();
        return name -> KEY.equals(name)
                ? ImportUnit.create(KEY, props -> create(), (lookup, props) -> new OgCurveParser(lookup.getDecimalEncodedValue(KEY)))
                : defaults.createImportUnit(name);
    }

    @Override
    public void handleWayTags(int edgeId, EdgeIntAccess access, ReaderWay way, IntsRef relationFlags) {
        String highway = way.getTag("highway", "");
        if (highway.endsWith("_link")) highway = highway.substring(0, highway.length()-5);
        // Normalize like OSMRoadClassParser, including rare residential_link/service_link ways.
        boolean street = List.of("residential", "service", "living_street").contains(highway);
        PointList points = way.getTag("point_list", null);
        double score = 0;
        if (!street && !highway.isEmpty() && points != null && points.size() >= 2) {
            CurveIndex index = way.getTag(CACHE, null);
            if (index == null) {
                String header = way.getTag("og:curve", "");
                if (!header.startsWith("v1z:")) throw new IllegalArgumentException("Missing og:curve pre-pass on OSM way " + way.getId());
                int chunks = Integer.parseInt(header.substring(4));
                if (chunks < 1 || chunks > 4096) throw new IllegalArgumentException("Invalid og:curve chunk count");
                StringBuilder tag = new StringBuilder("v1z:");
                for (int i=0; i<chunks; i++) {
                    String chunk = way.getTag("og:curve:"+i, "");
                    if (chunk.isEmpty() || chunk.length()>240) throw new IllegalArgumentException("Missing/invalid og:curve chunk");
                    tag.append(chunk);
                }
                index = CurveIndex.parse(tag.toString(), way.getId());
                way.setTag(CACHE, index);
            }
            Double edgeDistance = way.getTag("edge_distance", null);
            if (edgeDistance == null) edgeDistance = DistanceCalcEarth.DIST_EARTH.calcDistance(points);
            score = index.score(points, edgeDistance);
        }
        encoded.setDecimal(false, edgeId, access, score);
    }

    private record Integral(long distanceMm, long areaMm) {}
    private record CurveIndex(Map<Long, List<Integral>> byCoordinate) {
        static CurveIndex parse(String tag, long wayId) {
            if (!tag.startsWith("v1z:")) throw new IllegalArgumentException("Missing/unsupported og:curve pre-pass on OSM way " + wayId);
            try {
                byte[] compressed = Base64.getDecoder().decode(tag.substring(4));
                String text;
                try (var in = new InflaterInputStream(new ByteArrayInputStream(compressed))) {
                    // Bound malformed input, well above the OSM maximum of 2,000 nodes per way.
                    byte[] raw = in.readNBytes(1_000_001);
                    if (raw.length > 1_000_000) throw new IllegalArgumentException("og:curve tag too large");
                    text = new String(raw, StandardCharsets.UTF_8);
                }
                String[] rows = text.split(";");
                if (!rows[0].equals("v1") || rows.length < 3) throw new IllegalArgumentException("Invalid og:curve format");
                Map<Long,List<Integral>> map = new HashMap<>();
                long previousDistance = -1, previousArea = -1;
                for (int i=1; i<rows.length; i++) {
                    String[] fields = rows[i].split(":");
                    if (fields.length != 4) throw new IllegalArgumentException("Invalid og:curve row");
                    int lat = Integer.parseInt(fields[0]), lon = Integer.parseInt(fields[1]);
                    long distance = Long.parseLong(fields[2]), area = Long.parseLong(fields[3]);
                    if (Math.abs((long)lat)>900_000_000L || Math.abs((long)lon)>1_800_000_000L
                            || distance<0 || area<0 || (i==1 && (distance!=0 || area!=0))
                            || distance < previousDistance || area < previousArea || area > distance
                            || (previousDistance >= 0 && area-previousArea > distance-previousDistance+1))
                        throw new IllegalArgumentException("Invalid og:curve integral");
                    map.computeIfAbsent(key(lat,lon), ignored -> new ArrayList<>()).add(new Integral(distance,area));
                    previousDistance = distance; previousArea = area;
                }
                return new CurveIndex(map);
            } catch (Exception error) {
                throw new IllegalArgumentException("Malformed og:curve on OSM way " + wayId, error);
            }
        }

        double score(PointList points, double edgeDistance) {
            if (edgeDistance < .01) return 0; // barrier clones / artificial zero-distance edges
            List<Integral> starts = byCoordinate.get(key(points,0));
            List<Integral> ends = byCoordinate.get(key(points,points.size()-1));
            if (starts == null || ends == null) throw new IllegalArgumentException("GH edge endpoint missing from og:curve pre-pass");
            double bestError = Double.POSITIVE_INFINITY, result = 0, selectedLength = 0;
            boolean ambiguous=false;
            // Unique endpoint coordinates identify the edge independently of GH's interior simplification.
            if (starts.size()==1 && ends.size()==1) {
                double length=Math.abs(ends.get(0).distanceMm-starts.get(0).distanceMm);
                return length>0 ? bounded(Math.abs(ends.get(0).areaMm-starts.get(0).areaMm)/length,length/1000) : 0;
            }
            for (Integral start : starts) for (Integral end : ends) {
                double lengthMm = Math.abs(end.distanceMm-start.distanceMm);
                double error = Math.abs(lengthMm/1000-edgeDistance);
                if (lengthMm<=0) continue;
                double ratio=Math.abs(end.areaMm-start.areaMm)/lengthMm;
                if (error < bestError-0.001) {
                    bestError = error;
                    result = ratio;
                    selectedLength = lengthMm / 1000;
                    ambiguous=false;
                } else if (Math.abs(error-bestError)<=0.001 && Math.abs(ratio-result)>1e-6) {
                    ambiguous=true;
                }
            }
            // Repeated coordinates are disambiguated by the edge's real length, not first occurrence.
            if (ambiguous || bestError > Math.max(5,edgeDistance*.05)) return 0; // do not invent credit for an unresolved occurrence
            return bounded(result,selectedLength);
        }
        private static double bounded(double score,double originalLength) {
            // Use pre-simplification length: GH geometry simplification must not change credit.
            double cap=Math.min(1,1d/15+Math.max(0,originalLength-60)*(14d/15)/540);
            return Math.max(0,Math.min(cap,score));
        }
        private static long key(PointList points,int i) { return key((int)Math.round(points.getLat(i)*1e7),(int)Math.round(points.getLon(i)*1e7)); }
        private static long key(int lat,int lon) { return ((long)lat << 32) ^ (lon & 0xffffffffL); }
    }
}
