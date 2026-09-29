import FerrostarCoreFFI
import XCTest
@testable import OpenGravelNavigation

final class OpenGravelRouteMapperTests: XCTestCase {
    /// An L-shaped ride: ~1.1 km east, then ~1.1 km north, with the right turn at the corner.
    private func payload(
        maneuvers: [OpenGravelNavigationManeuver]? = nil,
        distance: Double? = nil
    ) -> OpenGravelNavigationPayload {
        let geometry = [
            OpenGravelNavigationCoordinate(lat: 40.0, lon: -75.0),
            OpenGravelNavigationCoordinate(lat: 40.0, lon: -74.9935),
            OpenGravelNavigationCoordinate(lat: 40.0, lon: -74.987),
            OpenGravelNavigationCoordinate(lat: 40.005, lon: -74.987),
            OpenGravelNavigationCoordinate(lat: 40.01, lon: -74.987),
        ]
        let corner = OpenGravelRouteMapper.cumulativeDistances(
            geometry.prefix(3).map { GeographicCoordinate(lat: $0.lat, lng: $0.lon) }
        ).last!
        let total = OpenGravelRouteMapper.cumulativeDistances(
            geometry.map { GeographicCoordinate(lat: $0.lat, lng: $0.lon) }
        ).last!
        return OpenGravelNavigationPayload(
            schema: OpenGravelNavigationPayload.supportedSchema,
            schemaVersion: OpenGravelNavigationPayload.supportedSchemaVersion,
            mode: OpenGravelNavigationPayload.supportedMode,
            routeId: "route_fixture",
            planningGeneration: 3,
            fingerprint: "fp_fixture",
            title: "Hawk Mountain",
            distanceMeters: distance ?? total,
            durationSeconds: 200,
            reroutePolicyVersion: "reroute-v1",
            geometry: geometry,
            maneuvers: maneuvers ?? [
                OpenGravelNavigationManeuver(id: "m0", kind: .continue, maneuver: nil, roadName: "Main Street", atDistanceMeters: 0),
                OpenGravelNavigationManeuver(id: "m1", kind: .turn, maneuver: .left, roadName: "Hawk Mountain Road", atDistanceMeters: corner),
                OpenGravelNavigationManeuver(id: "m2", kind: .arrive, maneuver: nil, roadName: nil, atDistanceMeters: total),
            ]
        )
    }

    func testKeepsTheSelectedGeometryExactly() throws {
        let input = payload()
        let route = try OpenGravelRouteMapper.route(from: input)
        XCTAssertEqual(route.geometry.count, input.geometry.count)
        for (mapped, original) in zip(route.geometry, input.geometry) {
            XCTAssertEqual(mapped.lat, original.lat)
            XCTAssertEqual(mapped.lng, original.lon)
        }
        XCTAssertEqual(route.waypoints.count, 2)
    }

    func testSplitsStepsAtTheTurnAndAnnouncesItAhead() throws {
        let route = try OpenGravelRouteMapper.route(from: payload())
        // Main Street to the turn, Hawk Mountain Road to the end, then arrival.
        XCTAssertEqual(route.steps.count, 3)
        let first = route.steps[0]
        XCTAssertEqual(first.roadName, "Main Street")
        XCTAssertEqual(first.instruction, "Turn left onto Hawk Mountain Road")
        XCTAssertEqual(first.visualInstructions.first?.primaryContent.maneuverModifier, .left)
        XCTAssertEqual(first.visualInstructions.first?.primaryContent.text, "Hawk Mountain Road")
        // The step ends at the corner.
        XCTAssertEqual(first.geometry.last!.lat, 40.0, accuracy: 1e-6)
        XCTAssertEqual(first.geometry.last!.lng, -74.987, accuracy: 1e-6)

        let second = route.steps[1]
        XCTAssertEqual(second.roadName, "Hawk Mountain Road")
        XCTAssertEqual(second.visualInstructions.first?.primaryContent.maneuverType, .arrive)
        XCTAssertEqual(second.visualInstructions.first?.primaryContent.text, "Hawk Mountain")

        let arrival = route.steps[2]
        XCTAssertEqual(arrival.distance, 0)
        XCTAssertEqual(arrival.visualInstructions.first?.primaryContent.maneuverType, .arrive)
    }

    func testStepLengthsAndDurationsAddUp() throws {
        let route = try OpenGravelRouteMapper.route(from: payload())
        XCTAssertEqual(route.steps.map(\.distance).reduce(0, +), route.distance, accuracy: 0.01)
        XCTAssertEqual(route.steps.map(\.duration).reduce(0, +), 200, accuracy: 0.01)
    }

    func testSpeaksAnEarlyCueOnlyOnLongSteps() throws {
        let route = try OpenGravelRouteMapper.route(from: payload())
        // ~1.1 km to the turn: too close to the start for a half-mile cue.
        XCTAssertEqual(route.steps[0].spokenInstructions.map(\.text), ["Turn left onto Hawk Mountain Road"])
        let long = OpenGravelRouteMapper.spoken("Turn right", stepLength: 3000)
        XCTAssertEqual(long.map(\.text), ["In half a mile, turn right", "Turn right"])
    }

    func testRescalesManeuversMeasuredWithADifferentFormula() throws {
        let base = payload()
        // The planner measured 2% long: the turn still lands on the corner.
        let stretched = payload(
            maneuvers: base.maneuvers.map {
                OpenGravelNavigationManeuver(id: $0.id, kind: $0.kind, maneuver: $0.maneuver, roadName: $0.roadName, atDistanceMeters: $0.atDistanceMeters * 1.02)
            },
            distance: base.distanceMeters * 1.02
        )
        let route = try OpenGravelRouteMapper.route(from: stretched)
        XCTAssertEqual(route.steps[0].geometry.last!.lng, -74.987, accuracy: 1e-6)
    }

    func testARouteWithoutTurnsIsOneStepAndArrival() throws {
        let route = try OpenGravelRouteMapper.route(from: payload(maneuvers: []))
        XCTAssertEqual(route.steps.count, 2)
        XCTAssertEqual(route.steps[0].instruction, "Arrive at your destination")
    }

    func testRefusesAnInvalidPayload() {
        var bad = payload()
        bad = OpenGravelNavigationPayload(
            schema: "native-navigation/v0", schemaVersion: 0, mode: bad.mode, routeId: bad.routeId,
            planningGeneration: bad.planningGeneration, fingerprint: bad.fingerprint, title: bad.title,
            distanceMeters: bad.distanceMeters, durationSeconds: bad.durationSeconds,
            reroutePolicyVersion: bad.reroutePolicyVersion, geometry: bad.geometry, maneuvers: bad.maneuvers
        )
        XCTAssertThrowsError(try OpenGravelRouteMapper.route(from: bad))
    }
}
