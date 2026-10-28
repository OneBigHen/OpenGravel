import ActivityKit
import SwiftUI
import UIKit
import WidgetKit

/// OpenGravel's palette (src/app/tokens.css): the app green is the one accent,
/// on the cream surface by day and the deep spruce one by night. Each colour
/// resolves against the Lock Screen's own appearance, so the card matches the
/// wallpaper treatment the phone chose.
private func dynamic(light: UInt32, dark: UInt32) -> Color {
    Color(UIColor { trait in
        let hex = trait.userInterfaceStyle == .dark ? dark : light
        return UIColor(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1
        )
    })
}

private let surface = dynamic(light: 0xfdfcf9, dark: 0x141c19)
private let ink = dynamic(light: 0x0f1a15, dark: 0xecf1ee)
private let muted = dynamic(light: 0x46524c, dark: 0xa2aea8)
private let green = dynamic(light: 0x13703f, dark: 0x6fe3a3)
private let danger = dynamic(light: 0xb3261e, dark: 0xf0937f)

private enum Kind {
    case guided, free, hike

    init(_ state: RideActivityAttributes.ContentState) {
        switch state.kind {
        case "hike": self = .hike
        case "free": self = .free
        default: self = .guided
        }
    }
}

/// The maneuver as an SF Symbol.
private func symbol(_ glyph: String) -> String {
    switch glyph {
    case "left": return "arrow.turn.up.left"
    case "right": return "arrow.turn.up.right"
    case "slight-left": return "arrow.up.left"
    case "slight-right": return "arrow.up.right"
    case "straight", "continue": return "arrow.up"
    case "uturn": return "arrow.uturn.down"
    case "arrive": return "flag.checkered"
    default: return "location.north.fill"
    }
}

/// The glyph for the state: a warning beats everything, then the kind's own.
@available(iOS 16.2, *)
private func icon(_ state: RideActivityAttributes.ContentState) -> String {
    if !state.warning.isEmpty { return "exclamationmark.triangle.fill" }
    switch Kind(state) {
    case .hike: return "figure.hiking"
    case .free: return "record.circle"
    case .guided: return symbol(state.glyph)
    }
}

@available(iOS 16.2, *)
private func iconColor(_ state: RideActivityAttributes.ContentState) -> Color {
    state.warning.isEmpty ? green : danger
}

/// The big number: distance to the turn, distance left on a hike, the clock on a recording.
@available(iOS 16.2, *)
private struct Headline: View {
    let state: RideActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        Group {
            switch Kind(state) {
            case .free:
                if let start = state.clockStart {
                    Text(timerInterval: start...start.addingTimeInterval(60 * 60 * 48), pauseTime: nil, countsDown: false, showsHours: true)
                } else if !state.speed.isEmpty {
                    Text(state.speed)
                } else {
                    Text(state.action)
                }
            case .hike:
                Text(state.remaining.isEmpty ? state.distance : "\(state.remaining) left")
            case .guided:
                Text(state.distance.isEmpty ? state.action : state.distance)
            }
        }
        .font(.system(size: size, weight: .bold, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(ink)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One line of context under the number. A warning replaces it and turns red.
@available(iOS 16.2, *)
private struct ContextLine: View {
    let state: RideActivityAttributes.ContentState

    private var text: String {
        if !state.warning.isEmpty { return state.warning }
        switch Kind(state) {
        case .guided:
            if state.distance.isEmpty { return state.road }
            return state.road.isEmpty ? state.action : "\(state.action) \(state.road)"
        case .hike:
            if state.distance.isEmpty { return state.action }
            return "\(state.distance) to \(state.action)"
        case .free:
            return state.action
        }
    }

    var body: some View {
        Text(text)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(state.warning.isEmpty ? ink : danger)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A small label over a value, for the strip along the bottom of the card.
private struct Fact: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(muted)
            Text(value)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

@available(iOS 16.2, *)
private struct Facts: View {
    let state: RideActivityAttributes.ContentState

    private var items: [(String, String)] {
        switch Kind(state) {
        case .guided:
            let parts = state.remaining.components(separatedBy: " · ")
            return [
                ("Arrive", state.eta),
                ("Left", parts.first ?? ""),
                ("Time", parts.count > 1 ? parts[1] : ""),
            ].filter { !$0.1.isEmpty }
        case .hike:
            return [
                ("Climbed", state.gain),
                ("To start", state.toStart),
                ("Done by", state.eta),
            ].filter { !$0.1.isEmpty }
        case .free:
            return [
                ("Distance", state.distanceDone),
                ("Speed", state.clockStart == nil ? "" : state.speed),
                ("Climbed", state.gain),
            ].filter { !$0.1.isEmpty }
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                Fact(label: item.0, value: item.1)
            }
            Spacer(minLength: 0)
        }
    }
}

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<RideActivityAttributes>

    var body: some View {
        let state = context.state
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: icon(state))
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(iconColor(state))
                    .frame(width: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Headline(state: state, size: 34)
                    ContextLine(state: state)
                }
            }
            if state.progress >= 0 {
                ProgressView(value: min(max(state.progress, 0), 1))
                    .tint(green)
            }
            Facts(state: state)
        }
        .padding(16)
    }
}

/// Short text for the island's tight edges: "in 0.3 mi" becomes "0.3 mi".
@available(iOS 16.2, *)
private func compactValue(_ state: RideActivityAttributes.ContentState) -> String {
    switch Kind(state) {
    case .guided: return state.distance.replacingOccurrences(of: "in ", with: "")
    case .hike: return state.remaining
    case .free: return state.speed.isEmpty ? state.distanceDone : state.speed
    }
}

@available(iOS 16.2, *)
struct RideActivityLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RideActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(surface)
                .activitySystemActionForegroundColor(green)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: icon(context.state))
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(iconColor(context.state))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Headline(state: context.state, size: 24)
                        .frame(maxWidth: 140, alignment: .trailing)
                        .multilineTextAlignment(.trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    ContextLine(state: context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Facts(state: context.state)
                }
            } compactLeading: {
                Image(systemName: icon(context.state)).foregroundStyle(iconColor(context.state))
            } compactTrailing: {
                Text(compactValue(context.state))
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .frame(maxWidth: 64)
            } minimal: {
                Image(systemName: icon(context.state)).foregroundStyle(iconColor(context.state))
            }
            .keylineTint(green)
        }
    }
}
