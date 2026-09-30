import Foundation
import UIKit
@preconcurrency import SpotifyiOS

public enum OpenGravelSpotifyConnection: String, Equatable, Sendable {
    case unavailable
    case disconnected
    case connecting
    case connected
    case error
}

public struct OpenGravelSpotifyTrack: Equatable, Sendable {
    public let uri: String
    public let title: String
    public let artist: String
    public let artworkBase64: String?

    public init(uri: String, title: String, artist: String, artworkBase64: String? = nil) {
        self.uri = uri
        self.title = title
        self.artist = artist
        self.artworkBase64 = artworkBase64
    }
}

public struct OpenGravelSpotifySnapshot: Equatable, Sendable {
    public let connection: OpenGravelSpotifyConnection
    public let isPlaying: Bool
    public let track: OpenGravelSpotifyTrack?
    public let errorMessage: String?

    public init(
        connection: OpenGravelSpotifyConnection,
        isPlaying: Bool = false,
        track: OpenGravelSpotifyTrack? = nil,
        errorMessage: String? = nil
    ) {
        self.connection = connection
        self.isPlaying = isPlaying
        self.track = track
        self.errorMessage = errorMessage
    }

    public static let disconnected = OpenGravelSpotifySnapshot(connection: .disconnected)

    public var dictionary: [String: Any] {
        var result: [String: Any] = [
            "connection": connection.rawValue,
            "isPlaying": isPlaying,
        ]
        if let track {
            result["track"] = [
                "uri": track.uri,
                "title": track.title,
                "artist": track.artist,
                "artworkBase64": track.artworkBase64 as Any,
            ]
        } else {
            result["track"] = NSNull()
        }
        if let errorMessage {
            result["errorMessage"] = errorMessage
        } else {
            result["errorMessage"] = NSNull()
        }
        return result
    }
}

public struct OpenGravelSpotifyConfiguration: Equatable, Sendable {
    public let clientID: String
    public let redirectURL: URL

    public init?(clientID: String?, redirectURL: String?) {
        guard let clientID = clientID?.trimmingCharacters(in: .whitespacesAndNewlines),
              !clientID.isEmpty,
              let redirectURL = redirectURL.flatMap(URL.init(string:)),
              redirectURL.scheme != nil
        else { return nil }
        self.clientID = clientID
        self.redirectURL = redirectURL
    }
}

/// Owns the connection intent separately from SDK callback timing. The SDK can
/// deliver callbacks after an explicit disconnect, and a scene activation can
/// happen repeatedly while authorization is still pending.
public struct OpenGravelSpotifyLifecycle: Equatable, Sendable {
    public private(set) var wantsConnection: Bool
    public private(set) var authorizationPending: Bool
    public private(set) var connectionAttemptInFlight: Bool
    public private(set) var transportConnected: Bool
    public private(set) var attemptID: UInt

    public init(pendingAuthorization: Bool = false) {
        wantsConnection = pendingAuthorization
        authorizationPending = pendingAuthorization
        connectionAttemptInFlight = pendingAuthorization
        transportConnected = false
        attemptID = pendingAuthorization ? 1 : 0
    }

    /// Starts one user or foreground connection attempt. Repeated activation
    /// while the same attempt is pending is intentionally a no-op.
    @discardableResult
    public mutating func beginConnection() -> UInt? {
        wantsConnection = true
        guard !connectionAttemptInFlight else { return nil }
        attemptID &+= 1
        connectionAttemptInFlight = true
        transportConnected = false
        return attemptID
    }

    public mutating func markAuthorizationPending() {
        guard wantsConnection, connectionAttemptInFlight else { return }
        authorizationPending = true
    }

    @discardableResult
    public mutating func acceptAuthorizationCallback() -> Bool {
        wantsConnection && authorizationPending && connectionAttemptInFlight
    }

    @discardableResult
    public mutating func authorizationSucceeded(for attemptID: UInt) -> Bool {
        guard wantsConnection,
              authorizationPending,
              connectionAttemptInFlight,
              self.attemptID == attemptID
        else { return false }
        authorizationPending = false
        return true
    }

    @discardableResult
    public mutating func connectionEstablished() -> Bool {
        guard wantsConnection, connectionAttemptInFlight else { return false }
        authorizationPending = false
        connectionAttemptInFlight = false
        transportConnected = true
        return true
    }

    @discardableResult
    public mutating func connectionFailed() -> Bool {
        guard wantsConnection, connectionAttemptInFlight else { return false }
        authorizationPending = false
        connectionAttemptInFlight = false
        transportConnected = false
        return true
    }

    /// The transport can disappear during backgrounding. Keep the rider's
    /// intent and an in-flight authorization alive, but allow a fresh App
    /// Remote attempt when the cached session was already authorized.
    public mutating func transportDisconnected() {
        transportConnected = false
        if !authorizationPending { connectionAttemptInFlight = false }
    }

    public func acceptsPlayerState() -> Bool {
        wantsConnection && transportConnected
    }

    /// Explicit disconnect invalidates the current lifecycle generation, so
    /// callbacks already queued by the SDK cannot revive the player.
    public mutating func disconnect() {
        wantsConnection = false
        authorizationPending = false
        connectionAttemptInFlight = false
        transportConnected = false
        attemptID &+= 1
    }
}

/// A small main-thread App Remote controller. Spotify remains an optional
/// companion app: this object never owns navigation, recording, or ride state.
@MainActor
public final class OpenGravelSpotifyRemote: NSObject {
    public static let shared = OpenGravelSpotifyRemote(configuration: .fromMainBundle())

    public private(set) var snapshot: OpenGravelSpotifySnapshot
    public var onSnapshot: ((OpenGravelSpotifySnapshot) -> Void)?

    private let configuration: OpenGravelSpotifyConfiguration?
    private var appRemote: SPTAppRemote?
    private var sessionManager: SPTSessionManager?
    private var lifecycle: OpenGravelSpotifyLifecycle
    private var lastTrackURI: String?
    private var activeAuthorizationAttemptID: UInt?
    private static let pendingAuthorizationKey = "OpenGravelSpotify.pendingAuthorization"

    public init(configuration: OpenGravelSpotifyConfiguration?) {
        self.configuration = configuration
        let pendingAuthorization = configuration != nil && UserDefaults.standard.bool(forKey: Self.pendingAuthorizationKey)
        self.lifecycle = OpenGravelSpotifyLifecycle(pendingAuthorization: pendingAuthorization)
        self.activeAuthorizationAttemptID = pendingAuthorization ? 1 : nil
        self.snapshot = configuration == nil
            ? OpenGravelSpotifySnapshot(connection: .unavailable)
            : OpenGravelSpotifySnapshot(connection: pendingAuthorization ? .connecting : .disconnected)
        super.init()

        guard let configuration else { return }
        let spotifyConfiguration = SPTConfiguration(
            clientID: configuration.clientID,
            redirectURL: configuration.redirectURL
        )
        appRemote = SPTAppRemote(configuration: spotifyConfiguration, logLevel: .error)
        appRemote?.delegate = self
        sessionManager = SPTSessionManager(configuration: spotifyConfiguration, delegate: self)
    }

    public var isAvailable: Bool { configuration != nil }

    public func connect() {
        guard let manager = sessionManager ?? makeSessionManager() else {
            publish(OpenGravelSpotifySnapshot(connection: .unavailable))
            return
        }
        sessionManager = manager
        guard let attemptID = lifecycle.beginConnection() else { return }
        let appRemote = appRemote ?? makeAppRemote()
        guard let appRemote else {
            _ = lifecycle.connectionFailed()
            persistAuthorizationPending()
            publish(OpenGravelSpotifySnapshot(connection: .unavailable))
            return
        }
        if appRemote.isConnected {
            guard lifecycle.connectionEstablished() else { return }
            configurePlayerAPI(appRemote)
            return
        }
        publish(OpenGravelSpotifySnapshot(connection: .connecting))
        if let session = manager.session, !session.isExpired {
            appRemote.connectionParameters.accessToken = session.accessToken
            appRemote.connect()
        } else {
            // Client-only keeps authorization in the Spotify app. It fails
            // cleanly when Spotify is not installed and never opens web OAuth.
            lifecycle.markAuthorizationPending()
            activeAuthorizationAttemptID = attemptID
            resetSessionManager()
            guard let authorizationManager = sessionManager else {
                _ = lifecycle.connectionFailed()
                persistAuthorizationPending()
                return
            }
            authorizationManager.delegate = self
            persistAuthorizationPending()
            authorizationManager.initiateSession(with: .appRemoteControl, options: .clientOnly, campaign: nil)
        }
    }

    public func disconnect() {
        lifecycle.disconnect()
        activeAuthorizationAttemptID = nil
        persistAuthorizationPending()
        appRemote?.disconnect()
        appRemote = nil
        resetSessionManager()
        lastTrackURI = nil
        publish(.disconnected)
    }

    public func togglePlayPause() {
        guard let playerAPI = appRemote?.playerAPI, snapshot.connection == .connected else { return }
        let callback: SPTAppRemoteCallback = { [weak self] _, error in
            guard let error else { return }
            self?.publishError(error)
        }
        if snapshot.isPlaying {
            playerAPI.pause(callback)
        } else {
            playerAPI.resume(callback)
        }
    }

    public func skipToNext() {
        guard let playerAPI = appRemote?.playerAPI, snapshot.connection == .connected else { return }
        playerAPI.skip(toNext: callbackForCommand)
    }

    public func skipToPrevious() {
        guard let playerAPI = appRemote?.playerAPI, snapshot.connection == .connected else { return }
        playerAPI.skip(toPrevious: callbackForCommand)
    }

    public func openSpotify() {
        guard let url = URL(string: "spotify://") else { return }
        UIApplication.shared.open(url, options: [:])
    }

    @discardableResult
    public func handleOpenURL(_ url: URL) -> Bool {
        guard let sessionManager else { return false }
        guard lifecycle.acceptAuthorizationCallback() else { return false }
        return sessionManager.application(UIApplication.shared, open: url, options: [:])
    }

    public func sceneWillResignActive() {
        guard lifecycle.wantsConnection else { return }
        // Invalidate player callbacks before asking the SDK to disconnect; the
        // SDK may deliver one synchronously while tearing its transport down.
        lifecycle.transportDisconnected()
        appRemote?.disconnect()
        appRemote = nil
    }

    public func sceneDidBecomeActive() {
        guard lifecycle.wantsConnection else { return }
        connect()
    }

    private func makeAppRemote() -> SPTAppRemote? {
        guard let configuration else { return nil }
        let spotifyConfiguration = SPTConfiguration(
            clientID: configuration.clientID,
            redirectURL: configuration.redirectURL
        )
        let remote = SPTAppRemote(configuration: spotifyConfiguration, logLevel: .error)
        remote.delegate = self
        appRemote = remote
        return remote
    }

    private func makeSessionManager() -> SPTSessionManager? {
        guard let configuration else { return nil }
        let spotifyConfiguration = SPTConfiguration(
            clientID: configuration.clientID,
            redirectURL: configuration.redirectURL
        )
        return SPTSessionManager(configuration: spotifyConfiguration, delegate: self)
    }

    private func resetSessionManager() {
        sessionManager?.delegate = nil
        sessionManager = makeSessionManager()
    }

    private func isCurrentSessionManager(_ manager: SPTSessionManager) -> Bool {
        guard let sessionManager else { return false }
        return sessionManager === manager
    }

    private func persistAuthorizationPending() {
        UserDefaults.standard.set(lifecycle.authorizationPending, forKey: Self.pendingAuthorizationKey)
    }

    private func isCurrentAppRemote(_ remote: SPTAppRemote) -> Bool {
        guard let appRemote else { return false }
        return appRemote === remote
    }

    private lazy var callbackForCommand: SPTAppRemoteCallback = { [weak self] _, error in
        guard let error else { return }
        self?.publishError(error)
    }

    private func configurePlayerAPI(_ appRemote: SPTAppRemote) {
        guard let playerAPI = appRemote.playerAPI else { return }
        playerAPI.delegate = self
        playerAPI.subscribe(toPlayerState: { [weak self] _, error in
            if let error { self?.publishError(error) }
        })
        playerAPI.getPlayerState { [weak self] result, error in
            if let error {
                self?.publishError(error)
            } else if let playerState = result as? SPTAppRemotePlayerState {
                self?.apply(playerState: playerState)
            }
        }
    }

    private func apply(playerState: SPTAppRemotePlayerState) {
        guard lifecycle.acceptsPlayerState() else { return }
        let trackURI = playerState.track.uri
        let track = OpenGravelSpotifyTrack(
            uri: trackURI,
            title: playerState.track.name,
            artist: playerState.track.artist.name,
            artworkBase64: nil
        )
        lastTrackURI = trackURI
        publish(OpenGravelSpotifySnapshot(
            connection: .connected,
            isPlaying: !playerState.isPaused,
            track: track
        ))

        appRemote?.imageAPI?.fetchImage(forItem: playerState.track, with: CGSize(width: 256, height: 256)) {
            [weak self] image, error in
            guard let self else { return }
            guard self.lifecycle.acceptsPlayerState() else { return }
            if let error {
                self.publishError(error, preservePlayback: true)
                return
            }
            guard let image = image as? UIImage,
                  let data = image.jpegData(compressionQuality: 0.8),
                  self.lastTrackURI == trackURI
            else { return }
            let updatedTrack = OpenGravelSpotifyTrack(
                uri: track.uri,
                title: track.title,
                artist: track.artist,
                artworkBase64: data.base64EncodedString()
            )
            self.publish(OpenGravelSpotifySnapshot(
                connection: .connected,
                isPlaying: self.snapshot.isPlaying,
                track: updatedTrack
            ))
        }
    }

    private func publish(_ next: OpenGravelSpotifySnapshot) {
        snapshot = next
        onSnapshot?(next)
    }

    private func publishError(_ error: Error, preservePlayback: Bool = false) {
        guard lifecycle.wantsConnection else { return }
        let current = preservePlayback ? snapshot : OpenGravelSpotifySnapshot(connection: .error)
        publish(OpenGravelSpotifySnapshot(
            connection: current.connection == .connected ? .connected : .error,
            isPlaying: current.isPlaying,
            track: current.track,
            errorMessage: error.localizedDescription
        ))
    }
}

private extension OpenGravelSpotifyConfiguration {
    static func fromMainBundle() -> OpenGravelSpotifyConfiguration? {
        OpenGravelSpotifyConfiguration(
            clientID: Bundle.main.object(forInfoDictionaryKey: "OGVSpotifyClientID") as? String,
            redirectURL: Bundle.main.object(forInfoDictionaryKey: "OGVSpotifyRedirectURI") as? String
        )
    }
}

@MainActor
extension OpenGravelSpotifyRemote: SPTAppRemoteDelegate {
    public func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        guard isCurrentAppRemote(appRemote), lifecycle.connectionEstablished() else { return }
        persistAuthorizationPending()
        publish(OpenGravelSpotifySnapshot(connection: .connected))
        configurePlayerAPI(appRemote)
    }

    public func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
        guard isCurrentAppRemote(appRemote), lifecycle.connectionFailed() else { return }
        activeAuthorizationAttemptID = nil
        resetSessionManager()
        persistAuthorizationPending()
        publish(error.map { OpenGravelSpotifySnapshot(connection: .error, errorMessage: $0.localizedDescription) } ?? .disconnected)
    }

    public func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
        guard isCurrentAppRemote(appRemote) else { return }
        lastTrackURI = nil
        lifecycle.transportDisconnected()
        self.appRemote = nil
        if lifecycle.wantsConnection, let error {
            publish(OpenGravelSpotifySnapshot(connection: .error, errorMessage: error.localizedDescription))
        } else {
            publish(.disconnected)
        }
    }
}

@MainActor
extension OpenGravelSpotifyRemote: SPTAppRemotePlayerStateDelegate {
    public func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
        apply(playerState: playerState)
    }
}

@MainActor
extension OpenGravelSpotifyRemote: SPTSessionManagerDelegate {
    public func sessionManager(manager: SPTSessionManager, didInitiate session: SPTSession) {
        guard isCurrentSessionManager(manager),
              let activeAuthorizationAttemptID,
              activeAuthorizationAttemptID == lifecycle.attemptID,
              lifecycle.authorizationSucceeded(for: activeAuthorizationAttemptID)
        else { return }
        self.activeAuthorizationAttemptID = nil
        persistAuthorizationPending()
        guard let appRemote = appRemote ?? makeAppRemote() else {
            _ = lifecycle.connectionFailed()
            persistAuthorizationPending()
            return
        }
        appRemote.connectionParameters.accessToken = session.accessToken
        appRemote.connect()
    }

    public func sessionManager(manager: SPTSessionManager, didRenew session: SPTSession) {
        guard isCurrentSessionManager(manager), lifecycle.wantsConnection, !session.isExpired else { return }
        // A renewal can arrive after backgrounding discarded the old remote.
        // Recreate it before claiming a new attempt so an optional-chain no-op
        // cannot leave the lifecycle permanently marked as in flight.
        if appRemote == nil, lifecycle.connectionAttemptInFlight { return }
        guard let appRemote = appRemote ?? makeAppRemote() else {
            _ = lifecycle.connectionFailed()
            persistAuthorizationPending()
            return
        }
        appRemote.connectionParameters.accessToken = session.accessToken
        guard !appRemote.isConnected, lifecycle.beginConnection() != nil else { return }
        appRemote.connect()
    }

    public func sessionManager(manager: SPTSessionManager, didFailWith error: Error) {
        guard isCurrentSessionManager(manager), lifecycle.connectionFailed() else { return }
        activeAuthorizationAttemptID = nil
        resetSessionManager()
        persistAuthorizationPending()
        publish(OpenGravelSpotifySnapshot(connection: .error, errorMessage: error.localizedDescription))
    }
}
