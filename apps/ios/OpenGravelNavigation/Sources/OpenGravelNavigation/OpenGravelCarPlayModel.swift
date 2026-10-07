@preconcurrency import CarPlay
import Combine
import FerrostarCarPlayUI
import FerrostarCore
import FerrostarCoreFFI
import FerrostarSwiftUI
import Foundation
import MapKit
import MapLibreSwiftUI

/// CarPlay is a renderer of the same process-wide navigation authority used by
/// the phone. It never creates a second FerrostarCore and never reroutes.
///
/// The phone/web layer remains OpenGravel's route-selection authority.
/// OpenGravelNavigationCoordinator.shared owns location, voice, progress and
/// route replacement; this model mirrors that state into Apple's CarPlay
/// templates and FerrostarCarPlayUI.
@MainActor
public final class OpenGravelCarPlayModel: NSObject, ObservableObject, @preconcurrency CPMapTemplateDelegate {
    @Published public private(set) var navigationState: NavigationState?
    @Published public var camera: MapViewCamera = .automotiveNavigation(zoom: 14)

    public let coordinator: OpenGravelNavigationCoordinator

    private weak var mapTemplate: CPMapTemplate?
    private var navigationSession: CPNavigationSession?
    private var activeIdentity: OpenGravelRouteIdentity?
    private var cancellables = Set<AnyCancellable>()
    private let formatters: FoundationFormatterCollection

    public init(
        coordinator: OpenGravelNavigationCoordinator = .shared,
        formatters: FoundationFormatterCollection = FoundationFormatterCollection()
    ) {
        self.coordinator = coordinator
        self.formatters = formatters
        navigationState = coordinator.state
        super.init()
        observeCoordinator()
    }

    /// The only CarPlay root template OpenGravel creates.
    ///
    /// Apple requires a navigation app's root to be CPMapTemplate. The custom
    /// MapLibre/Ferrostar view is installed in the CarPlay window separately;
    /// this template supplies system controls, trip state and maneuvers.
    public func createAndAttachTemplate() -> CPMapTemplate {
        let template = CPMapTemplate()
        template.mapDelegate = self
        template.automaticallyHidesNavigationBar = true
        template.hidesButtonsWithNavigationBar = true
        mapTemplate = template
        updateMapButtons()
        synchronizeNavigationSession()
        return template
    }

    /// CarPlay disconnects without owning the phone's ride lifecycle.
    ///
    /// The CarPlay presentation is cancelled, but native phone guidance remains
    /// active and may reconnect later to the same coordinator.
    public func disconnect() {
        navigationSession?.cancelTrip()
        navigationSession = nil
        activeIdentity = nil
        mapTemplate = nil
    }

    private func observeCoordinator() {
        coordinator.$state
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                self.navigationState = state
                self.synchronizeNavigationSession()
            }
            .store(in: &cancellables)

        coordinator.$activePayload
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.synchronizeNavigationSession()
            }
            .store(in: &cancellables)

        coordinator.$isMuted
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.updateMapButtons()
            }
            .store(in: &cancellables)
    }

    private func synchronizeNavigationSession() {
        guard let mapTemplate else { return }

        guard
            let payload = coordinator.activePayload,
            let route = coordinator.core?.route
        else {
            if navigationSession != nil {
                navigationSession?.finishTrip()
                navigationSession = nil
                activeIdentity = nil
            }
            return
        }

        // A mid-ride OpenGravel reroute replaces Ferrostar's active route in
        // place. Ferrostar 0.57 does not expose a stable cross-version route
        // replacement helper, so P0 creates a fresh system navigation session
        // over the already-replaced shared core. This never restarts location,
        // voice or OpenGravel's RideSession authority.
        if activeIdentity != payload.identity || navigationSession == nil {
            navigationSession?.finishTrip()
            do {
                let trip = try CPTrip.fromFerrostar(
                    routes: [route],
                    distanceFormatter: formatters.distanceFormatter,
                    durationFormatter: formatters.durationFormatter
                )
                navigationSession = mapTemplate.startNavigationSession(for: trip)
                activeIdentity = payload.identity
            } catch {
                navigationSession = nil
                activeIdentity = nil
                return
            }
        }

        guard
            let navigationSession,
            let navigationState
        else { return }

        if case .complete = navigationState.tripState {
            navigationSession.finishTrip()
            self.navigationSession = nil
            activeIdentity = nil
            return
        }

        navigationState.updateEstimates(
            mapTemplate: mapTemplate,
            session: navigationSession,
            units: .default
        )
        updateMapButtons()
    }

    private func updateMapButtons() {
        guard let mapTemplate else { return }

        let cameraButton: CPMapButton? = if
            camera.isTrackingUserLocationWithCourse,
            let overview = navigationState?.routeOverviewCamera
        {
            CarPlayMapButtons.camera(.showRouteOverview { [weak self] in
                self?.camera = overview
            })
        } else {
            CarPlayMapButtons.camera(.showRecenter { [weak self] in
                self?.camera = .automotiveNavigation(zoom: 14)
            })
        }

        // Keep moving controls intentionally sparse. Zoom/pan remain available
        // through CarPlay's standard interaction model; OpenGravel surfaces only
        // the two high-frequency ride actions.
        mapTemplate.mapButtons = [
            CarPlayMapButtons.toggleMute(coordinator.isMuted) { [weak self] in
                self?.coordinator.toggleMute()
            },
            cameraButton,
        ].compactMap { $0 }
    }

    public func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) {
        navigationSession?.cancelTrip()
        navigationSession = nil
        activeIdentity = nil
        coordinator.stop(reason: "carplay")
        updateMapButtons()
    }
}
