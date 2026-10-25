package rodeo.opengravel.graphhopper;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.graphhopper.GHRequest;
import com.graphhopper.GraphHopper;
import com.graphhopper.GraphHopperConfig;
import com.graphhopper.jackson.Jackson;
import java.nio.file.Path;

/** Stock-loader persistence and flexible/LM/CH weight equivalence on the tiny imported graph. */
public final class IntegrationTest {
    public static void main(String[] args) throws Exception {
        ObjectMapper yaml=new ObjectMapper(new YAMLFactory());Jackson.initObjectMapper(yaml);
        GraphHopperConfig config=yaml.treeToValue(yaml.readTree(Path.of(args[0]).toFile()).required("graphhopper"),GraphHopperConfig.class);
        GraphHopper hopper=new GraphHopper(); // intentionally no custom ImportRegistry on load
        try {
            hopper.init(config).setAllowWrites(false);
            if(!hopper.load()) throw new AssertionError("Fixture graph missing");
            if(!hopper.getEncodingManager().hasEncodedValue("og_curve")) throw new AssertionError("EV did not persist");
            double reference=route(hopper,true,true);
            for(boolean chDisabled:new boolean[]{true,false}) {
                double weight=route(hopper,chDisabled,false);
                if(Math.abs(weight-reference)>1e-4) throw new AssertionError("Prepared weighting differs from flexible: "+weight+" vs "+reference);
            }
            System.out.println("PASS: stock GH loader persisted og_curve; flexible, LM and CH weights agree: "+reference);
        } finally {hopper.close();}
    }
    private static double route(GraphHopper hopper,boolean chDisabled,boolean lmDisabled) {
        GHRequest request=new GHRequest(40.8,-75.6990507,40.8299578,-75.7009477).setProfile("motorcycle_twisty");
        request.putHint("ch.disable",chDisabled);request.putHint("lm.disable",lmDisabled);
        var result=hopper.route(request);
        if(result.hasErrors()) throw new AssertionError(result.getErrors().toString());
        return result.getBest().getRouteWeight();
    }
}
