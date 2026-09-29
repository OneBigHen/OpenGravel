import Capacitor
import Foundation
import OpenGravelNavigation

/// The web app's door to native turn-by-turn (NATIVE-NAVIGATION-FERROSTAR §16).
/// The web hands over the route it selected; Ferrostar guides along exactly
/// that route and reports progress back. The web never drives the native clock.
@objc(OpenGravelNavigationPlugin)
public class OpenGravelNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpenGravelNavigationPlugin"
    public let jsName = "OpenGravelNavigation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "replaceRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMuted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showOverview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recenter", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        Task { @MainActor in
            // The Lock Screen and Dynamic Island follow native guidance.
            OpenGravelNavigationCoordinator.shared.onGuidance = { guidance in
                RideActivityStore.native(guidance)
            }
            OpenGravelNavigationCoordinator.shared.onEvent = { [weak self] event in
                if case .ended = event {
                    OpenGravelNavigationPresenter.dismiss()
                }
                self?.notifyListeners(event.name, data: event.body)
            }
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let object = call.getObject("payload"),
              let data = try? JSONSerialization.data(withJSONObject: object)
        else { return call.reject("Missing navigation payload", "invalid-payload") }
        let payload: OpenGravelNavigationPayload
        do {
            payload = try OpenGravelNavigationPayload.decodeAndValidate(data)
        } catch {
            return call.reject("The route can't be navigated natively: \(error)", "invalid-payload")
        }
        let simulate = call.getBool("simulate") ?? false
        // Headless: Ferrostar guides (GPS, voice, Lock Screen) while the web's
        // Ride Focus stays in front (Settings → Navigation screen).
        let headless = call.getString("presentation") == "headless"
        Task { @MainActor in
            do {
                try OpenGravelNavigationCoordinator.shared.start(payload: payload, simulate: simulate)
            } catch {
                return call.reject("Native navigation couldn't start: \(error)", "start-failed")
            }
            if !headless, let host = self.bridge?.viewController {
                OpenGravelNavigationPresenter.present(over: host) {
                    OpenGravelNavigationCoordinator.shared.stop(reason: "exit")
                }
            }
            call.resolve(["accepted": true, "activeRouteId": payload.routeId])
        }
    }

    /// F3: a route OpenGravel re-planned mid-ride replaces the active one in
    /// place; the native screen stays up.
    @objc func replaceRoute(_ call: CAPPluginCall) {
        guard let object = call.getObject("payload"),
              let data = try? JSONSerialization.data(withJSONObject: object)
        else { return call.reject("Missing navigation payload", "invalid-payload") }
        let payload: OpenGravelNavigationPayload
        do {
            payload = try OpenGravelNavigationPayload.decodeAndValidate(data)
        } catch {
            return call.reject("The route can't be navigated natively: \(error)", "invalid-payload")
        }
        Task { @MainActor in
            do {
                try OpenGravelNavigationCoordinator.shared.replaceRoute(payload: payload)
            } catch OpenGravelNavigationStartError.notNavigating {
                return call.reject("Nothing is navigating", "not-navigating")
            } catch OpenGravelNavigationStartError.staleReplacement {
                return call.reject("A newer route is already active", "stale")
            } catch {
                return call.reject("The new route couldn't be applied: \(error)", "replace-failed")
            }
            call.resolve(["accepted": true, "activeRouteId": payload.routeId])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        Task { @MainActor in
            OpenGravelNavigationCoordinator.shared.stop(reason: "web")
            OpenGravelNavigationPresenter.dismiss()
            call.resolve()
        }
    }

    @objc func setMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        Task { @MainActor in
            OpenGravelNavigationCoordinator.shared.setMuted(muted)
            call.resolve()
        }
    }

    // The native screen owns its own overview and recenter controls in F1.
    @objc func showOverview(_ call: CAPPluginCall) { call.resolve() }
    @objc func recenter(_ call: CAPPluginCall) { call.resolve() }
}
