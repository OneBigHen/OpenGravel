package rodeo.opengravel.graphhopper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.graphhopper.GraphHopper;
import com.graphhopper.GraphHopperConfig;
import com.graphhopper.jackson.Jackson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Import-only extension. The stock GH server loads the serialized decimal EV without a core patch. */
public final class Import {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Usage: Import config.yml (new graph directory required)");
        ObjectMapper yaml = new ObjectMapper(new YAMLFactory());
        Jackson.initObjectMapper(yaml);
        JsonNode root = yaml.readTree(Path.of(args[0]).toFile());
        GraphHopperConfig config = yaml.treeToValue(root.required("graphhopper"), GraphHopperConfig.class);
        Path graph = Path.of(config.getString("graph.location", ""));
        // Fail closed on all existing directories: never load/rebuild a control or live graph accidentally.
        if (config.getString("graph.location", "").isBlank() || Files.exists(graph))
            throw new IllegalArgumentException("graph.location must be a NEW directory: " + graph);
        Path source=Path.of(config.getString("datareader.file",""));
        JsonNode manifest=new ObjectMapper().readTree(Path.of(source+".json").toFile());
        if (!manifest.path("version").asText().equals("og-curve-heading-v3"))
            throw new IllegalArgumentException("Missing/unsupported completed curvature pre-pass manifest");
        JsonNode signal=manifest.required("signal");
        String[] fields={"windowMeters","sampleMeters","degreesPerKmAtFullCredit","maxTurnDegreesPerSample","noiseWindowMeters","shortEdgeMeters","fullEdgeCreditMeters"};
        int[] expected={1000,20,360,30,200,60,600};
        for(int i=0;i<fields.length;i++)
            if(signal.required(fields[i]).asDouble()!=expected[i]) throw new IllegalArgumentException("Unexpected heading signal parameter: "+fields[i]);
        if(signal.required("minDirectionalCoherence").asDouble()!=.5
                || Math.abs(signal.required("shortEdgeMaxCredit").asDouble()-1d/15)>1e-12
                || !manifest.required("algorithmSha256").asText().equals("a7f78312f683007b6adf762a4c92328356d588c5a2505dc1b7074b2bb7fd641c"))
            throw new IllegalArgumentException("Invalid heading provenance/cap");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try (var input=Files.newInputStream(source)) {
            byte[] buffer=new byte[1024*1024];
            int count;
            while((count=input.read(buffer))!=-1) digest.update(buffer,0,count);
        }
        if (!HexFormat.of().formatHex(digest.digest()).equals(manifest.required("outputSha256").asText()))
            throw new IllegalArgumentException("Prepared PBF does not match its completed manifest");
        GraphHopper hopper = new GraphHopper();
        try {
            hopper.setImportRegistry(OgCurveParser.registry());
            hopper.init(config);
            hopper.importAndClose();
        } finally { hopper.close(); }
    }
}
