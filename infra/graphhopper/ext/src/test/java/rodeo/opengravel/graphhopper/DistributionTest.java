package rodeo.opengravel.graphhopper;

import com.graphhopper.routing.ev.RoadAccess;
import com.graphhopper.routing.ev.RoadClass;
import com.graphhopper.routing.ev.Surface;

/** Weighted ranks count meters, retain ties, and distinguish absent from zero signal. */
public final class DistributionTest {
    public static void main(String[] args) {
        double[] bins = new double[16];
        bins[0] = 89; bins[1] = 2; bins[6] = 6; bins[15] = 3;
        assert Distribution.quantile(bins, .5, false) == 0;
        assert Distribution.quantile(bins, .75, false) == 0;
        assert Distribution.quantile(bins, .9, false) == 1d / 15;
        assert Distribution.quantile(bins, .97, false) == .4;
        assert Distribution.quantile(bins, .5, true) == .4;
        assert Distribution.quantile(bins, .9, true) == 1;
        assert Distribution.quantile(new double[16], .5, false) == null;
        bins = new double[16]; bins[0] = 100;
        assert Distribution.quantile(bins, .5, false) == 0;
        assert Distribution.quantile(bins, .5, true) == null;
        assert Distribution.eligible(false,true,10,RoadClass.TERTIARY,RoadAccess.YES);
        assert Distribution.eligible(true,false,10,RoadClass.MOTORWAY,RoadAccess.DESTINATION);
        assert !Distribution.eligible(false,false,10,RoadClass.TERTIARY,RoadAccess.YES);
        for(double meters:new double[]{0,-1,Double.NaN})
            assert !Distribution.eligible(true,true,meters,RoadClass.TERTIARY,RoadAccess.YES);
        for(RoadClass road:new RoadClass[]{RoadClass.OTHER,RoadClass.RESIDENTIAL,RoadClass.SERVICE,RoadClass.LIVING_STREET})
            assert !Distribution.eligible(true,true,10,road,RoadAccess.YES);
        for(RoadAccess access:new RoadAccess[]{RoadAccess.PRIVATE,RoadAccess.NO})
            assert !Distribution.eligible(true,true,10,RoadClass.TERTIARY,access);
        for(Surface surface:Surface.values()) {
            boolean allowed=surface==Surface.MISSING||surface==Surface.PAVED||surface==Surface.ASPHALT
                    ||surface==Surface.CONCRETE||surface==Surface.PAVING_STONES||surface==Surface.COBBLESTONE;
            assert Distribution.adventureBackroad(RoadClass.TERTIARY,surface)==allowed;
            assert !Distribution.adventureBackroad(RoadClass.RESIDENTIAL,surface);
            assert !Distribution.adventureBackroad(RoadClass.SERVICE,surface);
            assert !Distribution.adventureBackroad(RoadClass.MOTORWAY,surface);
        }
        System.out.println("PASS: length-weighted percentile ranks, ties, positive-only, empty populations, access/class/length filters and surface guards");
    }
}
