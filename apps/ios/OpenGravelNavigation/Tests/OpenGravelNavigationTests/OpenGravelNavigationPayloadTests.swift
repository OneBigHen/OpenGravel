import XCTest
@testable import OpenGravelNavigation

final class OpenGravelNavigationPayloadTests: XCTestCase {
    private func fixture(
        schemaVersion: Int = OpenGravelNavigationPayload.supportedSchemaVersion,
        mode: String = OpenGravelNavigationPayload.supportedMode,
        latitude: Double = 40.177
    ) throws -> Data {
        let object: [String: Any] = [
            "schema": OpenGravelNavigationPayload.supportedSchema,
            "schemaVersion": schemaVersion,
            "mode": mode,
            "routeId": "route_native_fixture",
            "planningGeneration": 7,
            "fingerprint": "fp_native_fixture",
            "title": "via County Line Road",
            "distanceMeters": 1200.0,
            "durationSeconds": 110.0,
            "reroutePolicyVersion": "reroute-v1",
            "geometry": [
                ["lat": latitude, "lon": -75.106],
                ["lat": 40.188, "lon": -75.087]
            ],
            "maneuvers": [
                [
                    "id": "instr_native_1",
                    "kind": "turn",
                    "maneuver": "right",
                    "roadName": "County Line Road",
                    "atDistanceMeters": 550.0
                ],
                [
                    "id": "instr_native_2",
                    "kind": "arrive",
                    "maneuver": NSNull(),
                    "roadName": NSNull(),
                    "atDistanceMeters": 1200.0
                ]
            ]
        ]
        return try JSONSerialization.data(withJSONObject: object)
    }

    func testDecodesAndValidatesContract() throws {
        let payload = try OpenGravelNavigationPayload.decodeAndValidate(fixture())

        XCTAssertEqual(payload.mode, "guided")
        XCTAssertEqual(payload.identity.routeId, "route_native_fixture")
        XCTAssertEqual(payload.identity.planningGeneration, 7)
        XCTAssertEqual(payload.identity.fingerprint, "fp_native_fixture")
        XCTAssertEqual(payload.maneuvers.first?.maneuver, .right)
    }

    func testRejectsUnknownSchemaVersion() throws {
        XCTAssertThrowsError(
            try OpenGravelNavigationPayload.decodeAndValidate(fixture(schemaVersion: 2))
        ) { error in
            XCTAssertEqual(error as? OpenGravelNavigationPayloadError, .unsupportedSchema)
        }
    }

    func testRejectsUnsupportedMode() throws {
        XCTAssertThrowsError(
            try OpenGravelNavigationPayload.decodeAndValidate(fixture(mode: "track"))
        ) { error in
            XCTAssertEqual(error as? OpenGravelNavigationPayloadError, .unsupportedMode)
        }
    }

    func testRejectsInvalidCoordinate() throws {
        XCTAssertThrowsError(
            try OpenGravelNavigationPayload.decodeAndValidate(fixture(latitude: 95))
        ) { error in
            XCTAssertEqual(error as? OpenGravelNavigationPayloadError, .invalidGeometry)
        }
    }
}
