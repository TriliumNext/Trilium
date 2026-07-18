import { afterEach, describe, expect, it, vi } from "vitest";

import { capacitorHttpHandler, resetNativeProxyProbeForTests } from "./capacitor_http_handler.js";

interface CapacitorWindow {
    Capacitor?: unknown;
}

type RequestMock = ReturnType<typeof vi.fn>;

/**
 * Models the bridge surface the handler touches: the plugin transport is stock CapacitorHttp
 * (registered by @capacitor/core itself, so it lives in `Plugins`), and `getPlatform()`
 * gates the streaming proxy to Android.
 */
function installCapacitor({ capacitorHttp, platform }: { capacitorHttp?: RequestMock; platform?: string } = {}) {
    const plugins: Record<string, { request: RequestMock }> = {};
    if (capacitorHttp) {
        plugins.CapacitorHttp = { request: capacitorHttp };
    }

    (window as unknown as CapacitorWindow).Capacitor = {
        Plugins: plugins,
        ...(platform ? { getPlatform: () => platform } : {})
    };
}

/** The minimal Response surface the handler touches, with fetch()'s lowercase header keys. */
function fakeResponse({ status = 200, headers = {}, body = "" }: { status?: number; headers?: Record<string, string>; body?: string }): Response {
    const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: (key: string) => map.get(key.toLowerCase()) ?? null,
            forEach: (callback: (value: string, key: string) => void) => map.forEach(callback)
        },
        text: () => Promise.resolve(body)
    } as unknown as Response;
}

describe("capacitorHttpHandler", () => {
    afterEach(() => {
        delete (window as unknown as CapacitorWindow).Capacitor;
        resetNativeProxyProbeForTests();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("throws when no native HTTP plugin is available", async () => {
        installCapacitor();
        await expect(
            capacitorHttpHandler({ method: "GET", url: "https://x", headers: {} })
        ).rejects.toThrow("No native HTTP plugin is available");
    });

    it("forwards the request to CapacitorHttp and returns a string body unchanged", async () => {
        const capacitorHttp = vi.fn().mockResolvedValue({
            status: 200,
            headers: { "Content-Type": "application/json", "X-Custom": "v" },
            data: '{"ok":true}'
        });
        installCapacitor({ capacitorHttp });

        const result = await capacitorHttpHandler({
            method: "POST",
            url: "https://api/test",
            headers: { Authorization: "token" },
            body: "{}"
        });

        expect(capacitorHttp).toHaveBeenCalledWith({
            method: "POST",
            url: "https://api/test",
            headers: { Authorization: "token" },
            data: "{}",
            responseType: "text"
        });
        expect(result.status).toBe(200);
        expect(result.headers).toEqual({ "content-type": "application/json", "x-custom": "v" });
        expect(result.body).toBe('{"ok":true}');
    });

    it("passes parsed object response data through via structured clone (no re-serialization)", async () => {
        const capacitorHttp = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });
        installCapacitor({ capacitorHttp });

        const result = await capacitorHttpHandler({ method: "GET", url: "https://x", headers: {} });
        // CapacitorHttp pre-parses JSON; the handler hands the object straight to the worker via
        // structured clone (no intermediate string) rather than re-serializing it to `body`.
        expect(result.data).toEqual({ ok: true });
        expect(result.body).toBeUndefined();
    });

    it("passes arraybuffer responses through as the raw base64 string", async () => {
        const capacitorHttp = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: "QUJD" });
        installCapacitor({ capacitorHttp });

        const result = await capacitorHttpHandler({
            method: "GET",
            url: "https://x/image",
            headers: {},
            responseType: "arraybuffer"
        });
        expect(result.body).toBe("QUJD");
    });

    describe("native streaming proxy", () => {
        it("streams GET text requests through the proxy with tunneled headers, probing only once", async () => {
            const capacitorHttp = vi.fn();
            installCapacitor({ capacitorHttp, platform: "android" });
            const fetchMock = vi.fn()
                .mockResolvedValueOnce(fakeResponse({ headers: { "x-trilium-native-http": "1" }, body: "pong" }))
                .mockResolvedValueOnce(fakeResponse({
                    headers: { "Content-Type": "application/json", "x-trilium-set-cookie": "sid=next" },
                    body: '{"ok":true}'
                }))
                .mockResolvedValueOnce(fakeResponse({ body: "second" }));
            vi.stubGlobal("fetch", fetchMock);

            const url = "https://sync.example.com/api/sync/changed?lastEntityChangeId=5";
            const result = await capacitorHttpHandler({
                method: "GET",
                url,
                headers: { Cookie: "sid=current", pageCount: "1" }
            });

            expect(fetchMock).toHaveBeenNthCalledWith(1, "/_trilium_native_http/ping", { cache: "no-store" });
            expect(fetchMock).toHaveBeenNthCalledWith(2,
                `/_trilium_native_http/fetch?url=${encodeURIComponent(url)}`,
                {
                    method: "GET",
                    headers: { "x-trilium-h-Cookie": "sid=current", "x-trilium-h-pageCount": "1" },
                    cache: "no-store"
                });
            expect(result.status).toBe(200);
            expect(result.body).toBe('{"ok":true}');
            // Set-Cookie is unreadable through fetch(), so it arrives renamed and is mapped back.
            expect(result.headers["set-cookie"]).toBe("sid=next");
            expect(result.headers["x-trilium-set-cookie"]).toBeUndefined();
            expect(capacitorHttp).not.toHaveBeenCalled();

            // The availability probe is cached — a second request goes straight to /fetch.
            await capacitorHttpHandler({ method: "GET", url, headers: {} });
            expect(fetchMock).toHaveBeenCalledTimes(3);
        });

        it("keeps POSTs and binary requests on the plugin transport", async () => {
            const capacitorHttp = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: "ok" });
            installCapacitor({ capacitorHttp, platform: "android" });
            const fetchMock = vi.fn();
            vi.stubGlobal("fetch", fetchMock);

            await capacitorHttpHandler({ method: "POST", url: "https://x", headers: {}, body: "{}" });
            await capacitorHttpHandler({ method: "GET", url: "https://x/image", headers: {}, responseType: "arraybuffer" });

            expect(fetchMock).not.toHaveBeenCalled();
            expect(capacitorHttp).toHaveBeenCalledTimes(2);
        });

        it("does not probe the proxy off Android", async () => {
            const capacitorHttp = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: "ok" });
            installCapacitor({ capacitorHttp, platform: "ios" });
            const fetchMock = vi.fn();
            vi.stubGlobal("fetch", fetchMock);

            await capacitorHttpHandler({ method: "GET", url: "https://x", headers: {} });

            expect(fetchMock).not.toHaveBeenCalled();
            expect(capacitorHttp).toHaveBeenCalledOnce();
        });

        it("uses the plugin transport when the ping is not answered by the interceptor (stale APK)", async () => {
            const capacitorHttp = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: "ok" });
            installCapacitor({ capacitorHttp, platform: "android" });
            // An older APK serves the path from the asset server — no marker header.
            const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 404, body: "not found" }));
            vi.stubGlobal("fetch", fetchMock);

            await capacitorHttpHandler({ method: "GET", url: "https://x", headers: {} });
            await capacitorHttpHandler({ method: "GET", url: "https://x", headers: {} });

            // The failed probe is cached too — pinged once, never fetched through the proxy.
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(capacitorHttp).toHaveBeenCalledTimes(2);
        });

        it("falls back to the plugin transport when the proxy reports an internal error", async () => {
            const capacitorHttp = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: "via plugin" });
            installCapacitor({ capacitorHttp, platform: "android" });
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const fetchMock = vi.fn()
                .mockResolvedValueOnce(fakeResponse({ headers: { "x-trilium-native-http": "1" }, body: "pong" }))
                .mockResolvedValueOnce(fakeResponse({
                    status: 502,
                    headers: { "x-trilium-native-http": "1", "x-trilium-proxy-error": "SocketTimeoutException: timed out" }
                }));
            vi.stubGlobal("fetch", fetchMock);

            const result = await capacitorHttpHandler({ method: "GET", url: "https://x", headers: {} });

            expect(result.body).toBe("via plugin");
            expect(warnSpy).toHaveBeenCalledOnce();
        });
    });
});
