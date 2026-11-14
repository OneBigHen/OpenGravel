package com.opengravel.gh;

import com.graphhopper.routing.ev.DefaultImportRegistry;
import com.graphhopper.routing.ev.ImportUnit;

/**
 * The engine's own values plus OpenGravel's three. The three have no tag parser: they are
 * computed from the whole graph after the import (OgGraphHopper.postImportOSM).
 */
public class OgImportRegistry extends DefaultImportRegistry {
    @Override
    public ImportUnit createImportUnit(String name) {
        if (OgCurveField.KEY.equals(name))
            return ImportUnit.create(name, props -> OgCurveField.create(), null,
                    "road_class", "road_class_link", "roundabout");
        if (OgThroughPass.KEY.equals(name) || OgThroughPass.STREET_KEY.equals(name))
            return ImportUnit.create(name, props -> OgThroughPass.create(name), null,
                    "car_access", "road_access", "road_class");
        return super.createImportUnit(name);
    }
}
