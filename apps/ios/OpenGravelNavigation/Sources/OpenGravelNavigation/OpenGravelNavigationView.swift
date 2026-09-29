import FerrostarCore
import FerrostarMapLibreUI
import FerrostarSwiftUI
import MapLibreSwiftUI
import SwiftUI
import UIKit

/// The native ride screen (F1): Ferrostar's navigation map, banner and
/// progress over the same basemap the web app draws.
public struct OpenGravelNavigationView: View {
    /// The web app's basemap (src/infrastructure/map/basemap.ts).
    public static let styleURL = URL(string: "https://tiles.openfreemap.org/styles/liberty")!

    @ObservedObject private var coordinator: OpenGravelNavigationCoordinator
    @State private var camera: MapViewCamera = .automotiveNavigation()
    private let onExit: () -> Void

    public init(coordinator: OpenGravelNavigationCoordinator, onExit: @escaping () -> Void) {
        self.coordinator = coordinator
        self.onExit = onExit
    }

    public var body: some View {
        DynamicallyOrientingNavigationView(
            styleURL: Self.styleURL,
            camera: $camera,
            navigationState: coordinator.state,
            // The coordinator's camera location: never Ferrostar's 0,0 default.
            locationManagerConfiguration: NavigationLocationManagerConfiguration(
                nonNavigatingLocationManager: coordinator.mapLocation,
                navigatingLocationManager: coordinator.mapLocation
            ),
            isMuted: coordinator.isMuted,
            onTapMute: { coordinator.toggleMute() },
            onTapExit: { onExit() }
        )
        // Ferrostar lays its banner and controls out inside the safe area; the
        // map already draws edge to edge beneath them.
    }
}

/// Presents and dismisses the native ride screen over the Capacitor web view.
@MainActor
public enum OpenGravelNavigationPresenter {
    private static weak var presented: UIViewController?

    public static func present(over host: UIViewController, onExit: @escaping () -> Void) {
        guard presented == nil else { return }
        let controller = UIHostingController(
            rootView: OpenGravelNavigationView(coordinator: .shared, onExit: onExit)
        )
        controller.modalPresentationStyle = .fullScreen
        controller.overrideUserInterfaceStyle = .dark
        presented = controller
        host.present(controller, animated: true)
    }

    public static func dismiss() {
        presented?.dismiss(animated: true)
        presented = nil
    }
}
