import ActivityKit
import SwiftUI
import WidgetKit

/// OpenGravel's palette (globals.css): deep spruce ground, paper text, ember accent.
private let spruce = Color(red: 0x24 / 255, green: 0x3a / 255, blue: 0x35 / 255)
private let ember = Color(red: 0xd6 / 255, green: 0x5a / 255, blue: 0x36 / 255)
private let paper = Color(red: 0xfb / 255, green: 0xf9 / 255, blue: 0xf4 / 255)
private let muted = Color(red: 0xb8 / 255, green: 0xc2 / 255, blue: 0xba / 255)

/// The maneuver as an SF Symbol; a ride without a maneuver shows the rider's heading.
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

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<RideActivityAttributes>

    var body: some View {
        let state = context.state
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: symbol(state.glyph))
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(ember)
                    .frame(width: 52)
                VStack(alignment: .leading, spacing: 2) {
                    if !state.distance.isEmpty {
                        Text(state.distance)
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(paper)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    Text(state.action)
                        .font(.system(size: state.distance.isEmpty ? 22 : 17, weight: .semibold))
                        .foregroundStyle(paper)
                        .lineLimit(1)
                    if !state.road.isEmpty {
                        Text(state.road)
                            .font(.system(size: 15))
                            .foregroundStyle(muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            if state.progress >= 0 {
                ProgressView(value: min(max(state.progress, 0), 1))
                    .tint(ember)
            }
            HStack {
                Text(context.attributes.title.uppercased())
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(muted)
                Spacer()
                if !state.remaining.isEmpty {
                    Text(state.remaining).font(.system(size: 13, weight: .medium)).foregroundStyle(paper)
                }
                if !state.eta.isEmpty {
                    Text("· \(state.eta)").font(.system(size: 13, weight: .medium)).foregroundStyle(paper)
                }
            }
        }
        .padding(16)
    }
}

@available(iOS 16.2, *)
struct RideActivityLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RideActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(spruce)
                .activitySystemActionForegroundColor(paper)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: symbol(context.state.glyph))
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(ember)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.distance)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.action).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.state.road).lineLimit(1)
                        Spacer()
                        Text(context.state.eta)
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(muted)
                }
            } compactLeading: {
                Image(systemName: symbol(context.state.glyph)).foregroundStyle(ember)
            } compactTrailing: {
                Text(context.state.distance.replacingOccurrences(of: "in ", with: ""))
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
            } minimal: {
                Image(systemName: symbol(context.state.glyph)).foregroundStyle(ember)
            }
            .keylineTint(ember)
        }
    }
}
