import FerrostarCoreFFI
import XCTest
@testable import OpenGravelNavigation

final class OpenGravelStepCatchUpTests: XCTestCase {
    /// Three ~550 m steps: east, north, east again.
    private let steps: [[GeographicCoordinate]] = [
        [GeographicCoordinate(lat: 40.0, lng: -75.0), GeographicCoordinate(lat: 40.0, lng: -74.9935)],
        [GeographicCoordinate(lat: 40.0, lng: -74.9935), GeographicCoordinate(lat: 40.005, lng: -74.9935)],
        [GeographicCoordinate(lat: 40.005, lng: -74.9935), GeographicCoordinate(lat: 40.005, lng: -74.987)],
    ]

    func testOnTheCurrentStepStaysPut() {
        let here = GeographicCoordinate(lat: 40.0001, lng: -74.997)
        XCTAssertEqual(OpenGravelStepCatchUp.stepsToAdvance(location: here, horizontalAccuracy: 8, remainingSteps: steps), 0)
    }

    func testResumedPartwayAdvancesToTheStepUnderTheRider() {
        let onLastStep = GeographicCoordinate(lat: 40.0051, lng: -74.990)
        XCTAssertEqual(OpenGravelStepCatchUp.stepsToAdvance(location: onLastStep, horizontalAccuracy: 8, remainingSteps: steps), 2)
        let onMiddleStep = GeographicCoordinate(lat: 40.0025, lng: -74.9936)
        XCTAssertEqual(OpenGravelStepCatchUp.stepsToAdvance(location: onMiddleStep, horizontalAccuracy: 8, remainingSteps: steps), 1)
    }

    func testFarFromEveryStepIsARealDeviation() {
        let elsewhere = GeographicCoordinate(lat: 40.02, lng: -74.95)
        XCTAssertEqual(OpenGravelStepCatchUp.stepsToAdvance(location: elsewhere, horizontalAccuracy: 8, remainingSteps: steps), 0)
    }

    func testAPoorFixNeverJumps() {
        let onLastStep = GeographicCoordinate(lat: 40.0051, lng: -74.990)
        XCTAssertEqual(OpenGravelStepCatchUp.stepsToAdvance(location: onLastStep, horizontalAccuracy: 120, remainingSteps: steps), 0)
        XCTAssertEqual(OpenGravelStepCatchUp.stepsToAdvance(location: onLastStep, horizontalAccuracy: -1, remainingSteps: steps), 0)
    }

    func testDistanceToLine() {
        let line = steps[0]
        let north100m = GeographicCoordinate(lat: 40.0009, lng: -74.997)
        XCTAssertEqual(OpenGravelStepCatchUp.distance(from: north100m, to: line), 100, accuracy: 2)
    }
}
