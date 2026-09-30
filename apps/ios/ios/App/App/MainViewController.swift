import UIKit
import Capacitor
import OpenGravelSpotify
#if DEBUG
import OpenGravelNavigation
#endif

/// The app's bridge, with the plugins that live in this target (not in a package).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RideActivityPlugin())
        bridge?.registerPluginInstance(OpenGravelNavigationPlugin())
        bridge?.registerPluginInstance(OpenGravelSpotifyPlugin())
    }

    #if DEBUG
    private var fixtureStarted = false

    /// Simulator proof for native navigation (NATIVE-NAVIGATION-FERROSTAR F1):
    /// `-ogvNavFixture <path to a native-navigation/v1 JSON>` starts Ferrostar on
    /// that route with a simulated rider. Debug builds only.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !fixtureStarted, let path = UserDefaults.standard.string(forKey: "ogvNavFixture") else { return }
        fixtureStarted = true
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            let payload = try OpenGravelNavigationPayload.decodeAndValidate(data)
            try OpenGravelNavigationCoordinator.shared.start(payload: payload, simulate: true)
            OpenGravelNavigationPresenter.present(over: self) {
                OpenGravelNavigationCoordinator.shared.stop(reason: "exit")
                OpenGravelNavigationPresenter.dismiss()
            }
        } catch {
            NSLog("ogvNavFixture failed: \(error)")
        }
    }
    #endif
}
