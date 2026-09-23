import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// All mutable mock state lives in a hoisted holder so the (hoisted) vi.mock
// factory below can reference it.
const h = vi.hoisted(() => {
    const tabManager = {
        activeNote: null as { type: string } | null,
        activeContext: null as { getTextEditor: () => Promise<unknown> } | null,
        getActiveContextNote: () => tabManager.activeNote,
        getActiveContext: () => tabManager.activeContext
    };
    return { tabManager, triggerCommand: vi.fn() };
});

vi.mock("../components/app_context.js", () => ({
    default: { tabManager: h.tabManager, triggerCommand: h.triggerCommand }
}));

// The module under test pulls in several DOM/jQuery-heavy collaborators at import
// time; stub them so importing stays cheap and side-effect free.
vi.mock("../components/zoom.js", () => ({ default: {} }));
vi.mock("../services/clipboard_ext.js", () => ({ copyHtml: vi.fn(), copyTextWithToast: vi.fn() }));
vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("../services/options.js", () => ({ default: { get: () => "" } }));
vi.mock("../services/server.js", () => ({ default: { post: vi.fn() } }));
vi.mock("../services/utils.js", () => ({
    default: { escapeHtml: (s: string) => s, isMac: () => false }
}));
vi.mock("./context_menu.js", () => ({ default: { show: vi.fn() } }));

import { copyHtml, copyTextWithToast } from "../services/clipboard_ext.js";
import server from "../services/server.js";
import contextMenu, { type MenuCommandItem, type MenuItem } from "./context_menu.js";
import {
    buildNoteContextMenuItems,
    type ContextMenuHost,
    type ContextMenuTarget,
    getSelectedHtmlForMarkdown,
    setupContextMenu
} from "./note_context_menu.js";

const { tabManager } = h;

/** Builds an editor whose editable DOM root is `domRoot` and selection HTML is `selectedHtml`. */
function fakeEditor(domRoot: Node | null, selectedHtml: string) {
    return {
        editing: { view: { getDomRoot: () => domRoot } },
        getSelectedHtml: vi.fn(() => selectedHtml),
        // Without the plugin the AI assistant row is skipped, keeping these tests off it.
        plugins: { has: () => false },
        isReadOnly: false,
        execute: vi.fn()
    };
}

/**
 * Points window.getSelection() at `anchorNode`, cloning `fallbackHtml` for the DOM-range path.
 * `text` is what the selection stringifies to — what the browser menu's gate reads. happy-dom lays
 * nothing out, so the highlighted box is stated here: it covers the origin every `rightClick`
 * lands on unless that test says otherwise.
 */
function setSelection(anchorNode: Node | null, fallbackHtml = "", text = "") {
    const fragment = document.createDocumentFragment();
    if (fallbackHtml) {
        const holder = document.createElement("div");
        holder.innerHTML = fallbackHtml;
        while (holder.firstChild) fragment.appendChild(holder.firstChild);
    }
    vi.spyOn(window, "getSelection").mockReturnValue({
        anchorNode,
        rangeCount: anchorNode || fallbackHtml ? 1 : 0,
        getRangeAt: () => ({
            cloneContents: () => fragment.cloneNode(true),
            getClientRects: () => [ { left: 0, top: 0, right: 200, bottom: 100 } ]
        }),
        toString: () => text
    } as unknown as Selection);
}

/** A host with nothing optional, standing in for the browser. */
function browserLikeHost(overrides: Partial<ContextMenuHost> = {}): ContextMenuHost {
    return {
        canCut: true,
        cut: vi.fn(),
        canCopy: true,
        copy: vi.fn(),
        openExternal: vi.fn(),
        ...overrides
    };
}

function target(overrides: Partial<ContextMenuTarget> = {}): ContextMenuTarget {
    return {
        linkURL: "",
        linkText: "",
        isMedia: false,
        isEditable: false,
        selectionText: "hello",
        ...overrides
    };
}

/** Builds the menu for a target, defaulting whatever the test does not care about. */
function build(targetOverrides: Partial<ContextMenuTarget> = {}, host = browserLikeHost()) {
    return buildNoteContextMenuItems(target(targetOverrides), host);
}

/** The titles of `items`, with separators rendered as "---" so ordering stays readable. */
function titles(items: MenuItem<any>[]) {
    return items.map((item) => ("kind" in item && item.kind === "separator"
        ? "---"
        : (item as MenuCommandItem<any>).title));
}

function findItem(items: MenuItem<any>[], title: string) {
    const found = items.find((item) => !("kind" in item) && item.title === title);
    return found as MenuCommandItem<any> | undefined;
}

/**
 * Picks the row titled `title`, as clicking it would. `MenuHandler` declares a `void` return, so
 * the promise an async row hands back has to be recovered here for a test to await it.
 */
function run(items: MenuItem<any>[], title: string): void | Promise<void> {
    return findItem(items, title)?.handler?.({} as never, {} as never);
}

describe("buildNoteContextMenuItems", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tabManager.activeNote = null;
        tabManager.activeContext = null;
    });

    it("offers copy, copy-as-markdown and the search rows for a plain selection", async () => {
        const items = await build();

        expect(titles(items)).toEqual([
            "electron_context_menu.copy",
            "electron_context_menu.copy-as-markdown",
            "---",
            "electron_context_menu.search_online",
            "electron_context_menu.search_in_trilium"
        ]);
    });

    it("omits the spelling and paste rows when the host does not supply them", async () => {
        const shown = titles(await build({ isEditable: true }));

        expect(shown).not.toContain("electron_context_menu.paste");
        expect(shown).not.toContain("electron_context_menu.paste-as-plain-text");
        expect(shown).not.toContain("electron_context_menu.add-term-to-dictionary");
        // Cut is editable-only, and a browser host does serve it by deleting through the editor.
        expect(shown).toContain("electron_context_menu.cut");
    });

    it("emits the spelling suggestions and paste rows a richer host supplies", async () => {
        const addToDictionary = vi.fn();
        const items = await build({ isEditable: true }, browserLikeHost({
            spelling: { misspelledWord: "teh", suggestions: [ "the", "ten" ], addToDictionary },
            paste: { enabled: true, run: vi.fn(), runAsPlainText: vi.fn() }
        }));

        expect(titles(items).slice(0, 4)).toEqual([
            "the",
            "ten",
            "electron_context_menu.add-term-to-dictionary",
            "---"
        ]);
        // The suggestions carry a command rather than a handler: only the host can commit one.
        expect(findItem(items, "the")?.command).toBe("replaceMisspelling");
        expect(findItem(items, "the")?.spellingSuggestion).toBe("the");
        expect(titles(items)).toContain("electron_context_menu.paste-as-plain-text");

        run(items, "electron_context_menu.add-term-to-dictionary");
        expect(addToDictionary).toHaveBeenCalledWith("teh");
    });

    it("offers copy-link for a real link but not over media", async () => {
        const url = "https://example.com";
        const overLink = await build({ linkURL: url, linkText: "Example" });
        expect(titles(overLink)).toContain("electron_context_menu.copy-link");

        const overImage = await build({ linkURL: url, isMedia: true });
        expect(titles(overImage)).not.toContain("electron_context_menu.copy-link");

        const blocked = await build({ linkURL: "javascript:" });
        expect(titles(blocked)).not.toContain("electron_context_menu.copy-link");

        run(overLink, "electron_context_menu.copy-link");
        expect(copyHtml).toHaveBeenCalledWith(`<a href="${url}">Example</a>`, url);
    });

    it("searches through the host for the web and through the app for notes", async () => {
        const host = browserLikeHost();
        const items = await build({ selectionText: "trilium notes" }, host);

        run(items, "electron_context_menu.search_online");
        expect(host.openExternal).toHaveBeenCalledWith("https://duckduckgo.com/?q=trilium%20notes");

        run(items, "electron_context_menu.search_in_trilium");
        expect(h.triggerCommand).toHaveBeenCalledWith("searchNotes", {
            searchString: "trilium notes"
        });
    });

    it("converts the selection through the to-markdown route", async () => {
        vi.mocked(server.post).mockResolvedValue({ markdownContent: "# Hi" });
        setSelection(document.createElement("span"), "<h1>Hi</h1>");

        const items = await build();
        await run(items, "electron_context_menu.copy-as-markdown");

        expect(server.post).toHaveBeenCalledWith("other/to-markdown", {
            htmlContent: "<h1>Hi</h1>"
        });
        expect(copyTextWithToast).toHaveBeenCalledWith("# Hi");
    });
});

describe("setupContextMenu (browser)", () => {
    beforeAll(() => setupContextMenu());

    beforeEach(() => {
        vi.clearAllMocks();
        tabManager.activeNote = null;
        tabManager.activeContext = null;
    });

    /** Right-clicks `element`, holding Shift or letting another widget claim the event first. */
    function rightClick(
        element: Element,
        { shiftKey = false, claimed = false, clientX = 0, clientY = 0 } = {}
    ) {
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            shiftKey,
            clientX,
            clientY
        });
        if (claimed) {
            element.addEventListener("contextmenu", (e) => e.preventDefault(), { once: true });
        }
        element.dispatchEvent(event);
        return event;
    }

    /** Lets the listener's async tail run, so a menu it would raise has been raised by now. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** happy-dom ships no `execCommand`, so the browser's own cut is only observable as a stub. */
    function stubExecCommand() {
        const execCommand = vi.fn(() => true);
        document.execCommand = execCommand;
        return execCommand;
    }

    /** An editable standing in for CodeMirror's `.cm-content`, read-only when asked. */
    function codeEditable(readOnly = false) {
        const content = document.createElement("div");
        content.setAttribute("contenteditable", "true");
        if (readOnly) {
            content.setAttribute("aria-readonly", "true");
        }
        document.body.appendChild(content);
        return content;
    }

    /** Right-clicks `element` and returns the rows the menu went up with. */
    async function menuFor(element: Element) {
        rightClick(element);
        await vi.waitFor(() => expect(contextMenu.show).toHaveBeenCalled());
        return vi.mocked(contextMenu.show).mock.calls[0][0].items;
    }

    it("leaves the browser's own menu up when nothing is selected", async () => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        setSelection(null, "", "   ");

        const event = rightClick(div);
        await settle();

        expect(event.defaultPrevented).toBe(false);
        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("leaves it up for a click away from the selection, which is what the rows act on", async () => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        setSelection(div, "<b>text</b>", "text");

        const event = rightClick(div, { clientX: 500, clientY: 500 });
        await settle();

        expect(event.defaultPrevented).toBe(false);
        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("stands aside for a widget that already answered the click", async () => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        setSelection(div, "<b>text</b>", "text");

        rightClick(div, { claimed: true });
        await settle();

        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("hands a Shift+right-click back to the browser, selection or not", async () => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        setSelection(div, "<b>text</b>", "text");

        const event = rightClick(div, { shiftKey: true });
        await settle();

        expect(event.defaultPrevented).toBe(false);
        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("cuts a text note through its editor and a code note through the browser", async () => {
        const execCommand = stubExecCommand();

        const content = codeEditable();
        tabManager.activeNote = { type: "code" }; // so no CKEditor answers for the selection
        setSelection(content, "<span>code</span>", "code");

        const codeRows = await menuFor(content);
        expect(findItem(codeRows, "electron_context_menu.cut")?.enabled).toBe(true);
        await run(codeRows, "electron_context_menu.cut");
        expect(execCommand).toHaveBeenCalledWith("cut");

        vi.clearAllMocks();

        const editorRoot = codeEditable();
        const anchor = document.createElement("span");
        editorRoot.appendChild(anchor);
        const editor = fakeEditor(editorRoot, "<p>clean</p>");
        tabManager.activeNote = { type: "text" };
        tabManager.activeContext = { getTextEditor: async () => editor };
        setSelection(anchor, "<p>clean</p>", "clean");

        await run(await menuFor(editorRoot), "electron_context_menu.cut");
        expect(copyHtml).toHaveBeenCalledWith("<p>clean</p>", "clean");
        expect(editor.execute).toHaveBeenCalledWith("delete");
        expect(execCommand).not.toHaveBeenCalled();
    });

    it("drops the cut row in a read-only code note", async () => {
        const content = codeEditable(true);
        tabManager.activeNote = { type: "code" };
        setSelection(content, "<span>code</span>", "code");

        const shown = titles(await menuFor(content));

        expect(shown).not.toContain("electron_context_menu.cut");
        expect(shown).toContain("electron_context_menu.copy");
        expect(shown).toContain("electron_context_menu.copy-as-markdown");
    });

    it("takes the menu over for a selection, and reads the link under the pointer", async () => {
        const link = document.createElement("a");
        link.href = "https://example.com/";
        link.textContent = "Example";
        document.body.appendChild(link);
        setSelection(link, "<b>text</b>", "text");

        const event = rightClick(link);
        expect(event.defaultPrevented).toBe(true);

        await vi.waitFor(() => expect(contextMenu.show).toHaveBeenCalled());
        const shown = vi.mocked(contextMenu.show).mock.calls[0][0];
        expect(titles(shown.items)).toEqual([
            "electron_context_menu.copy",
            "electron_context_menu.copy-as-markdown",
            "electron_context_menu.copy-link",
            "---",
            "electron_context_menu.search_online",
            "electron_context_menu.search_in_trilium"
        ]);
    });
});

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
