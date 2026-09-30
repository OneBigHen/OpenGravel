import UIKit
import Capacitor
import OpenGravelSpotify

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // MainViewController, not a bare CAPBridgeViewController: it registers the
        // app's own plugins (Live Activity, native navigation).
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        // A Spotify authorization redirect can be the event that cold-started
        // this scene. Forward it before the Capacitor proxy consumes the scene
        // lifecycle event; the remote itself accepts it only when a persisted
        // user-initiated authorization is still pending.
        if let url = connectionOptions.urlContexts.first?.url {
            Task { @MainActor in
                _ = OpenGravelSpotifyRemote.shared.handleOpenURL(url)
            }
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url {
            Task { @MainActor in
                _ = OpenGravelSpotifyRemote.shared.handleOpenURL(url)
            }
        }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        Task { @MainActor in OpenGravelSpotifyRemote.shared.sceneWillResignActive() }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        Task { @MainActor in OpenGravelSpotifyRemote.shared.sceneDidBecomeActive() }
    }
}
