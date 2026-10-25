package rodeo.opengravel.graphhopper;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.graphhopper.GraphHopper;
import com.graphhopper.GraphHopperConfig;
import com.graphhopper.jackson.Jackson;
import com.graphhopper.routing.ev.RoadClass;
import com.graphhopper.routing.ev.RoadAccess;
import com.graphhopper.routing.ev.Surface;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Read-only, length-weighted calibration over physical edges (one count per edge, not direction). */
public final class Distribution {
    public static void main(String[] args) throws Exception {
        if(args.length!=2) throw new IllegalArgumentException("Usage: Distribution config.yml output.json");
        ObjectMapper yaml=new ObjectMapper(new YAMLFactory());Jackson.initObjectMapper(yaml);
        GraphHopperConfig config=yaml.treeToValue(yaml.readTree(Path.of(args[0]).toFile()).required("graphhopper"),GraphHopperConfig.class);
        GraphHopper hopper=new GraphHopper();
        try {
            hopper.init(config).setAllowWrites(false);
            if(!hopper.load()) throw new IllegalStateException("Distribution requires an imported graph");
            var em=hopper.getEncodingManager();
            var curve=em.getDecimalEncodedValue(OgCurveParser.KEY);
            var road=em.getEnumEncodedValue(RoadClass.KEY,RoadClass.class);
            var surface=em.getEnumEncodedValue(Surface.KEY,Surface.class);
            var access=em.getBooleanEncodedValue("car_access");
            var roadAccess=em.getEnumEncodedValue(RoadAccess.KEY,RoadAccess.class);
            double[] all=new double[16],pavedBackroad=new double[16],eligibleBackroad=new double[16];
            long count=0,pavedCount=0,eligibleCount=0;
            var edge=hopper.getBaseGraph().getAllEdges();
            while(edge.next()) {
                RoadClass type=edge.get(road);
                RoadAccess restriction=edge.get(roadAccess);
                if(!eligible(edge.get(access),edge.getReverse(access),edge.getDistance(),type,restriction)) continue;
                double value=edge.get(curve);
                if(!Double.isFinite(value)||value<0||value>1) throw new AssertionError("Invalid curve");
                int bin=(int)Math.round(value*15);
                all[bin]+=edge.getDistance();count++;
                Surface material=edge.get(surface);
                if(backroad(type) && (material==Surface.PAVED||material==Surface.ASPHALT||material==Surface.CONCRETE)) {
                    pavedBackroad[bin]+=edge.getDistance();pavedCount++;
                }
                if(adventureBackroad(type,material)) {
                    eligibleBackroad[bin]+=edge.getDistance();eligibleCount++;
                }
            }
            Map<String,Object> report=new LinkedHashMap<>();
            report.put("schema",1);report.put("graph",hopper.getGraphHopperLocation());
            Map<String,Object> provenance=new LinkedHashMap<>();
            provenance.put("configSha256",sha256(Path.of(args[0])));
            provenance.put("graphPropertiesSha256",sha256(Path.of(hopper.getGraphHopperLocation(),"properties")));
            Path manifest=Path.of(config.getString("datareader.file","")+".json");
            provenance.put("preparedPbfManifest",new ObjectMapper().readTree(manifest.toFile()));
            report.put("provenance",provenance);
            report.put("population","car-accessible non-residential physical road edges, excluding OTHER/RESIDENTIAL/SERVICE/LIVING_STREET and PRIVATE/NO; zero-length edges excluded; motorways included; not legal-clearance evidence");
            report.put("nonResidential",summary(all,count));report.put("knownPavedBackroads",summary(pavedBackroad,pavedCount));
            report.put("adventureEligibleBackroads",summary(eligibleBackroad,eligibleCount));
            new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(Path.of(args[1]).toFile(),report);
            System.out.println(new ObjectMapper().writeValueAsString(report));
        } finally {hopper.close();}
    }
    static boolean eligible(boolean forward,boolean reverse,double meters,RoadClass road,RoadAccess access) {
        return (forward||reverse) && meters>0 && road!=RoadClass.OTHER && road!=RoadClass.RESIDENTIAL
                && road!=RoadClass.SERVICE && road!=RoadClass.LIVING_STREET && access!=RoadAccess.PRIVATE && access!=RoadAccess.NO;
    }
    private static boolean backroad(RoadClass road) {
        return road==RoadClass.SECONDARY||road==RoadClass.TERTIARY||road==RoadClass.UNCLASSIFIED;
    }
    static boolean adventureBackroad(RoadClass road,Surface surface) {
        return backroad(road) && (surface==Surface.MISSING||surface==Surface.PAVED||surface==Surface.ASPHALT
                ||surface==Surface.CONCRETE||surface==Surface.PAVING_STONES||surface==Surface.COBBLESTONE);
    }
    private static String sha256(Path path) throws Exception {
        var digest=java.security.MessageDigest.getInstance("SHA-256");
        try(var input=java.nio.file.Files.newInputStream(path)) {
            byte[] buffer=new byte[1024*1024];int count;
            while((count=input.read(buffer))!=-1) digest.update(buffer,0,count);
        }
        return java.util.HexFormat.of().formatHex(digest.digest());
    }
    private static Map<String,Object> summary(double[] bins,long edges) {
        double length=java.util.Arrays.stream(bins).sum();
        Map<String,Object> out=new LinkedHashMap<>();
        out.put("edges",edges);out.put("meters",length);out.put("metersByQuantizedBin",bins);
        out.put("zeroShare",length>0?bins[0]/length:null);
        Map<String,Double> percentiles=new LinkedHashMap<>();
        Map<String,Double> positivePercentiles=new LinkedHashMap<>();
        for(int p:new int[]{40,50,75,80,90,97}) {
            percentiles.put("p"+p,quantile(bins,p/100d,false));
            positivePercentiles.put("p"+p,quantile(bins,p/100d,true));
        }
        out.put("percentiles",percentiles);out.put("positiveOnlyPercentiles",positivePercentiles);return out;
    }
    static Double quantile(double[] bins,double fraction,boolean positiveOnly) {
        int start=positiveOnly?1:0;
        double total=0;for(int i=start;i<bins.length;i++) total+=bins[i];
        if(total<=0) return null;
        double cumulative=0;for(int i=start;i<bins.length;i++) {cumulative+=bins[i];if(cumulative>=total*fraction) return i/15d;}
        return 1d;
    }
}
