import Foundation
import Capacitor
import OpenGravelNavigation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Starts, updates and ends the ride's Live Activity (Lock Screen and Dynamic
/// Island), with an alert on each announced turn so the screen lights up the way
/// Apple Maps does. Local updates only: the app keeps running in the background
/// for its location, so no push service is needed (and a free signing team
/// cannot use one).
@objc(RideActivityPlugin)
public class RideActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RideActivityPlugin"
    public let jsName = "RideActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    /// The running activity lives in `RideActivityStore`, shared with native
    /// navigation.
    private var current: Any? {
        get { RideActivityStore.current }
        set { RideActivityStore.current = newValue }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            call.resolve(["available": ActivityAuthorizationInfo().areActivitiesEnabled])
            return
        }
        #endif
        call.resolve(["available": false])
    }

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard let state = Self.state(from: call) else { return call.reject("Missing ride state") }
            let title = call.getString("title") ?? "Ride"
            Task {
                // Native navigation already runs one: keep it.
                if RideActivityStore.nativeDriving, let running = self.current as? Activity<RideActivityAttributes> {
                    return call.resolve(["id": running.id])
                }
                // One ride, one activity: a leftover from a crash is replaced.
                for activity in Activity<RideActivityAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
                do {
                    let activity = try Activity.request(
                        attributes: RideActivityAttributes(title: title),
                        content: ActivityContent(state: state, staleDate: nil),
                        pushType: nil
                    )
                    self.current = activity
                    call.resolve(["id": activity.id])
                } catch {
                    call.reject("Live Activity unavailable: \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.reject("Live Activities need iOS 16.2")
    }

    @objc func update(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard let state = Self.state(from: call) else { return call.reject("Missing ride state") }
            guard let activity = current as? Activity<RideActivityAttributes> else { return call.resolve() }
            // Native navigation owns the activity while it runs; a frozen web
            // view must not overwrite it with stale guidance.
            if RideActivityStore.nativeDriving { return call.resolve() }
            let alertTitle = call.getString("alertTitle")
            let alertBody = call.getString("alertBody") ?? ""
            Task {
                if let alertTitle {
                    let alert = AlertConfiguration(
                        title: LocalizedStringResource(stringLiteral: alertTitle),
                        body: LocalizedStringResource(stringLiteral: alertBody),
                        sound: .default
                    )
                    await activity.update(ActivityContent(state: state, staleDate: nil), alertConfiguration: alert)
                } else {
                    await activity.update(ActivityContent(state: state, staleDate: nil))
                }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    @objc func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let activity = current as? Activity<RideActivityAttributes>
            current = nil
            Task {
                await activity?.end(nil, dismissalPolicy: .immediate)
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    private static func state(from call: CAPPluginCall) -> RideActivityAttributes.ContentState? {
        guard let values = call.getObject("state") else { return nil }
        let text = { (key: String) in values[key] as? String ?? "" }
        let progress = (values["progress"] as? NSNumber)?.doubleValue ?? -1
        return RideActivityAttributes.ContentState(
            glyph: text("glyph"),
            distance: text("distance"),
            action: text("action"),
            road: text("road"),
            eta: text("eta"),
            remaining: text("remaining"),
            progress: progress
        )
    }
    #endif
}

/// The ride's one Live Activity, shared by the web plugin and native
/// navigation. While Ferrostar navigates (`nativeDriving`), it alone updates
/// the activity from native state, so the Dynamic Island and Lock Screen keep
/// counting down with the app in the background, as Google Maps' do.
/// Native guidance reaches it on the main actor; the web plugin's calls are
/// serialized by Capacitor, as the plugin's own property was.
enum RideActivityStore {
    /// The running activity, typed as `Any` so this loads on iOS 15.
    static var current: Any?
    static var nativeDriving = false
    private static var lastStep = -1
    private static var pending: Task<Void, Never>?

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    static func state(from guidance: OpenGravelGuidanceSnapshot) -> RideActivityAttributes.ContentState {
        RideActivityAttributes.ContentState(
            glyph: guidance.glyph,
            distance: guidance.distance,
            action: guidance.action,
            road: guidance.road,
            eta: guidance.eta,
            remaining: guidance.remaining,
            progress: guidance.progress
        )
    }
    #endif

    /// Native guidance changed; `nil` hands the activity back to the web.
    static func native(_ guidance: OpenGravelGuidanceSnapshot?) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        guard let guidance else {
            nativeDriving = false
            lastStep = -1
            return
        }
        nativeDriving = true
        let state = state(from: guidance)
        // A new maneuver lights the screen once, like Apple Maps' turn alerts.
        let newStep = guidance.stepIndex != lastStep && lastStep >= 0
        lastStep = guidance.stepIndex
        let previous = pending
        pending = Task {
            await previous?.value
            let content = ActivityContent(state: state, staleDate: nil)
            if let activity = current as? Activity<RideActivityAttributes>, activity.activityState == .active {
                if newStep {
                    let alert = AlertConfiguration(
                        title: LocalizedStringResource(stringLiteral: guidance.action),
                        body: LocalizedStringResource(stringLiteral: "\(guidance.distance) \(guidance.road)".trimmingCharacters(in: .whitespaces)),
                        sound: .default
                    )
                    await activity.update(content, alertConfiguration: alert)
                } else {
                    await activity.update(content)
                }
                return
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            for stale in Activity<RideActivityAttributes>.activities {
                await stale.end(nil, dismissalPolicy: .immediate)
            }
            current = try? Activity.request(
                attributes: RideActivityAttributes(title: "Guided ride"),
                content: content,
                pushType: nil
            )
        }
        #endif
    }
}
