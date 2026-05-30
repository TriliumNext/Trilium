import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/app_context.js", () => ({
    default: {
        getComponentByEl: vi.fn((el: unknown) => ({ el })),
        tabManager: { getActiveContextNote: vi.fn(() => null) }
    }
}));

vi.mock("./link.js", () => ({
    default: {
        getReferenceLinkTitle: vi.fn(async (href: string) => `async:${href}`),
        getReferenceLinkTitleSync: vi.fn((href: string) => `sync:${href}`)
    }
}));

import appContext from "../components/app_context.js";
import froca from "./froca.js";
import glob from "./glob.js";
import { requireCss } from "./glob.js";
import linkService from "./link.js";
import server from "./server.js";
import utils from "./utils.js";
import ws from "./ws.js";

const getComponentByEl = appContext.getComponentByEl as ReturnType<typeof vi.fn>;
const getActiveContextNote = appContext.tabManager.getActiveContextNote as ReturnType<typeof vi.fn>;
const getReferenceLinkTitle = linkService.getReferenceLinkTitle as ReturnType<typeof vi.fn>;
const getReferenceLinkTitleSync = linkService.getReferenceLinkTitleSync as ReturnType<typeof vi.fn>;

// ws.logError isn't part of the global stub; provide a spy so the error handlers can call it.
(ws as any).logError = vi.fn();

function resetDom() {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
}

beforeEach(() => {
    vi.clearAllMocks();
    (ws as any).logError = vi.fn();
    resetDom();
    // Reset the glob object to a known baseline for each test.
    (window as any).glob = {
        isMainWindow: true,
        assetPath: "/assets",
        appCssNoteIds: []
    };
});

afterEach(() => {
    window.onerror = null;
});

describe("setupGlobs", () => {
    it("wires up the glob object with values and delegating helpers", () => {
        glob.setupGlobs();

        // direct value assignments: assert identity, not just that they are functions,
        // so a swapped/wrong reference (e.g. both set to utils.isMobile) is caught.
        expect(window.glob.isDesktop).toBe(utils.isDesktop);
        expect(window.glob.isMobile).toBe(utils.isMobile);
        expect(window.glob.getHeaders).toBe(server.getHeaders);
        expect(window.glob.froca).toBe(froca);
        expect(window.glob.treeCache).toBe(froca);
        expect(window.glob.appContext).toBe(appContext);

        // delegating lambdas actually call through to the underlying services
        const el = document.createElement("div");
        expect(window.glob.getComponentByEl(el)).toEqual({ el });
        expect(getComponentByEl).toHaveBeenCalledWith(el);

        expect(window.glob.getActiveContextNote()).toBeNull();
        expect(getActiveContextNote).toHaveBeenCalled();
    });

    it("delegates reference link title helpers to the link service", async () => {
        glob.setupGlobs();

        await expect(window.glob.getReferenceLinkTitle("#root/abc")).resolves.toBe("async:#root/abc");
        expect(getReferenceLinkTitle).toHaveBeenCalledWith("#root/abc");

        expect(window.glob.getReferenceLinkTitleSync("#root/def")).toBe("sync:#root/def");
        expect(getReferenceLinkTitleSync).toHaveBeenCalledWith("#root/def");
    });

    it("loads each configured app CSS note that isn't already present", () => {
        // Pre-seed an existing link so the dedup branch (some => true) is exercised.
        const existing = document.createElement("link");
        existing.rel = "stylesheet";
        existing.href = "/anything/api/notes/download/already";
        document.head.appendChild(existing);

        window.glob.appCssNoteIds = ["already", "fresh"];
        glob.setupGlobs();

        const hrefs = Array.from(document.querySelectorAll("head link")).map((l) => (l as HTMLLinkElement).getAttribute("href"));
        // "already" was present -> not re-added; "fresh" gets appended without asset path prefix.
        expect(hrefs.filter((h) => h?.endsWith("api/notes/download/already"))).toHaveLength(1);
        expect(hrefs).toContain("api/notes/download/fresh");
    });

    it("handles a missing appCssNoteIds list", () => {
        delete (window.glob as any).appCssNoteIds;
        glob.setupGlobs();
        // No css links added from the (absent) list.
        expect(document.querySelectorAll("head link")).toHaveLength(0);
    });

    it("opens external anchor links in a new window", () => {
        glob.setupGlobs();

        const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
        const $a = window.$('<a class="external" href="https://example.com">x</a>');
        window.$("body").append($a);
        $a.trigger("click");

        expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank");
        openSpy.mockRestore();
    });
});

describe("window.onerror handler", () => {
    beforeEach(() => glob.setupGlobs());

    it("logs full details for a normal error and serializes the error object", () => {
        const result = window.onerror!("Some failure", "http://x/app.js", 12, 34, new Error("boom"));

        expect(result).toBe(false);
        expect((ws as any).logError).toHaveBeenCalledTimes(1);
        const msg = (ws as any).logError.mock.calls[0][0] as string;
        expect(msg).toContain("Message: Some failure");
        expect(msg).toContain("URL: http://x/app.js");
        expect(msg).toContain("Line: 12");
        expect(msg).toContain("Column: 34");
    });

    it("reports no details for a generic 'Script error'", () => {
        window.onerror!("Script error.", undefined, undefined, undefined, undefined);
        const msg = (ws as any).logError.mock.calls[0][0] as string;
        expect(msg).toContain("No details available");
    });

    it("falls back to toString when the error object cannot be JSON-stringified", () => {
        const circular: any = {};
        circular.self = circular;
        const err: any = new Error("circular");
        err.toJSON = () => {
            throw new Error("nope");
        };

        window.onerror!("circular failure", "u", 1, 2, err);
        const msg = (ws as any).logError.mock.calls[0][0] as string;
        // The catch branch stringified the thrown serialization error via toString().
        expect(msg).toContain("Error object: Error: nope");
    });
});

describe("unhandledrejection handler", () => {
    beforeEach(() => glob.setupGlobs());

    function dispatchRejection(reason: unknown) {
        const event = new Event("unhandledrejection") as any;
        event.reason = reason;
        window.dispatchEvent(event);
    }

    it("logs full details for a normal rejection", () => {
        dispatchRejection({ message: "rejected", lineNumber: 5, columnNumber: 6, stack: "stack" });
        const msg = (ws as any).logError.mock.calls[0][0] as string;
        expect(msg).toContain("Message: rejected");
        expect(msg).toContain("Line: 5");
        expect(msg).toContain("Column: 6");
    });

    it("reports no details for a script error rejection", () => {
        dispatchRejection({ message: "Script error" });
        const msg = (ws as any).logError.mock.calls[0][0] as string;
        expect(msg).toContain("No details available");
    });

    it("handles a rejection with no reason message and unserializable reason", () => {
        const circular: any = {};
        circular.self = circular;
        circular.toJSON = () => {
            throw new Error("bad");
        };
        // no .message -> string is undefined -> falls into the details branch
        dispatchRejection(circular);
        const msg = (ws as any).logError.mock.calls[0][0] as string;
        expect(msg).toContain("Error object: Error: bad");
    });
});

describe("requireCss", () => {
    beforeEach(() => {
        (window as any).glob = { assetPath: "/myassets" };
        resetDom();
    });

    it("prepends the asset path by default and appends a stylesheet link", async () => {
        await requireCss("css/theme.css");
        const link = document.querySelector("head link") as HTMLLinkElement;
        expect(link.getAttribute("href")).toBe("/myassets/css/theme.css");
    });

    it("does not append a duplicate when a matching stylesheet already exists", async () => {
        const existing = document.createElement("link");
        existing.rel = "stylesheet";
        existing.href = "http://host/some/path.css";
        document.head.appendChild(existing);

        await requireCss("some/path.css", true);
        // Still just the one link; nothing appended because the existing href ends with the url.
        expect(document.querySelectorAll("head link")).toHaveLength(1);
    });
});
