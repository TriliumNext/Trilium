import { beforeEach, describe, expect, it, vi } from "vitest";

// All mutable mock state lives in a hoisted holder so the (hoisted) vi.mock
// factory below can reference it.
const h = vi.hoisted(() => {
    const tabManager = {
        activeNote: null as { type: string } | null,
        activeContext: null as { getTextEditor: () => Promise<unknown> } | null,
        getActiveContextNote: () => tabManager.activeNote,
        getActiveContext: () => tabManager.activeContext
    };
    return { tabManager };
});

vi.mock("../components/app_context.js", () => ({
    default: { tabManager: h.tabManager }
}));

// The module under test pulls in several DOM/jQuery-heavy collaborators at import
// time; stub them so importing stays cheap and side-effect free.
vi.mock("../components/zoom.js", () => ({ default: {} }));
vi.mock("../services/clipboard_ext.js", () => ({ copyTextWithToast: vi.fn() }));
vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("../services/options.js", () => ({ default: { get: () => "" } }));
vi.mock("../services/server.js", () => ({ default: { post: vi.fn() } }));
vi.mock("../services/utils.js", () => ({ default: { escapeHtml: (s: string) => s } }));
vi.mock("./context_menu.js", () => ({ default: { show: vi.fn() } }));

import { getSelectedHtmlForMarkdown } from "./electron_context_menu.js";

const { tabManager } = h;

/** Builds an editor whose editable DOM root is `domRoot` and selection HTML is `selectedHtml`. */
function fakeEditor(domRoot: Node | null, selectedHtml: string) {
    return {
        editing: { view: { getDomRoot: () => domRoot } },
        getSelectedHtml: vi.fn(() => selectedHtml)
    };
}

/** Points window.getSelection() at `anchorNode`, cloning `fallbackHtml` for the DOM-range path. */
function setSelection(anchorNode: Node | null, fallbackHtml = "") {
    const fragment = document.createDocumentFragment();
    if (fallbackHtml) {
        const holder = document.createElement("div");
        holder.innerHTML = fallbackHtml;
        while (holder.firstChild) fragment.appendChild(holder.firstChild);
    }
    vi.spyOn(window, "getSelection").mockReturnValue({
        anchorNode,
        rangeCount: anchorNode || fallbackHtml ? 1 : 0,
        getRangeAt: () => ({ cloneContents: () => fragment.cloneNode(true) })
    } as unknown as Selection);
}

describe("getSelectedHtmlForMarkdown", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        tabManager.activeNote = null;
        tabManager.activeContext = null;
    });

    it("uses the editor's data-pipeline HTML when the selection is inside the editor", async () => {
        const editorRoot = document.createElement("div");
        const anchor = document.createElement("span");
        editorRoot.appendChild(anchor);
        const editor = fakeEditor(editorRoot, "<p>clean</p>");

        tabManager.activeNote = { type: "text" };
        tabManager.activeContext = { getTextEditor: async () => editor };
        setSelection(anchor, "<b>dom clone</b>");

        expect(await getSelectedHtmlForMarkdown()).toBe("<p>clean</p>");
        expect(editor.getSelectedHtml).toHaveBeenCalled();
    });

    it("falls back to the DOM clone when the selection is outside the editor", async () => {
        const editorRoot = document.createElement("div");
        const outsideAnchor = document.createElement("span"); // not appended to editorRoot
        const editor = fakeEditor(editorRoot, "<p>clean</p>");

        tabManager.activeNote = { type: "text" };
        tabManager.activeContext = { getTextEditor: async () => editor };
        setSelection(outsideAnchor, "<b>dom clone</b>");

        expect(await getSelectedHtmlForMarkdown()).toBe("<b>dom clone</b>");
        expect(editor.getSelectedHtml).not.toHaveBeenCalled();
    });

    it("falls back to the DOM clone when the editor selection is empty", async () => {
        const editorRoot = document.createElement("div");
        const anchor = document.createElement("span");
        editorRoot.appendChild(anchor);
        const editor = fakeEditor(editorRoot, ""); // empty model selection

        tabManager.activeNote = { type: "text" };
        tabManager.activeContext = { getTextEditor: async () => editor };
        setSelection(anchor, "<b>dom clone</b>");

        expect(await getSelectedHtmlForMarkdown()).toBe("<b>dom clone</b>");
    });

    it("skips the editor path entirely for a non-text note", async () => {
        const editor = fakeEditor(document.createElement("div"), "<p>clean</p>");
        tabManager.activeNote = { type: "code" };
        tabManager.activeContext = { getTextEditor: async () => editor };
        setSelection(document.createElement("span"), "<b>dom clone</b>");

        expect(await getSelectedHtmlForMarkdown()).toBe("<b>dom clone</b>");
        expect(editor.getSelectedHtml).not.toHaveBeenCalled();
    });

    it("falls back when resolving the text editor throws or times out", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {}); // the catch logs the timeout
        tabManager.activeNote = { type: "text" };
        tabManager.activeContext = {
            getTextEditor: async () => {
                throw new Error("timed out");
            }
        };
        setSelection(document.createElement("span"), "<b>dom clone</b>");

        expect(await getSelectedHtmlForMarkdown()).toBe("<b>dom clone</b>");
    });

    it("returns an empty string when there is no selection at all", async () => {
        tabManager.activeNote = { type: "text" };
        setSelection(null);

        expect(await getSelectedHtmlForMarkdown()).toBe("");
    });
});
