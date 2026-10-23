import FerrostarCarPlayUI
import FerrostarCore
import MapLibreSwiftUI
import SwiftUI

/// The CarPlay map surface. System navigation chrome and maneuvers come from
/// CPMapTemplate; this view is only the full-screen map beneath those overlays.
///
/// It reads the exact same coordinator/navigation state as the native phone
/// screen so CarPlay can never become a second route or progress authority.
public struct OpenGravelCarPlayNavigationView: View {
    @ObservedObject private var model: OpenGravelCarPlayModel

    public init(model: OpenGravelCarPlayModel) {
        self.model = model
    }

    public var body: some View {
        CarPlayNavigationView(
            styleURL: OpenGravelNavigationView.styleURL,
            camera: $model.camera,
            navigationCamera: .automotiveNavigation(zoom: 14),
            navigationState: model.navigationState,
            locationManagerConfiguration: NavigationLocationManagerConfiguration(
                nonNavigatingLocationManager: model.coordinator.mapLocation,
                navigatingLocationManager: model.coordinator.mapLocation
            )
        )
        .navigationSpeedLimit(
            speedLimit: model.coordinator.core?.annotation?.speedLimit,
            speedLimitStyle: .mutcdStyle
        )
        // Leave most of the CarPlay surface to Apple's overlays and the road.
        // Ferrostar's inset keeps the puck/route clear of the leading guidance
        // card on landscape vehicle displays.
        .navigationMapViewContentInset(landscape: { proxy in
            .landscape(
                within: proxy,
                verticalPct: 0.72,
                horizontalPct: 0.94
            )
        })
    }
}
