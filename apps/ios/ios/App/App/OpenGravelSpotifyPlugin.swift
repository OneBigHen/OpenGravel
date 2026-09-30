import Capacitor
import OpenGravelSpotify

/// The optional Spotify companion bridge. A missing app, missing client ID, or
/// failed Spotify call is represented as player state and never rejects ride
/// navigation or recording calls.
@objc(OpenGravelSpotifyPlugin)
public final class OpenGravelSpotifyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpenGravelSpotifyPlugin"
    public let jsName = "OpenGravelSpotify"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "togglePlayPause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipToPrevious", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipToNext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSpotify", returnType: CAPPluginReturnPromise),
    ]

    private let remote = OpenGravelSpotifyRemote.shared

    override public func load() {
        super.load()
        Task { @MainActor [weak self] in
            guard let self else { return }
            remote.onSnapshot = { [weak self] snapshot in
                self?.notifyListeners("stateChanged", data: snapshot.dictionary)
            }
            self.notifyListeners("stateChanged", data: remote.snapshot.dictionary)
        }
    }

    @objc public func isAvailable(_ call: CAPPluginCall) {
        Task { @MainActor in
            call.resolve(["available": remote.isAvailable])
        }
    }

    @objc public func getState(_ call: CAPPluginCall) {
        Task { @MainActor in
            call.resolve(remote.snapshot.dictionary)
        }
    }

    @objc public func connect(_ call: CAPPluginCall) {
        Task { @MainActor in
            remote.connect()
            call.resolve(remote.snapshot.dictionary)
        }
    }

    @objc public func disconnect(_ call: CAPPluginCall) {
        Task { @MainActor in
            remote.disconnect()
            call.resolve(remote.snapshot.dictionary)
        }
    }

    @objc public func togglePlayPause(_ call: CAPPluginCall) {
        Task { @MainActor in
            remote.togglePlayPause()
            call.resolve(remote.snapshot.dictionary)
        }
    }

    @objc public func skipToPrevious(_ call: CAPPluginCall) {
        Task { @MainActor in
            remote.skipToPrevious()
            call.resolve(remote.snapshot.dictionary)
        }
    }

    @objc public func skipToNext(_ call: CAPPluginCall) {
        Task { @MainActor in
            remote.skipToNext()
            call.resolve(remote.snapshot.dictionary)
        }
    }

    @objc public func openSpotify(_ call: CAPPluginCall) {
        Task { @MainActor in
            remote.openSpotify()
            call.resolve()
        }
    }
}
