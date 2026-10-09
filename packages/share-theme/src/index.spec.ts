// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    setupLayout: vi.fn(),
    setupExpanders: vi.fn(),
    setupThemeSelector: vi.fn().mockImplementation(() => {
        throw new Error("theme switch failed");
    }),
    setupSearch: vi.fn().mockRejectedValue(new Error("search failed")),
    setupToC: vi.fn(),
    setupFooter: vi.fn(),
    setupMath: vi.fn(),
    setupMermaid: vi.fn(),
    applyTabs: vi.fn(),
    revealFragment: vi.fn(),
    enhanceLinkPreviews: vi.fn()
}));

vi.mock("./page/layout.js", () => ({ default: mocks.setupLayout }));
vi.mock("./page/navigation.js", () => ({ default: mocks.setupExpanders }));
vi.mock("./page/theme_switch.js", () => ({ default: mocks.setupThemeSelector }));
vi.mock("./page/search.js", () => ({ default: mocks.setupSearch }));
vi.mock("./page/toc.js", () => ({ default: mocks.setupToC }));
vi.mock("./page/footer.js", () => ({ default: mocks.setupFooter }));
vi.mock("./content/math.js", () => ({ default: mocks.setupMath }));
vi.mock("./content/mermaid.js", () => ({ default: mocks.setupMermaid }));
vi.mock("@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js", () => ({
    applyTabs: mocks.applyTabs,
    revealFragment: mocks.revealFragment
}));
vi.mock("@triliumnext/commons/src/lib/link_embed_dom.js", () => ({
    enhanceLinkPreviews: mocks.enhanceLinkPreviews
}));

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

describe("share theme entry", () => {
    // Vitest clears the calls of every mock before each test.
    let pageSetupCalls: number[] = [];
    let loggedErrors: unknown[] = [];

    beforeAll(async () => {
        await import("./index.js");
        await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2));
        pageSetupCalls = [ mocks.setupThemeSelector, mocks.setupToC, mocks.setupExpanders,
            mocks.setupLayout, mocks.setupSearch, mocks.setupFooter ]
            .map((setup) => setup.mock.calls.length);
        loggedErrors = consoleError.mock.calls.map(([ error ]) => (error as Error).message);
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        document.body.className = "";
        document.body.innerHTML = "";
    });

    it("sets up every part of the page, logging what one throws or rejects with", () => {
        expect(pageSetupCalls).toEqual([ 1, 1, 1, 1, 1, 1 ]);
        expect(loggedErrors.sort()).toEqual([ "search failed", "theme switch failed" ]);
    });

    it("gives `~shareJs` scripts `fetchNote()`, which defaults to the page's note", async () => {
        const fetchMock = vi.fn(async (_url: string) => Response.json({ noteId: "fetched" }));
        vi.stubGlobal("fetch", fetchMock);
        document.body.dataset.noteId = "current";
        const { fetchNote } = window as unknown as { fetchNote(noteId?: string): Promise<unknown> };

        expect(await fetchNote()).toEqual({ noteId: "fetched" });
        await fetchNote("other");

        expect(fetchMock.mock.calls.map(([ url ]) => url))
            .toEqual([ "api/notes/current", "api/notes/other" ]);
    });

    it("enhances a text note's content and reveals the tab panel the address points to", () => {
        document.body.className = "type-text";
        document.body.innerHTML = `<div id="content" data-tab-title-placeholder="Tab"></div>`;
        const panel = { scrollIntoView: vi.fn() };
        mocks.revealFragment.mockReturnValue(panel);

        document.dispatchEvent(new Event("DOMContentLoaded"));

        const content = document.getElementById("content");
        expect(mocks.setupMermaid).toHaveBeenCalledOnce();
        expect(mocks.setupMath).toHaveBeenCalledOnce();
        expect(mocks.enhanceLinkPreviews).toHaveBeenCalledWith(document.body);
        expect(mocks.applyTabs).toHaveBeenCalledWith(content, { placeholder: "Tab" });
        expect(panel.scrollIntoView).toHaveBeenCalledOnce();

        window.dispatchEvent(new Event("hashchange"));
        expect(panel.scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it("treats content styled as text like a text note, with or without a content element", () => {
        document.body.className = "type-book";
        document.body.innerHTML = `<div id="content" class="ck-content"></div>`;

        document.dispatchEvent(new Event("DOMContentLoaded"));

        expect(mocks.applyTabs)
            .toHaveBeenCalledWith(document.getElementById("content"), { placeholder: "" });

        mocks.applyTabs.mockClear();
        document.body.className = "type-text";
        document.body.innerHTML = "";
        document.dispatchEvent(new Event("DOMContentLoaded"));

        expect(mocks.setupMath).toHaveBeenCalledTimes(2);
        expect(mocks.applyTabs).not.toHaveBeenCalled();
    });

    it("draws a Mermaid note's diagram and leaves other notes alone", () => {
        document.body.className = "type-mermaid";
        document.dispatchEvent(new Event("DOMContentLoaded"));

        expect(mocks.setupMermaid).toHaveBeenCalledOnce();
        expect(mocks.setupMath).not.toHaveBeenCalled();

        document.body.className = "type-code";
        document.dispatchEvent(new Event("DOMContentLoaded"));

        expect(mocks.setupMermaid).toHaveBeenCalledOnce();
    });
});
