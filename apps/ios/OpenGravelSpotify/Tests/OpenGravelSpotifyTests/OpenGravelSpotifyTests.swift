import XCTest
@testable import OpenGravelSpotify

final class OpenGravelSpotifyTests: XCTestCase {
    func testConfigurationRequiresClientIDAndRedirectURL() {
        XCTAssertNil(OpenGravelSpotifyConfiguration(clientID: nil, redirectURL: "opengravel://spotify-callback"))
        XCTAssertNil(OpenGravelSpotifyConfiguration(clientID: "client", redirectURL: nil))
        XCTAssertNotNil(OpenGravelSpotifyConfiguration(clientID: " client ", redirectURL: "opengravel://spotify-callback"))
    }

    func testDisconnectedSnapshotIsSafeDefault() {
        let snapshot = OpenGravelSpotifySnapshot.disconnected
        XCTAssertEqual(snapshot.connection, .disconnected)
        XCTAssertFalse(snapshot.isPlaying)
        XCTAssertNil(snapshot.track)
        XCTAssertNil(snapshot.errorMessage)
        XCTAssertEqual(snapshot.dictionary["connection"] as? String, "disconnected")
    }

    func testSnapshotDictionaryContainsTrackMetadataAndArtwork() {
        let snapshot = OpenGravelSpotifySnapshot(
            connection: .connected,
            isPlaying: true,
            track: OpenGravelSpotifyTrack(
                uri: "spotify:track:test",
                title: "Track",
                artist: "Artist",
                artworkBase64: "YQ=="
            )
        )

        let track = try! XCTUnwrap(snapshot.dictionary["track"] as? [String: Any])
        XCTAssertEqual(track["title"] as? String, "Track")
        XCTAssertEqual(track["artist"] as? String, "Artist")
        XCTAssertEqual(track["artworkBase64"] as? String, "YQ==")
    }

    func testLifecycleGuardsDuplicateActivationAndCompletesOneAttempt() {
        var lifecycle = OpenGravelSpotifyLifecycle()
        let firstAttempt = try! XCTUnwrap(lifecycle.beginConnection())
        XCTAssertNil(lifecycle.beginConnection())
        XCTAssertTrue(lifecycle.connectionAttemptInFlight)
        XCTAssertFalse(lifecycle.transportConnected)

        XCTAssertTrue(lifecycle.connectionEstablished())
        XCTAssertFalse(lifecycle.connectionAttemptInFlight)
        XCTAssertTrue(lifecycle.transportConnected)
        XCTAssertFalse(lifecycle.connectionEstablished())

        lifecycle.transportDisconnected()
        XCTAssertFalse(lifecycle.transportConnected)
        let secondAttempt = try! XCTUnwrap(lifecycle.beginConnection())
        XCTAssertGreaterThan(secondAttempt, firstAttempt)
    }

    func testColdPendingAuthorizationAcceptsOnlyTheRegisteredCallback() {
        var lifecycle = OpenGravelSpotifyLifecycle(pendingAuthorization: true)
        XCTAssertTrue(lifecycle.wantsConnection)
        XCTAssertTrue(lifecycle.authorizationPending)
        XCTAssertNil(lifecycle.beginConnection())
        XCTAssertTrue(lifecycle.acceptAuthorizationCallback())
        XCTAssertTrue(lifecycle.authorizationSucceeded(for: lifecycle.attemptID))
        XCTAssertFalse(lifecycle.authorizationPending)
        XCTAssertTrue(lifecycle.connectionEstablished())
        XCTAssertFalse(lifecycle.acceptAuthorizationCallback())
    }

    func testExplicitDisconnectInvalidatesLateAuthorizationAndPlayerCallbacks() {
        var lifecycle = OpenGravelSpotifyLifecycle()
        let staleAttempt = try! XCTUnwrap(lifecycle.beginConnection())
        lifecycle.markAuthorizationPending()
        lifecycle.disconnect()

        XCTAssertFalse(lifecycle.wantsConnection)
        XCTAssertFalse(lifecycle.authorizationPending)
        XCTAssertFalse(lifecycle.authorizationSucceeded(for: staleAttempt))
        XCTAssertFalse(lifecycle.connectionEstablished())
        XCTAssertFalse(lifecycle.acceptsPlayerState())
        XCTAssertNotNil(lifecycle.beginConnection())
    }

    func testCancelledAuthorizationCannotCompleteAReplacementAttempt() {
        var lifecycle = OpenGravelSpotifyLifecycle()
        let firstAttempt = try! XCTUnwrap(lifecycle.beginConnection())
        lifecycle.markAuthorizationPending()
        lifecycle.disconnect()
        let replacementAttempt = try! XCTUnwrap(lifecycle.beginConnection())
        lifecycle.markAuthorizationPending()

        XCTAssertNotEqual(firstAttempt, replacementAttempt)
        XCTAssertFalse(lifecycle.authorizationSucceeded(for: firstAttempt))
        XCTAssertTrue(lifecycle.authorizationSucceeded(for: replacementAttempt))
    }

    func testAuthorizationAttemptRemainsPendingUntilCallback() {
        var lifecycle = OpenGravelSpotifyLifecycle()
        XCTAssertNotNil(lifecycle.beginConnection())
        lifecycle.markAuthorizationPending()
        XCTAssertTrue(lifecycle.authorizationPending)
        XCTAssertFalse(lifecycle.transportConnected)
    }
}
