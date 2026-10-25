package rodeo.opengravel.graphhopper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.graphhopper.reader.ReaderWay;
import com.graphhopper.routing.ev.ArrayEdgeIntAccess;
import com.graphhopper.routing.ev.DecimalEncodedValue;
import com.graphhopper.routing.util.EncodingManager;
import com.graphhopper.util.DistanceCalcEarth;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.zip.DeflaterOutputStream;
import com.graphhopper.util.PointList;
import java.nio.file.Path;

/** Runs against the exact GH runtime jar and the same geometry fixtures used by Python and the app. */
public final class CurveTest {
    public static void main(String[] args) throws Exception {
        JsonNode fixtures = new ObjectMapper().readTree(Path.of(args[0]).toFile());
        DecimalEncodedValue curve = OgCurveParser.create();
        EncodingManager em = EncodingManager.start().add(curve).build();
        ArrayEdgeIntAccess access = ArrayEdgeIntAccess.createFromBytes(em.getBytesForFlags());
        OgCurveParser parser = new OgCurveParser(curve);
        JsonNode mixed = null;
        for (JsonNode fixture : fixtures) {
            PointList points = line(fixture);
            ReaderWay way = new ReaderWay(123);
            way.setTag("highway", "secondary");
            setTag(way, fixture.required("curveTag").asText());
            way.setTag("point_list", points);
            parser.handleWayTags(0,access,way,null);
            double value=curve.getDecimal(false,0,access);
            double expected=Math.round(fixture.required("localScore").asDouble()*15)/15d;
            near(expected,value,1e-8,"Local window quantization: "+fixture.get("id").asText());
            near(value,curve.getDecimal(true,0,access),0,"Shared direction encoding");
            way.setTag("point_list",points.clone(true));
            parser.handleWayTags(1,access,way,null);
            near(value,curve.getDecimal(false,1,access),0,"Reversed edge geometry");
            if (fixture.get("id").asText().equals("mixed-road")) mixed=fixture;
        }
        if (mixed == null) throw new AssertionError("Missing mixed road fixture");
        PointList points=line(mixed);
        ReaderWay way=new ReaderWay(999);
        way.setTag("highway","secondary");
        setTag(way,mixed.required("curveTag").asText());
        PointList bent=new PointList();
        for(int i=0;i<=40;i++) bent.add(points.getLat(i),points.getLon(i));
        way.setTag("point_list",bent);
        parser.handleWayTags(2,access,way,null);
        if(curve.getDecimal(false,2,access)<=.15) throw new AssertionError("Bend edge should carry local signal");
        PointList straight=new PointList();
        straight.add(points.getLat(50),points.getLon(50));
        straight.add(points.getLat(points.size()-1),points.getLon(points.size()-1));
        way.setTag("point_list",straight);
        parser.handleWayTags(3,access,way,null);
        near(0,curve.getDecimal(false,3,access),0,"Straight miles of same OSM way remain dull");
        way.setTag("point_list",bent);
        for(String type:new String[]{"residential","residential_link","service","service_link","living_street"}) {
            way.setTag("highway",type);
            parser.handleWayTags(4,access,way,null);
            near(0,curve.getDecimal(false,4,access),0,"No street bend farming");
        }
        way.setTag("highway","secondary");
        way.removeTag("point_list");
        parser.handleWayTags(5,access,way,null);
        near(0,curve.getDecimal(false,5,access),0,"Missing geometry earns no signal");
        ReaderWay unprepared=new ReaderWay(1000);
        unprepared.setTag("highway","secondary");
        unprepared.setTag("point_list",bent);
        try { parser.handleWayTags(6,access,unprepared,null); throw new AssertionError("Missing pre-pass must fail closed"); }
        catch(IllegalArgumentException expected) { /* no silent whole-way/default fallback */ }
        ReaderWay repeated=new ReaderWay(1001);
        repeated.setTag("highway","secondary");
        PointList ab=new PointList();ab.add(40.8,-75.7);ab.add(40.8001,-75.7);
        repeated.setTag("point_list",ab);
        setTag(repeated,pack("v1;408000000:-757000000:0:0;408001000:-757000000:11119:11119;408000000:-757000000:22238:11119;408001000:-757000000:33357:11119"));
        parser.handleWayTags(7,access,repeated,null);
        near(0,curve.getDecimal(false,7,access),0,"Ambiguous equal-length occurrences earn no curve credit");
        ReaderWay malformed=new ReaderWay(1002);
        malformed.setTag("highway","secondary");malformed.setTag("point_list",ab);
        setTag(malformed,pack("v1;408000000:-757000000:0:-1;408001000:-757000000:11119:0"));
        try {parser.handleWayTags(8,access,malformed,null);throw new AssertionError("Negative integral accepted");}
        catch(IllegalArgumentException expected) { }
        // Unique endpoint identity is stable when GH simplifies the interior and shortens its length.
        ReaderWay simplified=new ReaderWay(1003);simplified.setTag("highway","secondary");
        simplified.setTag("point_list",bent);simplified.setTag("edge_distance",DistanceCalcEarth.DIST_EARTH.calcDistance(bent)*.75);
        setTag(simplified,mixed.required("curveTag").asText());
        parser.handleWayTags(9,access,simplified,null);
        near(curve.getDecimal(false,2,access),curve.getDecimal(false,9,access),0,"Interior simplification preserves the same endpoint integral");
        System.out.println("PASS: "+fixtures.size()+" pre-pass fixtures; quantization, reversal, per-edge locality, street/link guards, missing pre-pass rejection");
    }
    private static String pack(String text) throws Exception {
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        try(var zip=new DeflaterOutputStream(bytes)){zip.write(text.getBytes(StandardCharsets.UTF_8));}
        return "v1z:"+Base64.getEncoder().encodeToString(bytes.toByteArray());
    }
    private static void setTag(ReaderWay way,String tag) {
        String payload=tag.substring(4);
        int count=(payload.length()+239)/240;
        way.setTag("og:curve","v1z:"+count);
        for(int i=0;i<count;i++) way.setTag("og:curve:"+i,payload.substring(i*240,Math.min(payload.length(),(i+1)*240)));
    }
    private static PointList line(JsonNode fixture) {
        PointList points=new PointList();
        for(JsonNode p:fixture.required("line")) points.add(p.get("lat").asDouble(),p.get("lon").asDouble());
        return points;
    }
    private static void near(double expected,double actual,double tolerance,String reason) {
        if(!Double.isFinite(actual)||Math.abs(expected-actual)>tolerance)
            throw new AssertionError(reason+": expected "+expected+" got "+actual);
    }
}
