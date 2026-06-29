import { afterEach, describe, expect, it, vi } from "vitest";

import { capacitorHttpHandler } from "./capacitor_http_handler.js";

interface CapacitorWindow {
    Capacitor?: unknown;
}

function installCapacitor(request: ReturnType<typeof vi.fn>) {
    (window as unknown as CapacitorWindow).Capacitor = {
        Plugins: { CapacitorHttp: { request } }
    };
}

describe("capacitorHttpHandler", () => {
    afterEach(() => {
        delete (window as unknown as CapacitorWindow).Capacitor;
        vi.restoreAllMocks();
    });

    it("throws when the CapacitorHttp plugin is unavailable", async () => {
        await expect(
            capacitorHttpHandler({ method: "GET", url: "https://x", headers: {} })
        ).rejects.toThrow("CapacitorHttp plugin is not available");
    });

    it("forwards the request and lowercases response header keys (object body)", async () => {
        const request = vi.fn().mockResolvedValue({
            status: 200,
            headers: { "Content-Type": "application/json", "X-Custom": "v" },
            data: { ok: true }
        });
        installCapacitor(request);

        const result = await capacitorHttpHandler({
            method: "POST",
            url: "https://api/test",
            headers: { Authorization: "token" },
            body: "{}"
        });

        expect(request).toHaveBeenCalledWith({
            method: "POST",
            url: "https://api/test",
            headers: { Authorization: "token" },
            data: "{}",
            responseType: undefined
        });
        expect(result.status).toBe(200);
        expect(result.headers).toEqual({ "content-type": "application/json", "x-custom": "v" });
        expect(result.body).toBe(JSON.stringify({ ok: true }));
    });

    it("passes string response data through unchanged", async () => {
        const request = vi.fn().mockResolvedValue({ status: 201, headers: {}, data: "plain text" });
        installCapacitor(request);

        const result = await capacitorHttpHandler({ method: "GET", url: "https://x", headers: {} });
        expect(result.body).toBe("plain text");
    });

    it("passes arraybuffer responses through as the raw base64 string", async () => {
        const request = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: "QUJD" });
        installCapacitor(request);

        const result = await capacitorHttpHandler({
            method: "GET",
            url: "https://x/image",
            headers: {},
            responseType: "arraybuffer"
        });
        expect(result.body).toBe("QUJD");
    });
});
