// swift-tools-version:5.9
import PackageDescription

// Unit tests for the iOS request bridge's logic, which the App target compiles from
// Sources/RequestBroker/RequestBroker.swift. It imports no WebKit, so `swift test` also runs on
// Linux.
let package = Package(
    name: "RequestBroker",
    targets: [
        .target(name: "RequestBroker"),
        .testTarget(name: "RequestBrokerTests", dependencies: ["RequestBroker"])
    ]
)
