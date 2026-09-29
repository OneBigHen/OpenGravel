import Foundation
#if canImport(ActivityKit)
import ActivityKit

/// The ride on the Lock Screen and in the Dynamic Island.
///
/// Shared by the app (which starts and updates it from the ride screen) and the
/// RideActivityWidget extension (which draws it). Every field is already in the
/// rider's words: the web view model decides the text, Swift only lays it out.
@available(iOS 16.2, *)
struct RideActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// "left", "right", "slight-left", "slight-right", "straight", "uturn", "continue", "arrive", or "" when there is no maneuver.
        var glyph: String
        /// "in 0.3 mi", "now", or "".
        var distance: String
        /// "Turn left", or a status line such as "Free Ride" or "Finding you on the route…".
        var action: String
        /// "onto Hawk Mountain Rd", or "".
        var road: String
        /// "3:42 PM", or "".
        var eta: String
        /// "24 mi · 41 min", or "".
        var remaining: String
        /// 0...1 along the route, or -1 when unknown.
        var progress: Double
    }

    /// "Guided ride", "Free Ride", "Recording".
    var title: String
}
#endif
