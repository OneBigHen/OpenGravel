import Foundation

public enum OpenGravelNavigationPayloadError: Error, Equatable {
    case unsupportedSchema
    case unsupportedMode
    case invalidRouteIdentity
    case invalidMetric
    case invalidGeometry
    case geometryTooLarge
    case maneuverCountTooLarge
    case invalidManeuverOrder
    case maneuverBeyondRoute
}

public struct OpenGravelNavigationCoordinate: Codable, Equatable, Sendable {
    public let lat: Double
    public let lon: Double

    var isValid: Bool {
        lat.isFinite && lon.isFinite &&
            (-90.0 ... 90.0).contains(lat) &&
            (-180.0 ... 180.0).contains(lon)
    }
}

public enum OpenGravelNavigationManeuverKind: String, Codable, Sendable {
    case turn
    case `continue`
    case arrive
}

public enum OpenGravelNavigationTurn: String, Codable, Sendable {
    case left
    case right
    case slightLeft = "slight-left"
    case slightRight = "slight-right"
    case straight
    case uturn
}

public struct OpenGravelNavigationManeuver: Codable, Equatable, Sendable {
    public let id: String
    public let kind: OpenGravelNavigationManeuverKind
    public let maneuver: OpenGravelNavigationTurn?
    public let roadName: String?
    public let atDistanceMeters: Double
}

public struct OpenGravelRouteIdentity: Equatable, Sendable {
    public let routeId: String
    public let planningGeneration: Int
    public let fingerprint: String
}

public struct OpenGravelNavigationPayload: Codable, Equatable, Sendable {
    public static let supportedSchema = "native-navigation/v1"
    public static let supportedSchemaVersion = 1
    public static let supportedMode = "guided"
    public static let maxCoordinates = 50_000
    public static let maxManeuvers = 1_024

    public let schema: String
    public let schemaVersion: Int
    public let mode: String
    public let routeId: String
    public let planningGeneration: Int
    public let fingerprint: String
    public let title: String
    public let distanceMeters: Double
    public let durationSeconds: Double
    public let reroutePolicyVersion: String
    public let geometry: [OpenGravelNavigationCoordinate]
    public let maneuvers: [OpenGravelNavigationManeuver]

    public var identity: OpenGravelRouteIdentity {
        OpenGravelRouteIdentity(
            routeId: routeId,
            planningGeneration: planningGeneration,
            fingerprint: fingerprint
        )
    }

    public func validate() throws {
        guard schema == Self.supportedSchema, schemaVersion == Self.supportedSchemaVersion else {
            throw OpenGravelNavigationPayloadError.unsupportedSchema
        }
        guard mode == Self.supportedMode else {
            throw OpenGravelNavigationPayloadError.unsupportedMode
        }
        guard
            !routeId.isEmpty,
            planningGeneration >= 0,
            !fingerprint.isEmpty,
            !reroutePolicyVersion.isEmpty
        else {
            throw OpenGravelNavigationPayloadError.invalidRouteIdentity
        }
        guard
            distanceMeters.isFinite, distanceMeters >= 0,
            durationSeconds.isFinite, durationSeconds >= 0
        else {
            throw OpenGravelNavigationPayloadError.invalidMetric
        }
        guard geometry.count >= 2, geometry.allSatisfy(\.isValid) else {
            throw OpenGravelNavigationPayloadError.invalidGeometry
        }
        guard geometry.count <= Self.maxCoordinates else {
            throw OpenGravelNavigationPayloadError.geometryTooLarge
        }
        guard maneuvers.count <= Self.maxManeuvers else {
            throw OpenGravelNavigationPayloadError.maneuverCountTooLarge
        }

        var previousDistance = -1.0
        for maneuver in maneuvers {
            guard maneuver.atDistanceMeters.isFinite, maneuver.atDistanceMeters >= 0 else {
                throw OpenGravelNavigationPayloadError.invalidMetric
            }
            guard maneuver.atDistanceMeters >= previousDistance else {
                throw OpenGravelNavigationPayloadError.invalidManeuverOrder
            }
            if distanceMeters > 0, maneuver.atDistanceMeters > distanceMeters + 25 {
                throw OpenGravelNavigationPayloadError.maneuverBeyondRoute
            }
            previousDistance = maneuver.atDistanceMeters
        }
    }

    public static func decodeAndValidate(_ data: Data) throws -> OpenGravelNavigationPayload {
        let payload = try JSONDecoder().decode(OpenGravelNavigationPayload.self, from: data)
        try payload.validate()
        return payload
    }
}
