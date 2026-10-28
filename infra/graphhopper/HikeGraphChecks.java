/** Integration checks against the actual GH11 import, custom model and snap overlay. */
import com.graphhopper.*;
import com.graphhopper.config.Profile;
import com.graphhopper.jackson.Jackson;
import com.graphhopper.util.CustomModel;
import java.io.File;
import java.util.List;

public class HikeGraphChecks {
    public static void main(String[] args) throws Exception {
        GraphHopper hopper = new GraphHopper();
        hopper.setOSMFile(args[0]);
        hopper.setGraphHopperLocation(args[1]);
        hopper.setMinNetworkSize(0);
        hopper.setEncodedValuesString("foot_access,foot_priority,foot_average_speed,foot_road_access,hike_rating,foot_network,road_class,road_environment");
        hopper.setProfiles(new Profile("hike").setCustomModel(Jackson.newObjectMapper().readValue(new File(args[2]), CustomModel.class)));
        hopper.importOrLoad();
        boolean[] expected = {true, true, false, false, false, true, false, false, false, false, false, false};
        for (int i = 0; i < expected.length; i++) {
            double lat = 40 + i * 0.02;
            GHResponse response = hopper.route(new GHRequest(lat, -75, lat, -74.98).setProfile("hike"));
            if (response.hasErrors() == expected[i])
                throw new AssertionError("corridor " + i + ": expected routable=" + expected[i] + ", errors=" + response.getErrors());
        }
        // The road is closer, but the trail is within 300 m. Keep both snaps on path.
        GHResponse nearRoad = hopper.route(new GHRequest(40.001, -74.998, 40.001, -74.982).setProfile("hike").setPathDetails(List.of("road_class")));
        if (nearRoad.hasErrors() || nearRoad.getBest().getPathDetails().get("road_class").stream().anyMatch(d -> !d.getValue().toString().equals("path")))
            throw new AssertionError("road substituted for nearby trail: " + nearRoad.getErrors());
        GHResponse inside = hopper.route(new GHRequest(40.0026, -75, 40.0026, -74.98).setProfile("hike"));
        if (inside.hasErrors()) throw new AssertionError("eligible trail inside 300 m rejected");
        GHResponse remote = hopper.route(new GHRequest(40.0032, -75, 40.0032, -74.98).setProfile("hike"));
        if (!remote.hasErrors()) throw new AssertionError("remote point silently snapped beyond 300 m");
        GHResponse network = hopper.route(new GHRequest(40.24, -75, 40.24, -74.98).setProfile("hike").setPathDetails(List.of("foot_network")));
        if (network.hasErrors() || network.getBest().getPathDetails().get("foot_network").stream().anyMatch(d -> d.getValue().toString().equalsIgnoreCase("missing")))
            throw new AssertionError("nested hiking relation did not beat shorter ordinary path");
        GHResponse trail = hopper.route(new GHRequest(40.26, -75, 40.26, -74.98).setProfile("hike").setPathDetails(List.of("road_class")));
        if (trail.hasErrors() || trail.getBest().getPathDetails().get("road_class").stream().anyMatch(d -> !d.getValue().toString().equals("path")))
            throw new AssertionError("short road beat longer trail");
        hopper.close();
        System.out.println("PASS: 12 access/barrier/SAC/road corridors, trail snapping/distance cap, nested network and trail preference");
    }
}
