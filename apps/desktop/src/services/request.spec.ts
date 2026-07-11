import { afterEach, describe, expect, it, vi } from "vitest";

const netSentinel = { request: () => ({ on() {}, end() {} }) };
const isReady = vi.fn(() => true);
const whenReady = vi.fn(() => Promise.resolve());

vi.mock("electron", () => ({
    default: {
        net: netSentinel,
        app: {
            isReady: () => isReady(),
            whenReady: () => whenReady()
        }
    }
}));

const { default: ElectronRequestProvider } = await import("./request.js");

// `getClient` is protected; expose it through a thin subclass for testing.
class TestableProvider extends ElectronRequestProvider {
    public getClientPublic(opts: Parameters<TestableProvider["getClient"]>[0]) {
        return this.getClient(opts);
    }
}

describe("ElectronRequestProvider", () => {
    const provider = new TestableProvider();

    afterEach(() => {
        vi.clearAllMocks();
        isReady.mockReturnValue(true);
    });

    it("uses electron.net for proxyless requests once the app is ready", async () => {
        isReady.mockReturnValue(true);
        const client = await provider.getClientPublic({ method: "GET", url: "https://example.com" });
        expect(client).toBe(netSentinel);
        expect(whenReady).not.toHaveBeenCalled();
    });

    it("awaits app readiness before returning electron.net when not yet ready", async () => {
        isReady.mockReturnValue(false);
        const client = await provider.getClientPublic({ method: "GET", url: "https://example.com" });
        expect(client).toBe(netSentinel);
        expect(whenReady).toHaveBeenCalledOnce();
    });

    it("falls through to Node http(s) when an explicit proxy is configured", async () => {
        const client = await provider.getClientPublic({
            method: "GET",
            url: "https://example.com",
            proxy: "http://127.0.0.1:8888"
        });
        expect(client).not.toBe(netSentinel);
        expect(typeof client.request).toBe("function");
    });
});
