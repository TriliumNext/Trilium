import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
    default: {
        session: { defaultSession: { webRequest: { onBeforeSendHeaders: () => {} } } }
    }
}));

const { setupEmbedReferer } = await import("./embed_referer.js");

describe("setupEmbedReferer", () => {
    it("registers a header hook scoped to the embed providers that injects the given Referer", () => {
        let captured: ((details: any, cb: (r: any) => void) => void) | undefined;
        const session = {
            webRequest: {
                onBeforeSendHeaders: vi.fn((_filter: any, handler: any) => {
                    captured = handler;
                })
            }
        };

        setupEmbedReferer("http://localhost:37840/", session as any);

        expect(session.webRequest.onBeforeSendHeaders).toHaveBeenCalledTimes(1);
        const [filter] = session.webRequest.onBeforeSendHeaders.mock.calls[0];
        // Scoped to the embed providers (Electron does the actual URL matching),
        // and notably NOT a catch-all.
        expect(filter.urls).toContain("*://*.youtube.com/*");
        expect(filter.urls).toContain("*://*.youtube-nocookie.com/*");
        expect(filter.urls).not.toContain("*://*/*");

        // The handler sets the supplied origin as the Referer and forwards the headers.
        let result: any;
        captured!({ url: "https://www.youtube.com/embed/abc", requestHeaders: { "X-Foo": "bar" } }, (r) => (result = r));
        expect(result.requestHeaders["Referer"]).toBe("http://localhost:37840/");
        expect(result.requestHeaders["X-Foo"]).toBe("bar");
    });
});
