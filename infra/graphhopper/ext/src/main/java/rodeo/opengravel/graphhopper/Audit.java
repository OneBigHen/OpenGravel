package rodeo.opengravel.graphhopper;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.graphhopper.GraphHopper;
import com.graphhopper.GraphHopperConfig;
import com.graphhopper.jackson.Jackson;
import com.graphhopper.routing.ev.RoadClass;
import java.nio.file.Path;
import java.util.Arrays;

/** Read-only histogram/guard audit on an already imported graph. Never imports a missing graph. */
public final class Audit {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Usage: Audit config.yml");
        ObjectMapper yaml = new ObjectMapper(new YAMLFactory());
        Jackson.initObjectMapper(yaml);
        GraphHopperConfig config = yaml.treeToValue(yaml.readTree(Path.of(args[0]).toFile()).required("graphhopper"), GraphHopperConfig.class);
        GraphHopper hopper = new GraphHopper();
        try {
            hopper.init(config).setAllowWrites(false);
            if (!hopper.load()) throw new IllegalStateException("Audit requires an imported graph");
            var curve = hopper.getEncodingManager().getDecimalEncodedValue(OgCurveParser.KEY);
            var road = hopper.getEncodingManager().getEnumEncodedValue(RoadClass.KEY, RoadClass.class);
            var edges = hopper.getBaseGraph().getAllEdges();
            long[] bins = new long[16];
            double[] meters = new double[16];
            long streets = 0, badStreets = 0;
            while (edges.next()) {
                double value = edges.get(curve);
                if (!Double.isFinite(value) || value < 0 || value > 1) throw new AssertionError("Unbounded curve");
                int bin = (int) Math.round(value * 15);
                bins[bin]++;
                meters[bin] += edges.getDistance();
                RoadClass type = edges.get(road);
                if (type == RoadClass.RESIDENTIAL || type == RoadClass.SERVICE || type == RoadClass.LIVING_STREET) {
                    streets++;
                    if (value != 0) {
                        if (badStreets++ < 10) System.out.println("BAD_STREET " + edges.getEdge() + " " + type + " " + value + " " + edges.getName() + " " + edges.fetchWayGeometry(com.graphhopper.util.FetchMode.ALL).get(0));
                    }
                }
            }
            System.out.println("CURVE_EDGE_BINS " + Arrays.toString(bins));
            System.out.println("CURVE_METRE_BINS " + Arrays.toString(meters));
            if (badStreets > 0) throw new AssertionError(badStreets + " street edges earned curve credit");
            System.out.println("PASS: " + streets + " residential/service/living_street edges have zero curve credit");
        } finally { hopper.close(); }
    }
}
