// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OpenGravelSpotify",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "OpenGravelSpotify", targets: ["OpenGravelSpotify"])
    ],
    dependencies: [
        // The official release contains the SpotifyiOS.xcframework as an SPM
        // binary target. Keep it outside this repository; Xcode resolves it.
        .package(url: "https://github.com/spotify/ios-sdk.git", exact: "5.0.1")
    ],
    targets: [
        .target(
            name: "OpenGravelSpotify",
            dependencies: [
                .product(name: "SpotifyiOS", package: "ios-sdk")
            ]
        ),
        .testTarget(
            name: "OpenGravelSpotifyTests",
            dependencies: ["OpenGravelSpotify"]
        )
    ]
)
