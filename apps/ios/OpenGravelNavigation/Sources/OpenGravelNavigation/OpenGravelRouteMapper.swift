import FerrostarCoreFFI
import Foundation

/// Turns the one route OpenGravel selected into a Ferrostar `Route`
/// (NATIVE-NAVIGATION-FERROSTAR §10, phase 1).
///
/// The geometry is OpenGravel's, point for point: it is sliced into steps at
/// each maneuver and nothing is re-routed. A step runs from one maneuver to the
/// next, and its banner and spoken cues describe the maneuver at its end (the
/// OSRM convention Ferrostar's navigation UI reads). The payload carries no
/// lanes, exits or roundabouts yet, so none are invented.
public enum OpenGravelRouteMapper {
    /// Two maneuvers closer than this share one step boundary.
    static let minimumStepMeters = 1.0
    /// A longer step also gets an early "In half a mile…" cue.
    static let earlyCueMeters = 805.0
    /// The final "Turn left onto …" cue is spoken this far before the turn.
    static let finalCueMeters = 150.0

    public static func route(from payload: OpenGravelNavigationPayload) throws -> Route {
        try payload.validate()
        let geometry = payload.geometry.map { GeographicCoordinate(lat: $0.lat, lng: $0.lon) }
        let measured = cumulativeDistances(geometry)
        let total = measured.last ?? 0

        // Maneuver distances are the planner's; rescale them onto this polyline
        // so a small difference in distance formulas cannot push a turn off the end.
        let scale = payload.distanceMeters > 0 ? total / payload.distanceMeters : 1
        var boundaries: [(distance: Double, maneuver: OpenGravelNavigationManeuver?)] = [(0, nil)]
        for maneuver in payload.maneuvers where maneuver.kind != .arrive {
            let at = min(max(maneuver.atDistanceMeters * scale, 0), total)
            if at - (boundaries.last?.distance ?? 0) < minimumStepMeters {
                // A maneuver at the very start (or doubled up) names the first road.
                if boundaries.count == 1 { boundaries[0].maneuver = maneuver }
                continue
            }
            if total - at < minimumStepMeters { continue }
            boundaries.append((at, maneuver))
        }
        let arrival = payload.maneuvers.last(where: { $0.kind == .arrive })

        var steps: [RouteStep] = []
        for index in boundaries.indices {
            let start = boundaries[index].distance
            let end = index + 1 < boundaries.count ? boundaries[index + 1].distance : total
            let next = index + 1 < boundaries.count ? boundaries[index + 1].maneuver : arrival
            let length = end - start
            let cue = instruction(for: next, arriving: index + 1 == boundaries.count, title: payload.title)
            steps.append(RouteStep(
                geometry: slice(geometry, measured, from: start, to: end),
                distance: length,
                duration: total > 0 ? payload.durationSeconds * length / total : 0,
                roadName: boundaries[index].maneuver?.roadName,
                exits: [],
                instruction: cue.text,
                visualInstructions: [VisualInstruction(
                    primaryContent: VisualInstructionContent(
                        text: cue.banner,
                        maneuverType: cue.type,
                        maneuverModifier: cue.modifier,
                        roundaboutExitDegrees: nil,
                        laneInfo: nil,
                        exitNumbers: []
                    ),
                    secondaryContent: nil,
                    subContent: nil,
                    triggerDistanceBeforeManeuver: length
                )],
                spokenInstructions: spoken(cue.text, stepLength: length),
                annotations: nil,
                incidents: [],
                drivingSide: .right,
                roundaboutExitNumber: nil
            ))
        }
        // The arrival step: zero length at the destination, as routers emit it.
        let last = geometry[geometry.count - 1]
        steps.append(RouteStep(
            geometry: [last, last],
            distance: 0,
            duration: 0,
            roadName: arrival?.roadName,
            exits: [],
            instruction: "You have arrived",
            visualInstructions: [VisualInstruction(
                primaryContent: VisualInstructionContent(
                    text: payload.title.isEmpty ? "You have arrived" : payload.title,
                    maneuverType: .arrive,
                    maneuverModifier: nil,
                    roundaboutExitDegrees: nil,
                    laneInfo: nil,
                    exitNumbers: []
                ),
                secondaryContent: nil,
                subContent: nil,
                triggerDistanceBeforeManeuver: 0
            )],
            spokenInstructions: [],
            annotations: nil,
            incidents: [],
            drivingSide: .right,
            roundaboutExitNumber: nil
        ))

        return Route(
            geometry: geometry,
            bbox: boundingBox(geometry),
            distance: total,
            waypoints: [
                Waypoint(coordinate: geometry[0], kind: .break),
                Waypoint(coordinate: last, kind: .break),
            ],
            steps: steps
        )
    }

    // MARK: - Instructions

    struct Cue {
        let text: String
        let banner: String
        let type: ManeuverType
        let modifier: ManeuverModifier?
    }

    static func instruction(
        for maneuver: OpenGravelNavigationManeuver?,
        arriving: Bool,
        title: String
    ) -> Cue {
        if arriving || maneuver == nil || maneuver?.kind == .arrive {
            return Cue(text: "Arrive at your destination", banner: title.isEmpty ? "Arrive" : title, type: .arrive, modifier: nil)
        }
        let maneuver = maneuver!
        let road = maneuver.roadName.flatMap { $0.isEmpty ? nil : $0 }
        switch maneuver.kind {
        case .continue:
            let text = road.map { "Continue onto \($0)" } ?? "Continue straight"
            return Cue(text: text, banner: road ?? "Continue", type: .continue, modifier: .straight)
        case .turn, .arrive:
            let (verb, modifier) = turnWords(maneuver.maneuver)
            let text = road.map { "\(verb) onto \($0)" } ?? verb
            return Cue(text: text, banner: road ?? verb, type: .turn, modifier: modifier)
        }
    }

    static func turnWords(_ turn: OpenGravelNavigationTurn?) -> (String, ManeuverModifier?) {
        switch turn {
        case .left: return ("Turn left", .left)
        case .right: return ("Turn right", .right)
        case .slightLeft: return ("Bear left", .slightLeft)
        case .slightRight: return ("Bear right", .slightRight)
        case .straight: return ("Continue straight", .straight)
        case .uturn: return ("Make a U-turn", .uTurn)
        case .none: return ("Continue", nil)
        }
    }

    static func spoken(_ text: String, stepLength: Double) -> [SpokenInstruction] {
        var cues: [SpokenInstruction] = []
        if stepLength >= earlyCueMeters + 400 {
            cues.append(SpokenInstruction(
                text: "In half a mile, \(lowercasedFirst(text))",
                ssml: nil,
                triggerDistanceBeforeManeuver: earlyCueMeters,
                utteranceId: UUID()
            ))
        }
        cues.append(SpokenInstruction(
            text: text,
            ssml: nil,
            triggerDistanceBeforeManeuver: min(finalCueMeters, stepLength),
            utteranceId: UUID()
        ))
        return cues
    }

    static func lowercasedFirst(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.lowercased() + text.dropFirst()
    }

    // MARK: - Geometry

    static func cumulativeDistances(_ line: [GeographicCoordinate]) -> [Double] {
        var result: [Double] = [0]
        result.reserveCapacity(line.count)
        for index in 1 ..< line.count {
            result.append(result[index - 1] + haversine(line[index - 1], line[index]))
        }
        return result
    }

    /// The part of the line between two distances along it, endpoints interpolated.
    static func slice(
        _ line: [GeographicCoordinate],
        _ measured: [Double],
        from start: Double,
        to end: Double
    ) -> [GeographicCoordinate] {
        var result = [point(line, measured, at: start)]
        for index in line.indices where measured[index] > start && measured[index] < end {
            result.append(line[index])
        }
        result.append(point(line, measured, at: end))
        return result
    }

    static func point(_ line: [GeographicCoordinate], _ measured: [Double], at distance: Double) -> GeographicCoordinate {
        guard distance > 0 else { return line[0] }
        guard let upper = measured.firstIndex(where: { $0 >= distance }) else { return line[line.count - 1] }
        if upper == 0 { return line[0] }
        let lower = upper - 1
        let span = measured[upper] - measured[lower]
        let t = span > 0 ? (distance - measured[lower]) / span : 0
        return GeographicCoordinate(
            lat: line[lower].lat + (line[upper].lat - line[lower].lat) * t,
            lng: line[lower].lng + (line[upper].lng - line[lower].lng) * t
        )
    }

    static func haversine(_ a: GeographicCoordinate, _ b: GeographicCoordinate) -> Double {
        let radius = 6_371_008.8
        let dLat = (b.lat - a.lat) * .pi / 180
        let dLon = (b.lng - a.lng) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) +
            cos(a.lat * .pi / 180) * cos(b.lat * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * radius * asin(min(1, sqrt(h)))
    }

    static func boundingBox(_ line: [GeographicCoordinate]) -> BoundingBox {
        let lats = line.map(\.lat)
        let lngs = line.map(\.lng)
        return BoundingBox(
            sw: GeographicCoordinate(lat: lats.min() ?? 0, lng: lngs.min() ?? 0),
            ne: GeographicCoordinate(lat: lats.max() ?? 0, lng: lngs.max() ?? 0)
        )
    }
}
