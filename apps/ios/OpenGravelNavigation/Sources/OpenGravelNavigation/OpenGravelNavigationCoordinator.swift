import Combine
import CoreLocation
@preconcurrency import FerrostarCore
@preconcurrency import FerrostarCoreFFI
import Foundation
import MapLibreSwiftUI
import UIKit

/// What the web layer hears back (NATIVE-NAVIGATION-FERROSTAR §16, §18). Only
/// stable facts cross the bridge; Ferrostar's internal state stays here.
public enum OpenGravelNavigationEvent: Sendable {
    case progress(routeId: String, distanceRemaining: Double, durationRemaining: Double, distanceToNextManeuver: Double, stepIndex: Int, location: UserLocation)
    case offRoute(routeId: String, offRoute: Bool)
    case ended(routeId: String, reason: String)

    public var name: String {
        switch self {
        case .progress: "routeProgress"
        case .offRoute: "offRouteChanged"
        case .ended: "navigationEnded"
        }
    }

    static func fix(_ location: UserLocation) -> [String: Any] {
        var fix: [String: Any] = [
            "lat": location.coordinates.lat,
            "lon": location.coordinates.lng,
            "accuracyMeters": location.horizontalAccuracy,
            "observedAt": ISO8601DateFormatter.fractional.string(from: location.timestamp),
            "headingDegrees": NSNull(),
            "speedMps": NSNull(),
        ]
        if let course = location.courseOverGround { fix["headingDegrees"] = Double(course.degrees) }
        if let speed = location.speed { fix["speedMps"] = speed.value }
        return fix
    }

    public var body: [String: Any] {
        switch self {
        case let .progress(routeId, remaining, duration, next, step, location):
            ["routeId": routeId, "distanceRemainingMeters": remaining, "durationRemainingSeconds": duration,
             "distanceToNextManeuverMeters": next, "stepIndex": step,
             // The raw device fix (not the snapped one): the web's RideSession
             // and recording journal what the rider actually did.
             "location": Self.fix(location)]
        case let .offRoute(routeId, offRoute):
            ["routeId": routeId, "offRoute": offRoute]
        case let .ended(routeId, reason):
            ["routeId": routeId, "reason": reason]
        }
    }
}

extension ISO8601DateFormatter {
    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

public enum OpenGravelNavigationStartError: Error {
    case alreadyNavigating
    /// `replaceRoute` with nothing navigating: the web must `start` instead.
    case notNavigating
    /// A replacement older than the route it would replace (§19).
    case staleReplacement
}

/// The one process-wide navigation authority on iOS (§9). The phone screen and,
/// later, CarPlay read the same core; there is never a second one.
@MainActor
public final class OpenGravelNavigationCoordinator: ObservableObject {
    public static let shared = OpenGravelNavigationCoordinator()

    @Published public private(set) var state: NavigationState?
    @Published public private(set) var isMuted = false
    @Published public private(set) var activePayload: OpenGravelNavigationPayload?

    /// Receives every bridge event; the Capacitor plugin sets it.
    public var onEvent: ((OpenGravelNavigationEvent) -> Void)?

    /// The Lock Screen / Dynamic Island feed: called when what the rider would
    /// see changes (a new maneuver, the distance text, the ETA minute), and
    /// with `nil` when native navigation ends. The app owns the Live Activity.
    public var onGuidance: ((OpenGravelGuidanceSnapshot?) -> Void)?
    private var lastGuidance: OpenGravelGuidanceSnapshot?

    /// What the navigation map's camera follows. Ferrostar's default starts at
    /// `CLLocation()` (0°, 0°, the Atlantic) and moves only when a new fix
    /// arrives while the map re-renders, so a rider standing still at the
    /// start saw nothing but ocean. This one is seeded with where the rider is
    /// (or the route's start, never 0,0) and fed every fix; MapLibre reads it
    /// when the map attaches.
    public let mapLocation = StaticLocationManager(initialLocation: CLLocation(latitude: 39.95, longitude: -75.16))

    public private(set) var core: FerrostarCore?
    private let deviceLocation = CoreLocationProvider(activityType: .otherNavigation, allowBackgroundLocationUpdates: true)
    private var simulated: SimulatedLocationProvider?
    private var cancellables = Set<AnyCancellable>()
    private let deviationPolicy = KeepOpenGravelRoute()
    private var lastOffRoute = false
    private var lastProgressAt = Date.distantPast
    private var endedReported = false

    private init() {}

    public var isNavigating: Bool { activePayload != nil }

    /// Starts guidance on exactly the route OpenGravel selected. `simulate`
    /// drives a simulated rider along it (simulator and demo use only).
    public func start(payload: OpenGravelNavigationPayload, simulate: Bool) throws {
        if let active = activePayload {
            // The same route again is a no-op; a different one replaces it.
            if active.identity == payload.identity { return }
            stop(reason: "replaced")
        }
        let route = try OpenGravelRouteMapper.route(from: payload)
        let location: LocationProviding
        if simulate {
            let first = route.geometry[0]
            let provider = SimulatedLocationProvider(location: CLLocation(latitude: first.lat, longitude: first.lng))
            try provider.setSimulatedRoute(route, resampleDistance: 10)
            provider.warpFactor = 2
            simulated = provider
            location = provider
        } else {
            simulated = nil
            location = deviceLocation
        }

        // Where the camera opens: the freshest device fix, else the route start.
        let routeStart = route.geometry[0]
        let seed = CLLocationManager().location.flatMap { fix in
            fix.horizontalAccuracy >= 0 && fix.horizontalAccuracy < 500 && abs(fix.timestamp.timeIntervalSinceNow) < 600 ? fix : nil
        } ?? CLLocation(latitude: routeStart.lat, longitude: routeStart.lng)
        mapLocation.lastLocation = simulate ? CLLocation(latitude: routeStart.lat, longitude: routeStart.lng) : seed

        let core = try FerrostarCore(
            customRouteProvider: OpenGravelRouteProvider { _, _ in
                // F3 wires OpenGravel's reroute authority here. Until then no
                // generic router may replace the selected route (§11).
                []
            },
            locationProvider: location,
            navigationControllerConfig: SwiftNavigationControllerConfig(
                waypointAdvance: .waypointWithinRange(100.0),
                stepAdvanceCondition: stepAdvanceDistanceEntryAndExit(
                    distanceToEndOfStep: 30,
                    distanceAfterEndOfStep: 5,
                    minimumHorizontalAccuracy: 32
                ),
                arrivalStepAdvanceCondition: stepAdvanceDistanceToEndOfStep(
                    distance: 30,
                    minimumHorizontalAccuracy: 32
                ),
                routeDeviationTracking: .staticThreshold(minimumHorizontalAccuracy: 25, maxAcceptableDeviation: 50),
                snappedLocationCourseFiltering: .snapToRoute
            )
        )
        core.delegate = deviationPolicy
        self.core = core
        activePayload = payload
        lastOffRoute = false
        endedReported = false
        lastGuidance = nil
        isMuted = core.spokenInstructionObserver.isMuted
        cancellables.removeAll()
        core.$state.receive(on: DispatchQueue.main).sink { [weak self] state in
            self?.observe(state)
        }.store(in: &cancellables)
        core.spokenInstructionObserver.$isMuted.receive(on: DispatchQueue.main).sink { [weak self] muted in
            self?.isMuted = muted
        }.store(in: &cancellables)

        location.startUpdating()
        try core.startNavigation(route: route)
        UIApplication.shared.isIdleTimerDisabled = true
    }

    /// F3: OpenGravel planned a new route mid-ride (off-route recovery or a
    /// detour). Swap it into the running session so the native screen, voice
    /// and GPS carry on without closing. Only a newer planning generation of
    /// the same ride may replace the active route; a late answer is refused.
    public func replaceRoute(payload: OpenGravelNavigationPayload) throws {
        guard let active = activePayload, let core else { throw OpenGravelNavigationStartError.notNavigating }
        if active.identity == payload.identity { return }
        guard payload.planningGeneration > active.planningGeneration else {
            throw OpenGravelNavigationStartError.staleReplacement
        }
        let route = try OpenGravelRouteMapper.route(from: payload)
        // Starts from the provider's last fix: where the rider actually is.
        try core.startNavigation(route: route)
        activePayload = payload
        if lastOffRoute {
            lastOffRoute = false
            onEvent?(.offRoute(routeId: payload.routeId, offRoute: false))
        }
        lastProgressAt = .distantPast
    }

    public func stop(reason: String) {
        guard let payload = activePayload else { return }
        core?.stopNavigation()
        simulated?.stopUpdating()
        deviceLocation.stopUpdating()
        cancellables.removeAll()
        core = nil
        simulated = nil
        state = nil
        activePayload = nil
        UIApplication.shared.isIdleTimerDisabled = false
        lastGuidance = nil
        onGuidance?(nil)
        if !endedReported {
            endedReported = true
            onEvent?(.ended(routeId: payload.routeId, reason: reason))
        }
    }

    public func setMuted(_ muted: Bool) {
        guard let observer = core?.spokenInstructionObserver, observer.isMuted != muted else { return }
        observer.toggleMute()
    }

    public func toggleMute() {
        core?.spokenInstructionObserver.toggleMute()
    }

    private func observe(_ next: NavigationState?) {
        state = next
        guard let next, let payload = activePayload else { return }
        switch next.tripState {
        case let .navigating(_, userLocation, _, remainingSteps, _, progress, _, deviation, visualInstruction, _, _):
            // Keep the camera on the rider (snapped when on route, raw when off).
            let shown = next.preferredUserLocation ?? userLocation
            if mapLocation.lastLocation.coordinate.latitude != shown.coordinates.lat ||
                mapLocation.lastLocation.coordinate.longitude != shown.coordinates.lng ||
                mapLocation.lastLocation.course != shown.clLocation.course {
                mapLocation.lastLocation = shown.clLocation
            }
            let offRoute: Bool = if case .deviation = deviation { true } else { false }
            if offRoute != lastOffRoute {
                lastOffRoute = offRoute
                onEvent?(.offRoute(routeId: payload.routeId, offRoute: offRoute))
            }
            let steps = core?.route?.steps.count ?? remainingSteps.count
            let guidance = OpenGravelGuidanceSnapshot.make(
                instruction: visualInstruction,
                progress: progress,
                routeMeters: payload.distanceMeters,
                stepIndex: max(0, steps - remainingSteps.count)
            )
            if guidance != lastGuidance {
                lastGuidance = guidance
                onGuidance?(guidance)
            }
            // About once a second is plenty for the web's session journal.
            let now = Date()
            if now.timeIntervalSince(lastProgressAt) >= 1 {
                lastProgressAt = now
                let totalSteps = core?.route?.steps.count ?? remainingSteps.count
                onEvent?(.progress(
                    routeId: payload.routeId,
                    distanceRemaining: progress.distanceRemaining,
                    durationRemaining: progress.durationRemaining,
                    distanceToNextManeuver: progress.distanceToNextManeuver,
                    stepIndex: max(0, totalSteps - remainingSteps.count),
                    location: userLocation
                ))
            }
        case .complete:
            stop(reason: "arrived")
        case .idle:
            break
        }
    }
}

/// F1 deviation policy: keep guiding on OpenGravel's route and let the rider
/// rejoin it. Never ask a generic router (§11); F3 replaces this.
private final class KeepOpenGravelRoute: FerrostarCoreDelegate {
    func core(_: FerrostarCore, didStartWith _: Route) {}

    func core(
        _: FerrostarCore,
        correctiveActionForDeviation _: DeviationKind,
        remainingWaypoints _: [Waypoint]
    ) -> CorrectiveAction {
        .doNothing
    }

    func core(_: FerrostarCore, loadedAlternateRoutes _: [Route]) {}
}
