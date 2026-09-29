import FerrostarCore
import FerrostarCoreFFI

/// Ferrostar rerouting seam. The resolver must call OpenGravel's route authority
/// (or the OpenGravel offline engine) and return only routes that have already
/// passed OpenGravel eligibility/policy.
public final class OpenGravelRouteProvider: CustomRouteProvider {
    public typealias Resolver = (
        _ userLocation: UserLocation,
        _ remainingWaypoints: [Waypoint]
    ) async throws -> [Route]

    private let resolver: Resolver

    public init(resolver: @escaping Resolver) {
        self.resolver = resolver
    }

    public func getRoutes(
        userLocation: UserLocation,
        waypoints: [Waypoint]
    ) async throws -> [Route] {
        try await resolver(userLocation, waypoints)
    }
}
