// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OpenGravelNavigation",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "OpenGravelNavigation", targets: ["OpenGravelNavigation"])
    ],
    dependencies: [
        // Pin releases: Ferrostar is pre-1.0 and its generated bindings may
        // change between releases.
        .package(
            url: "https://github.com/stadiamaps/ferrostar.git",
            exact: "0.57.0"
        )
    ],
    targets: [
        .target(
            name: "OpenGravelNavigation",
            dependencies: [
                .product(name: "FerrostarCore", package: "ferrostar"),
                .product(name: "FerrostarMapLibreUI", package: "ferrostar"),
                .product(name: "FerrostarSwiftUI", package: "ferrostar"),
                .product(name: "FerrostarCarPlayUI", package: "ferrostar")
            ]
        ),
        .testTarget(
            name: "OpenGravelNavigationTests",
            dependencies: ["OpenGravelNavigation"]
        )
    ]
)
