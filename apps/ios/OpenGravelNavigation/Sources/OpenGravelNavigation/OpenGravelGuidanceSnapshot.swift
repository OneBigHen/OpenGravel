@preconcurrency import FerrostarCoreFFI
import Foundation

/// What the Lock Screen and Dynamic Island show while Ferrostar navigates:
/// the next maneuver as a glyph, how far, onto which road, and when the rider
/// arrives. Built natively from Ferrostar's state, so it keeps updating when
/// the app is in the background and the web view is frozen (the way Google
/// Maps' Live Activity does). Text is already in the rider's words.
public struct OpenGravelGuidanceSnapshot: Equatable, Sendable {
    /// "left", "right", "slight-left", "slight-right", "straight", "uturn", "arrive", or "".
    public let glyph: String
    /// "in 0.3 mi", "in 450 ft", "now", or "".
    public let distance: String
    /// "Turn left", "Arrive", "Continue".
    public let action: String
    /// "onto Hawk Mountain Rd", or "".
    public let road: String
    /// "3:42 PM", or "".
    public let eta: String
    /// "24 mi · 41 min", or "".
    public let remaining: String
    /// 0…1 along the route, or -1 when unknown.
    public let progress: Double
    /// The step the rider is on; a change means a new maneuver is up next.
    public let stepIndex: Int

    static func glyph(type: ManeuverType?, modifier: ManeuverModifier?) -> String {
        if type == .arrive { return "arrive" }
        switch modifier {
        case .left, .sharpLeft: return "left"
        case .right, .sharpRight: return "right"
        case .slightLeft: return "slight-left"
        case .slightRight: return "slight-right"
        case .uTurn: return "uturn"
        case .straight: return "straight"
        case .none: return type == nil ? "" : "straight"
        }
    }

    static func action(type: ManeuverType?, modifier: ManeuverModifier?) -> String {
        if type == .arrive { return "Arrive" }
        switch modifier {
        case .left: return "Turn left"
        case .sharpLeft: return "Sharp left"
        case .slightLeft: return "Keep left"
        case .right: return "Turn right"
        case .sharpRight: return "Sharp right"
        case .slightRight: return "Keep right"
        case .uTurn: return "Make a U-turn"
        case .straight, .none: return "Continue"
        }
    }

    /// Feet under a tenth of a mile (rounded to 50), then miles to one decimal.
    static func distanceText(_ meters: Double) -> String {
        guard meters.isFinite, meters >= 0 else { return "" }
        if meters < 15 { return "now" }
        let feet = meters * 3.28084
        if feet < 528 { return "in \(max(50, Int((feet / 50).rounded()) * 50)) ft" }
        let miles = meters / 1_609.344
        return miles >= 10 ? "in \(Int(miles.rounded())) mi" : String(format: "in %.1f mi", miles)
    }

    static func remainingText(meters: Double, seconds: Double) -> String {
        guard meters.isFinite, seconds.isFinite, meters >= 0, seconds >= 0 else { return "" }
        let miles = meters / 1_609.344
        let milesText = miles >= 10 ? "\(Int(miles.rounded())) mi" : String(format: "%.1f mi", miles)
        let minutes = Int((seconds / 60).rounded())
        let timeText = minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min"
        return "\(milesText) · \(timeText)"
    }

    static func etaText(seconds: Double, now: Date) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: now.addingTimeInterval(seconds))
    }

    /// `road` is the instruction text when it names a road (Ferrostar's primary
    /// content is the road for OSRM-style steps), never a raw sentence.
    static func make(
        instruction: VisualInstruction?,
        progress: TripProgress,
        routeMeters: Double,
        stepIndex: Int,
        now: Date = Date()
    ) -> OpenGravelGuidanceSnapshot {
        let primary = instruction?.primaryContent
        let type = primary?.maneuverType
        let modifier = primary?.maneuverModifier
        let text = primary?.text.trimmingCharacters(in: .whitespaces) ?? ""
        let road = text.isEmpty || type == .arrive ? "" : (text.count <= 48 ? "onto \(text)" : "")
        // Whole percents: iOS budgets Live Activity updates, so only a change
        // the rider could see is worth one.
        let along = routeMeters > 0 ? (min(1, max(0, 1 - progress.distanceRemaining / routeMeters)) * 100).rounded() / 100 : -1
        return OpenGravelGuidanceSnapshot(
            glyph: glyph(type: type, modifier: modifier),
            distance: distanceText(progress.distanceToNextManeuver),
            action: action(type: type, modifier: modifier),
            road: road,
            eta: etaText(seconds: progress.durationRemaining, now: now),
            remaining: remainingText(meters: progress.distanceRemaining, seconds: progress.durationRemaining),
            progress: along,
            stepIndex: stepIndex
        )
    }
}
