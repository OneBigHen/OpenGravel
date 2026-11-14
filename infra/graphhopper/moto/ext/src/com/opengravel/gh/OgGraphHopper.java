package com.opengravel.gh;

import com.graphhopper.GraphHopper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * GraphHopper with OpenGravel's import registry. After the engine's own post-import work (town
 * density, speed limits, edge sort) it computes og_curve and the through flags, each only when
 * that value is listed in graph.encoded_values. Landmarks are prepared later, as before.
 */
public class OgGraphHopper extends GraphHopper {
    private static final Logger logger = LoggerFactory.getLogger(OgGraphHopper.class);

    public OgGraphHopper() {
        setImportRegistry(new OgImportRegistry());
    }

    @Override
    protected void postImportOSM() {
        super.postImportOSM();
        if (getEncodingManager().hasEncodedValue(OgCurveField.KEY)) {
            logger.info("og: computing og_curve, memory: {}", mem());
            OgCurveField.compute(getBaseGraph(), getEncodingManager());
        }
        if (getEncodingManager().hasEncodedValue(OgThroughPass.KEY) || getEncodingManager().hasEncodedValue(OgThroughPass.STREET_KEY)) {
            logger.info("og: computing og_through, memory: {}", mem());
            OgThroughPass.compute(getBaseGraph(), getEncodingManager());
        }
        logger.info("og: passes done, memory: {}", mem());
    }

    static String mem() {
        Runtime r = Runtime.getRuntime();
        return String.format("used %d MB, max %d MB", (r.totalMemory() - r.freeMemory()) >> 20, r.maxMemory() >> 20);
    }
}
