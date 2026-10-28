import Foundation
#if canImport(ActivityKit)
import ActivityKit

/// The ride or hike on the Lock Screen and in the Dynamic Island.
///
/// Shared by the app (which starts and updates it from the ride screen) and the
/// RideActivityWidget extension (which draws it). Every field is already in the
/// rider's words: the web view model decides the text, Swift only lays it out.
/// The fields mirror `LiveActivityState` in src/application/native/live-activity.ts.
@available(iOS 16.2, *)
struct RideActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// "guided" (turn by turn), "free" (Free Ride or recording: clock, distance, speed) or "hike".
        var kind: String = "guided"
        /// "left", "right", "slight-left", "slight-right", "straight", "uturn", "continue", "arrive", or "" when there is no maneuver.
        var glyph: String = ""
        /// "in 0.3 mi", "now", or "".
        var distance: String = ""
        /// "Turn left", or a status line such as "Free ride" or the next waypoint's name on a hike.
        var action: String = ""
        /// "onto Hawk Mountain Rd", or "".
        var road: String = ""
        /// "3:42 PM", or "".
        var eta: String = ""
        /// "24 mi · 41 min" on a ride, "3.2 mi" on a hike, or "".
        var remaining: String = ""
        /// 0...1 along the route, or -1 when unknown.
        var progress: Double = -1
        /// "Off the trail", or "": a warning replaces the context line and turns it red.
        var warning: String = ""
        /// Seconds recorded when this state was sent, or -1 when there is no recording clock.
        /// The widget counts on from it by itself, so it never needs an update just to tick.
        var elapsedSeconds: Double = -1
        /// Distance travelled so far, or "".
        var distanceDone: String = ""
        /// "42 mph", or "".
        var speed: String = ""
        /// Climb so far, "820 ft", or "".
        var gain: String = ""
        /// Straight-line distance back to where the trail began, or "".
        var toStart: String = ""
        /// When this state was made; with `elapsedSeconds` it fixes the clock's start.
        var sentAt: Date = Date()

        init(
            kind: String = "guided", glyph: String = "", distance: String = "", action: String = "",
            road: String = "", eta: String = "", remaining: String = "", progress: Double = -1,
            warning: String = "", elapsedSeconds: Double = -1, distanceDone: String = "", speed: String = "",
            gain: String = "", toStart: String = "", sentAt: Date = Date()
        ) {
            self.kind = kind; self.glyph = glyph; self.distance = distance; self.action = action
            self.road = road; self.eta = eta; self.remaining = remaining; self.progress = progress
            self.warning = warning; self.elapsedSeconds = elapsedSeconds; self.distanceDone = distanceDone
            self.speed = speed; self.gain = gain; self.toStart = toStart; self.sentAt = sentAt
        }

        /// Tolerates a state saved by an older build that lacked the newer fields.
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            kind = try values.decodeIfPresent(String.self, forKey: .kind) ?? "guided"
            glyph = try values.decodeIfPresent(String.self, forKey: .glyph) ?? ""
            distance = try values.decodeIfPresent(String.self, forKey: .distance) ?? ""
            action = try values.decodeIfPresent(String.self, forKey: .action) ?? ""
            road = try values.decodeIfPresent(String.self, forKey: .road) ?? ""
            eta = try values.decodeIfPresent(String.self, forKey: .eta) ?? ""
            remaining = try values.decodeIfPresent(String.self, forKey: .remaining) ?? ""
            progress = try values.decodeIfPresent(Double.self, forKey: .progress) ?? -1
            warning = try values.decodeIfPresent(String.self, forKey: .warning) ?? ""
            elapsedSeconds = try values.decodeIfPresent(Double.self, forKey: .elapsedSeconds) ?? -1
            distanceDone = try values.decodeIfPresent(String.self, forKey: .distanceDone) ?? ""
            speed = try values.decodeIfPresent(String.self, forKey: .speed) ?? ""
            gain = try values.decodeIfPresent(String.self, forKey: .gain) ?? ""
            toStart = try values.decodeIfPresent(String.self, forKey: .toStart) ?? ""
            sentAt = try values.decodeIfPresent(Date.self, forKey: .sentAt) ?? Date()
        }

        /// The moment the recording clock started, or `nil` when there is none.
        var clockStart: Date? {
            elapsedSeconds >= 0 ? sentAt.addingTimeInterval(-elapsedSeconds) : nil
        }
    }

    /// "Guided ride", "Free ride", "Recording", "Hike".
    var title: String
}
#endif
