import FerrostarCoreFFI
import Foundation

/// Ferrostar advances steps one at a time and measures deviation against the
/// current step only. A ride resumed (or started) partway along its route
/// therefore opens on step 0: the turn card shows the first maneuver, the
/// distance left is the whole ride, and the rider is "off route" because they
/// are nowhere near step 0. This finds the step the rider is actually on so
/// the coordinator can advance to it instead of rerouting back to the start.
enum OpenGravelStepCatchUp {
    /// Fixes worse than this can't place the rider on one step of many.
    static let maximumAccuracyMeters = 50.0

    /// How many steps to advance so the current step is the one under the
    /// rider, or 0 when the current step already fits (Ferrostar's own step
    /// advance handles that), when the fix is too poor, or when no step ahead
    /// fits either (a real deviation: OpenGravel's reroute decides).
    static func stepsToAdvance(
        location: GeographicCoordinate,
        horizontalAccuracy: Double,
        remainingSteps: [[GeographicCoordinate]],
        maxAcceptableDeviation: Double = 50
    ) -> Int {
        guard horizontalAccuracy >= 0, horizontalAccuracy <= maximumAccuracyMeters else { return 0 }
        let tolerance = max(25, min(maxAcceptableDeviation, horizontalAccuracy * 1.5))
        guard let current = remainingSteps.first else { return 0 }
        if distance(from: location, to: current) <= tolerance { return 0 }
        // The first fitting step ahead: a road ridden twice (an out-and-back,
        // a loop's shared stem) resolves to the earlier pass, never skipping
        // the ride's middle.
        for index in remainingSteps.indices.dropFirst()
            where distance(from: location, to: remainingSteps[index]) <= tolerance {
            return index
        }
        return 0
    }

    /// Metres from a point to a polyline (equirectangular, fine at step scale).
    static func distance(from point: GeographicCoordinate, to line: [GeographicCoordinate]) -> Double {
        guard let first = line.first else { return .infinity }
        if line.count == 1 { return OpenGravelRouteMapper.haversine(point, first) }
        let metersPerDegreeLat = 111_132.0
        let metersPerDegreeLng = 111_320.0 * cos(point.lat * .pi / 180)
        func xy(_ c: GeographicCoordinate) -> (Double, Double) {
            ((c.lng - point.lng) * metersPerDegreeLng, (c.lat - point.lat) * metersPerDegreeLat)
        }
        var best = Double.infinity
        for index in 1 ..< line.count {
            let (ax, ay) = xy(line[index - 1])
            let (bx, by) = xy(line[index])
            let dx = bx - ax
            let dy = by - ay
            let lengthSquared = dx * dx + dy * dy
            let t = lengthSquared > 0 ? max(0, min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0
            let px = ax + t * dx
            let py = ay + t * dy
            best = min(best, (px * px + py * py).squareRoot())
        }
        return best
    }
}
