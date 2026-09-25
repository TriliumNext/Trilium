import { describe, expect, it } from "vitest";

import { isPublicHttpUrl } from "./public_url.js";

/** Resolves the names a test lists, and fails like DNS for any other. */
function lookupFrom(records: Record<string, string[]>) {
    return async (hostname: string) => {
        const addresses = records[hostname];
        if (!addresses) {
            throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
        }
        return addresses;
    };
}

const lookup = lookupFrom({
    "localhost": [ "::1", "127.0.0.1" ],
    "en.wikipedia.org": [ "185.15.59.224", "2a02:ec80:300:ed1a::1" ],
    "intranet.example": [ "10.0.0.5" ],
    "mixed.example": [ "93.184.215.14", "192.168.1.10" ],
    "rebind.example": [ "127.0.0.1" ]
});

describe("isPublicHttpUrl", () => {
    it("accepts an http(s) URL whose host has only public addresses", async () => {
        expect(await isPublicHttpUrl("https://en.wikipedia.org/wiki/Quantum_computing", lookup)).toBe(true);
        expect(await isPublicHttpUrl("http://93.184.215.14/", lookup)).toBe(true);
        expect(await isPublicHttpUrl("https://[2a02:ec80:300:ed1a::1]/", lookup)).toBe(true);
    });

    it("refuses other schemes and URLs that do not parse", async () => {
        for (const url of [ "file:///C:/data/antigravity-acp/acp_token.json", "ftp://en.wikipedia.org/", "data:text/plain,hi", "not a url" ]) {
            expect(await isPublicHttpUrl(url, lookup), url).toBe(false);
        }
    });

    it("refuses local, private and reserved addresses, however they are written", async () => {
        for (const url of [
            "http://localhost:8080/",
            "http://127.0.0.1:8080/",
            "http://2130706433/", // 127.0.0.1 as one number
            "http://0.0.0.0/",
            "http://10.1.2.3/",
            "http://172.16.0.1/",
            "http://192.168.1.1/",
            "http://100.64.0.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://224.0.0.1/",
            "http://[::1]/",
            "http://[fe80::1]/",
            "http://[fd00::1]/",
            "http://[::ffff:127.0.0.1]/"
        ]) {
            expect(await isPublicHttpUrl(url, lookup), url).toBe(false);
        }
    });

    it("refuses a name that resolves to any non-public address, or not at all", async () => {
        expect(await isPublicHttpUrl("https://intranet.example/", lookup)).toBe(false);
        expect(await isPublicHttpUrl("https://mixed.example/", lookup)).toBe(false);
        expect(await isPublicHttpUrl("https://rebind.example/", lookup)).toBe(false);
        expect(await isPublicHttpUrl("https://unknown.example/", lookup)).toBe(false);
    });

    it("resolves names with the system resolver by default", async () => {
        expect(await isPublicHttpUrl("http://localhost:8080/")).toBe(false);
    });
});
