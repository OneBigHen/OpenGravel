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
        if (!manifest.path("version").asText().equals("og-curve-window-v1"))
            throw new IllegalArgumentException("Missing/unsupported completed curvature pre-pass manifest");
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
