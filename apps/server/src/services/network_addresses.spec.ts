import { describe, expect, it } from "vitest";

import {
    buildNetworkUrl, collectNetworkAddresses, isHostReachableOnNetwork, listListeningUrls
} from "./network_addresses.js";

type NetworkInterfaces = Parameters<typeof collectNetworkAddresses>[0];

describe("collectNetworkAddresses", () => {
    it("drops internal and scope-bound IPv6 addresses, then sorts by LAN likelihood", () => {
        const interfaces = {
            lo: [{ address: "127.0.0.1", internal: true, family: "IPv4" }],
            eth0: [
                { address: "203.0.113.5", internal: false, family: "IPv4" },
                { address: "192.168.1.20", internal: false, family: "IPv4" },
                { address: "10.0.0.4", internal: false, family: "IPv4" },
                { address: "172.16.0.9", internal: false, family: "IPv4" },
                { address: "fe80::1", internal: false, family: "IPv6", scopeid: 4 },
                { address: "fd00::1", internal: false, family: "IPv6", scopeid: 0 }
            ]
        } as unknown as NetworkInterfaces;

        expect(collectNetworkAddresses(interfaces)).toEqual([
            "192.168.1.20", // 192.168.* ranks first
            "10.0.0.4",     // then 10.*
            "172.16.0.9",   // then 172.16–31.* private range
            "203.0.113.5",  // then other IPv4
            "fd00::1"       // IPv6 last; fe80::1 dropped (scopeid !== 0)
        ]);
    });

    it("returns an empty list when no usable interfaces exist", () => {
        expect(collectNetworkAddresses({})).toEqual([]);
        expect(collectNetworkAddresses({ lo: undefined } as unknown as NetworkInterfaces)).toEqual([]);
    });
});

describe("buildNetworkUrl", () => {
    it("builds a URL with the given protocol and port", () => {
        expect(buildNetworkUrl("http", "192.168.1.20", 37840)).toBe("http://192.168.1.20:37840");
        expect(buildNetworkUrl("https", "10.0.0.4", 8080)).toBe("https://10.0.0.4:8080");
    });

    it("wraps IPv6 literals in brackets", () => {
        expect(buildNetworkUrl("http", "fd00::1", 37840)).toBe("http://[fd00::1]:37840");
    });
});

describe("isHostReachableOnNetwork", () => {
    it("treats loopback bindings as unreachable", () => {
        expect(isHostReachableOnNetwork("127.0.0.1")).toBe(false);
        expect(isHostReachableOnNetwork("127.1.2.3")).toBe(false);
        expect(isHostReachableOnNetwork("localhost")).toBe(false);
        expect(isHostReachableOnNetwork("::1")).toBe(false);
        expect(isHostReachableOnNetwork(" LOCALHOST ")).toBe(false);
    });

    it("treats wildcard and specific interfaces as reachable", () => {
        expect(isHostReachableOnNetwork("0.0.0.0")).toBe(true);
        expect(isHostReachableOnNetwork("::")).toBe(true);
        expect(isHostReachableOnNetwork("192.168.1.20")).toBe(true);
    });
});

describe("listListeningUrls", () => {
    const interfaces = {
        lo: [{ address: "127.0.0.1", internal: true, family: "IPv4" }],
        eth0: [
            { address: "10.0.0.4", internal: false, family: "IPv4" },
            { address: "192.168.1.20", internal: false, family: "IPv4" },
            { address: "fd00::1", internal: false, family: "IPv6", scopeid: 0 }
        ]
    } as unknown as NetworkInterfaces;

    it("lists localhost and the LAN addresses for a wildcard host", () => {
        expect(listListeningUrls("http", "0.0.0.0", 8080, interfaces)).toEqual({
            local: "http://localhost:8080",
            network: ["http://192.168.1.20:8080", "http://10.0.0.4:8080"]
        });
        expect(listListeningUrls("https", "::", 8443, interfaces)).toEqual({
            local: "https://localhost:8443",
            network: ["https://192.168.1.20:8443", "https://10.0.0.4:8443", "https://[fd00::1]:8443"]
        });
    });

    it("lists only the configured address for a loopback or specific host", () => {
        expect(listListeningUrls("http", "127.0.0.1", 8080, interfaces)).toEqual({
            local: "http://127.0.0.1:8080",
            network: []
        });
        expect(listListeningUrls("http", "::1", 8080, interfaces)).toEqual({
            local: "http://[::1]:8080",
            network: []
        });
        expect(listListeningUrls("http", "10.0.0.4", 8080, interfaces)).toEqual({
            local: undefined,
            network: ["http://10.0.0.4:8080"]
        });
    });
});
