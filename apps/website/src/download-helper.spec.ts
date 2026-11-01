import { afterEach, describe, expect, it, vi } from "vitest";
import { getArchitecture, getPlatform } from "./download-helper";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function mockBrowser({ userAgent, architecture, renderer }: { userAgent: string, architecture?: string, renderer?: string }) {
    vi.stubGlobal("navigator", {
        userAgent,
        userAgentData: architecture !== undefined
            ? { getHighEntropyValues: () => Promise.resolve({ architecture }) }
            : undefined
    });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => (renderer !== undefined ? {
        RENDERER: 0x1f01,
        getExtension: () => null,
        getParameter: () => renderer
    } : null) as never);
}

describe("getPlatform", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("detects the platform from the user agent", () => {
        mockBrowser({ userAgent: MAC_UA });
        expect(getPlatform()).toBe("macos");

        mockBrowser({ userAgent: WINDOWS_UA });
        expect(getPlatform()).toBe("windows");

        mockBrowser({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0" });
        expect(getPlatform()).toBe("linux");
    });
});

describe("getArchitecture", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("detects Apple Silicon on browsers without client hints", async () => {
        // Safari and Firefox report an Intel user agent on every Mac.
        mockBrowser({ userAgent: MAC_UA, renderer: "Apple GPU" });
        expect(await getArchitecture()).toBe("arm64");

        mockBrowser({ userAgent: MAC_UA, renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)" });
        expect(await getArchitecture()).toBe("arm64");
    });

    it("detects Apple Silicon even when the browser runs under Rosetta", async () => {
        mockBrowser({ userAgent: MAC_UA, architecture: "x86", renderer: "Apple M1" });
        expect(await getArchitecture()).toBe("arm64");
    });

    it("detects Intel Macs", async () => {
        mockBrowser({ userAgent: MAC_UA, renderer: "Intel(R) Iris(TM) Plus Graphics 640" });
        expect(await getArchitecture()).toBe("x64");

        mockBrowser({ userAgent: MAC_UA, architecture: "x86", renderer: "AMD Radeon Pro 5500M OpenGL Engine" });
        expect(await getArchitecture()).toBe("x64");
    });

    it("falls back to client hints and the user agent", async () => {
        mockBrowser({ userAgent: WINDOWS_UA, architecture: "arm" });
        expect(await getArchitecture()).toBe("arm64");

        mockBrowser({ userAgent: WINDOWS_UA, architecture: "x86" });
        expect(await getArchitecture()).toBe("x64");

        mockBrowser({ userAgent: "Mozilla/5.0 (X11; Linux aarch64; rv:126.0) Gecko/20100101 Firefox/126.0" });
        expect(await getArchitecture()).toBe("arm64");

        mockBrowser({ userAgent: WINDOWS_UA });
        expect(await getArchitecture()).toBe("x64");
    });

    it("assumes Apple Silicon for a Mac it cannot identify", async () => {
        // WebGL unavailable, no client hints.
        mockBrowser({ userAgent: MAC_UA });
        expect(await getArchitecture()).toBe("arm64");

        // A virtualised GPU names neither an Apple nor an Intel chip.
        mockBrowser({ userAgent: MAC_UA, renderer: "Apple Paravirtual device" });
        expect(await getArchitecture()).toBe("arm64");

        // Client hints rejected by permissions policy.
        vi.stubGlobal("navigator", {
            userAgent: MAC_UA,
            userAgentData: { getHighEntropyValues: () => Promise.reject(new Error("NotAllowedError")) }
        });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
        expect(await getArchitecture()).toBe("arm64");
    });
});
