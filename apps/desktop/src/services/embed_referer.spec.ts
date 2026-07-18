import type { Session } from "electron";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
    default: {
        session: { defaultSession: { webRequest: { onBeforeSendHeaders: () => {} } } }
    }
}));

const { setupEmbedReferer } = await import("./embed_referer.js");

type RequestHeaders = Record<string, string>;
type Filter = { urls: string[] };
type Handler = (
    details: { url: string; requestHeaders: RequestHeaders },
    callback: (response: { requestHeaders: RequestHeaders }) => void
) => void;

/** A stand-in Electron session that records the hook registered on it. */
function fakeSession() {
    let captured: Handler | undefined;
    const session = {
        webRequest: {
            onBeforeSendHeaders: vi.fn((_filter: Filter, handler: Handler) => {
                captured = handler;
            })
        }
    };

    return {
        session: session as unknown as Session,
        registrations: () => session.webRequest.onBeforeSendHeaders.mock.calls.length,
        filter: () => session.webRequest.onBeforeSendHeaders.mock.calls[0]?.[0],
        /** Runs the registered hook over `requestHeaders` and returns what it forwards. */
        run(requestHeaders: RequestHeaders) {
            expect(captured).toBeDefined();

            let forwarded: RequestHeaders | undefined;
            captured?.(
                { url: "https://www.youtube.com/embed/abc", requestHeaders },
                (response) => (forwarded = response.requestHeaders)
            );

            if (!forwarded) {
                throw new Error("The hook did not forward any headers.");
            }
            return forwarded;
        }
    };
}

describe("setupEmbedReferer", () => {
    it("registers a header hook scoped to the embed providers that injects the given Referer", () => {
        const { session, registrations, filter, run } = fakeSession();

        setupEmbedReferer("http://localhost:37840/", session);

        expect(registrations()).toBe(1);
        // Scoped to the embed providers (Electron does the actual URL matching),
        // and notably NOT a catch-all.
        expect(filter()?.urls).toContain("*://*.youtube.com/*");
        expect(filter()?.urls).toContain("*://*.youtube-nocookie.com/*");
        expect(filter()?.urls).not.toContain("*://*/*");

        // The handler sets the supplied origin as the Referer and forwards the headers.
        const headers = run({ "X-Foo": "bar" });
        expect(headers["Referer"]).toBe("http://localhost:37840/");
        expect(headers["X-Foo"]).toBe("bar");
    });

    it("replaces an existing Referer whatever its casing, so the header is never sent twice", () => {
        const { session, run } = fakeSession();

        setupEmbedReferer("http://localhost:37840/", session);

        const headers = run({ "referer": "https://elsewhere.example.com/", "X-Foo": "bar" });
        expect(Object.keys(headers).filter((name) => name.toLowerCase() === "referer")).toEqual(["Referer"]);
        expect(headers["Referer"]).toBe("http://localhost:37840/");
        expect(headers["X-Foo"]).toBe("bar");
    });

    it("installs once per session, but does install on a second session", () => {
        const first = fakeSession();
        const second = fakeSession();

        setupEmbedReferer("http://localhost:37840/", first.session);
        setupEmbedReferer("http://localhost:37840/", first.session);
        setupEmbedReferer("http://localhost:37840/", second.session);

        // Electron allows one listener per session — not one per process.
        expect(first.registrations()).toBe(1);
        expect(second.registrations()).toBe(1);
    });
});
