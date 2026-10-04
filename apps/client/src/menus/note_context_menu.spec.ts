import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// All mutable mock state lives in a hoisted holder so the (hoisted) vi.mock
// factory below can reference it.
const h = vi.hoisted(() => {
    const tabManager = {
        activeNote: null as { type: string } | null,
        activeContext: null as { getTextEditor: () => Promise<unknown> } | null,
        getActiveContext: () => tabManager.activeContext
            && { note: tabManager.activeNote, ...tabManager.activeContext },
        getNoteContexts: () => []
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
vi.mock("./table_context_menu.js", () => ({
    buildTableContextMenuSections: vi.fn(async () => null),
    hasTableCellSelection: vi.fn(async () => false)
}));

import { copyHtml, copyTextWithToast } from "../services/clipboard_ext.js";
import server from "../services/server.js";
import contextMenu, { type MenuCommandItem, type MenuItem } from "./context_menu.js";
import {
    buildTableContextMenuSections,
    hasTableCellSelection,
    type TableMenuSections
} from "./table_context_menu.js";
import {
    buildNoteContextMenuItems,
    type ContextMenuHost,
    type ContextMenuTarget,
    getSelectedHtmlForMarkdown,
    setupContextMenu
} from "./note_context_menu.js";

const { tabManager } = h;

/** Builds an editor whose editable DOM root is `domRoot` and selection HTML is `selectedHtml`. */
function fakeEditor(domRoot: Node | null, selectedHtml: string, plainText = "") {
    const pasteTarget = { paste: vi.fn(), release: vi.fn() };
    return {
        editing: { view: { getDomRoot: () => domRoot } },
        getSelectedHtml: vi.fn(() => selectedHtml),
        getSelectedPlainText: vi.fn(() => plainText),
        pasteTarget,
        capturePasteTarget: vi.fn(() => pasteTarget),
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

/** The rows of the submenu that the row titled `title` opens. */
function submenu(items: MenuItem<any>[], title: string): MenuItem<any>[] {
    return findItem(items, title)?.items ?? [];
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
            "---",
            "electron_context_menu.search_online",
            "electron_context_menu.search_in_trilium"
        ]);
        expect(titles(submenu(items, "electron_context_menu.copy"))).toEqual([
            "electron_context_menu.copy",
            "electron_context_menu.copy-as-markdown"
        ]);
    });

    it("groups the copy and paste variants under rows that copy or paste on a click", async () => {
        const host = browserLikeHost({
            paste: { enabled: true, run: vi.fn(), runAsPlainText: vi.fn(), read: vi.fn() }
        });
        const items = await build({ isEditable: true }, host);

        expect(titles(items)).toEqual([
            "electron_context_menu.cut",
            "electron_context_menu.copy",
            "electron_context_menu.paste",
            "---",
            "electron_context_menu.search_online",
            "electron_context_menu.search_in_trilium"
        ]);
        expect(titles(submenu(items, "electron_context_menu.paste"))).toEqual([
            "electron_context_menu.paste",
            "electron_context_menu.paste-as-plain-text"
        ]);
        expect(findItem(items, "electron_context_menu.copy"))
            .toMatchObject({ uiIcon: "bx bx-copy", shortcut: "Ctrl+C" });
        expect(findItem(items, "electron_context_menu.paste"))
            .toMatchObject({ uiIcon: "bx bx-paste", shortcut: "Ctrl+V" });

        run(items, "electron_context_menu.copy");
        expect(host.copy).toHaveBeenCalledTimes(1);
        run(items, "electron_context_menu.paste");
        expect(host.paste?.run).toHaveBeenCalledTimes(1);
        run(submenu(items, "electron_context_menu.paste"),
            "electron_context_menu.paste-as-plain-text");
        expect(host.paste?.runAsPlainText).toHaveBeenCalledTimes(1);
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
            paste: { enabled: true, run: vi.fn(), runAsPlainText: vi.fn(), read: vi.fn() }
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
        expect(titles(submenu(items, "electron_context_menu.paste")))
            .toContain("electron_context_menu.paste-as-plain-text");

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

    it("puts the table sections around the clipboard rows and hands them the element", async () => {
        const cell = document.createElement("td");
        vi.mocked(buildTableContextMenuSections).mockResolvedValueOnce({
            main: [ { title: "T1" }, { kind: "separator" }, { title: "T2" } ],
            sort: { title: "S" },
            delete: [ { title: "D1" }, { title: "D2" } ],
            select: { title: "SEL" },
            pasteRows: [ { title: "PR1" }, { title: "PR2" } ]
        } as TableMenuSections);
        const host = browserLikeHost({
            paste: { enabled: true, run: vi.fn(), runAsPlainText: vi.fn(), read: vi.fn() }
        });

        const items = await build({ isEditable: true, element: cell }, host);

        expect(buildTableContextMenuSections).toHaveBeenCalledWith(cell, host.paste);
        expect(titles(items)).toEqual([
            "T1",
            "---",
            "T2",
            "---",
            "electron_context_menu.cut",
            "electron_context_menu.copy",
            "electron_context_menu.paste",
            "---",
            "S",
            "---",
            "D1",
            "D2",
            "---",
            "SEL",
            "---",
            "electron_context_menu.search_online",
            "electron_context_menu.search_in_trilium"
        ]);
        // The table's paste rows come after the paste variants and a separator.
        expect(titles(submenu(items, "electron_context_menu.paste"))).toEqual([
            "electron_context_menu.paste",
            "electron_context_menu.paste-as-plain-text",
            "---",
            "PR1",
            "PR2"
        ]);
    });

    it("skips the table section for a non-editable target", async () => {
        await build({ element: document.createElement("td") });

        expect(buildTableContextMenuSections).not.toHaveBeenCalled();
    });

    it("converts the selection through the to-markdown route", async () => {
        vi.mocked(server.post).mockResolvedValue({ markdownContent: "# Hi" });
        setSelection(document.createElement("span"), "<h1>Hi</h1>");

        const items = await build();
        await run(submenu(items, "electron_context_menu.copy"),
            "electron_context_menu.copy-as-markdown");

        expect(server.post).toHaveBeenCalledWith("other/to-markdown", {
            htmlContent: "<h1>Hi</h1>",
            headerlessTables: "emptyHeader"
        });
        expect(copyTextWithToast).toHaveBeenCalledWith("# Hi");
    });

    it("enables the clipboard rows over a cell selection with no selection text", async () => {
        const cell = document.createElement("td");
        vi.mocked(buildTableContextMenuSections).mockResolvedValue({
            main: [ { title: "T1" } ],
            sort: { title: "S" },
            delete: [],
            select: { title: "SEL" },
            pasteRows: []
        } as TableMenuSections);

        // No cell selection and no text: the rows show but stay disabled.
        const copyRows = (items: MenuItem<any>[]) => [
            findItem(items, "electron_context_menu.cut")?.enabled,
            findItem(items, "electron_context_menu.copy")?.enabled,
            ...submenu(items, "electron_context_menu.copy")
                .map((item) => (item as MenuCommandItem<any>).enabled)
        ];

        const disabled = await build({ isEditable: true, element: cell, selectionText: "" });
        expect(copyRows(disabled)).toEqual([ false, false, false, false ]);

        vi.mocked(hasTableCellSelection).mockResolvedValue(true);
        const enabled = await build({ isEditable: true, element: cell, selectionText: "" });
        expect(copyRows(enabled)).toEqual([ true, true, true, true ]);

        vi.mocked(buildTableContextMenuSections).mockResolvedValue(null);
        vi.mocked(hasTableCellSelection).mockResolvedValue(false);
    });

    it("ignores the fake-selection label Electron reports over a cell selection", async () => {
        const cell = document.createElement("td");
        vi.mocked(buildTableContextMenuSections).mockResolvedValueOnce({
            main: [ { title: "T1" } ],
            sort: { title: "S" },
            delete: [],
            select: { title: "SEL" },
            pasteRows: []
        } as TableMenuSections);
        vi.mocked(hasTableCellSelection).mockResolvedValueOnce(true);

        const shown = titles(await build({
            isEditable: true,
            element: cell,
            selectionText: "Selected 4 cells"
        }));

        expect(shown).not.toContain("electron_context_menu.search_online");
        expect(shown).not.toContain("electron_context_menu.search_in_trilium");
        expect(shown).toContain("electron_context_menu.copy");
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

    /** A table cell inside an editable, the target a table-section click lands on. */
    function editableTableCell(readOnly = false) {
        const content = codeEditable(readOnly);
        const table = document.createElement("table");
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.textContent = "cell";
        row.appendChild(cell);
        table.appendChild(row);
        content.appendChild(table);
        return cell;
    }

    it("claims a bare-caret right-click on an editable table cell", async () => {
        const cell = editableTableCell();
        setSelection(null, "", "");
        vi.mocked(buildTableContextMenuSections).mockResolvedValueOnce({
            main: [ { title: "table_context_menu.merge_cells" } ],
            sort: { title: "S" },
            delete: [],
            select: { title: "SEL" },
            pasteRows: []
        } as TableMenuSections);

        const event = rightClick(cell);

        expect(event.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(contextMenu.show).toHaveBeenCalled());
        const shown = vi.mocked(contextMenu.show).mock.calls[0][0];
        expect(titles(shown.items)).toContain("table_context_menu.merge_cells");
        expect(vi.mocked(buildTableContextMenuSections).mock.calls[0]?.[0]).toBe(cell);
    });

    it("hands the table section the page's clipboard reader", async () => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                read: vi.fn(async () => [ {
                    types: [ "text/html", "text/plain" ],
                    getType: async (type: string) => ({
                        text: async () => type === "text/html" ? "<table></table>" : "t"
                    })
                } ])
            }
        });

        try {
            setSelection(null, "", "");
            rightClick(editableTableCell());
            await vi.waitFor(() => expect(buildTableContextMenuSections).toHaveBeenCalled());

            const [ , clipboard ] = vi.mocked(buildTableContextMenuSections).mock.calls[0];
            expect(clipboard?.enabled).toBe(true);
            expect(await clipboard?.read()).toEqual({ html: "<table></table>", text: "t" });
        } finally {
            delete (navigator as { clipboard?: unknown }).clipboard;
        }
    });

    it("leaves a table cell to the browser when read-only, non-editable, or Shift is held", async () => {
        setSelection(null, "", "");

        expect(rightClick(editableTableCell(true)).defaultPrevented).toBe(false);

        const bareCell = document.createElement("td");
        document.body.appendChild(bareCell);
        expect(rightClick(bareCell).defaultPrevented).toBe(false);

        expect(rightClick(editableTableCell(), { shiftKey: true }).defaultPrevented).toBe(false);

        await settle();
        expect(contextMenu.show).not.toHaveBeenCalled();
    });

    it("still claims the cell when the table section resolves empty", async () => {
        const cell = editableTableCell();
        setSelection(null, "", "");

        const event = rightClick(cell);

        expect(event.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(contextMenu.show).toHaveBeenCalled());
        const shown = titles(vi.mocked(contextMenu.show).mock.calls[0][0].items);
        expect(shown).not.toContain("table_context_menu.merge_cells");
        expect(shown).toContain("electron_context_menu.copy");
    });

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

    it("copies the editor's plain-text flavor, not the DOM selection's fake label", async () => {
        const editorRoot = codeEditable();
        const anchor = document.createElement("span");
        editorRoot.appendChild(anchor);
        const editor = fakeEditor(editorRoot, "<table><tr><td>a1</td></tr></table>", "a1");
        tabManager.activeNote = { type: "text" };
        tabManager.activeContext = { getTextEditor: async () => editor };
        setSelection(anchor, "", "Selected 1 cell");

        await run(await menuFor(editorRoot), "electron_context_menu.copy");

        expect(copyHtml).toHaveBeenCalledWith("<table><tr><td>a1</td></tr></table>", "a1");
    });

    it("offers paste in a secure context and routes it through the editor's pipeline", async () => {
        const flavor = (type: string) => ({
            text: async () => type === "text/html" ? "<b>hi</b>" : "hi"
        });
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                read: vi.fn(async () => [ {
                    types: [ "text/html", "text/plain" ],
                    getType: async (type: string) => flavor(type)
                } ])
            }
        });

        try {
            const editorRoot = codeEditable();
            const anchor = document.createElement("span");
            editorRoot.appendChild(anchor);
            const editor = fakeEditor(editorRoot, "<p>clean</p>");
            tabManager.activeNote = { type: "text" };
            tabManager.activeContext = { getTextEditor: async () => editor };
            setSelection(anchor, "<p>clean</p>", "clean");

            const rows = await menuFor(editorRoot);
            expect(findItem(rows, "electron_context_menu.paste")?.enabled).toBe(true);

            await run(rows, "electron_context_menu.paste");
            await vi.waitFor(() =>
                expect(editor.pasteTarget.paste).toHaveBeenCalledWith("<b>hi</b>", "hi"));

            // Paste as plain text withholds the HTML flavor.
            await run(submenu(rows, "electron_context_menu.paste"),
                "electron_context_menu.paste-as-plain-text");
            await vi.waitFor(() =>
                expect(editor.pasteTarget.paste).toHaveBeenCalledWith("", "hi"));
            expect(editor.pasteTarget.release).toHaveBeenCalledTimes(2);
        } finally {
            delete (navigator as { clipboard?: unknown }).clipboard;
        }
    });

    it("pins the paste target before reading the clipboard, and releases it on failure", async () => {
        let rejectRead: (error: Error) => void = () => {};
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                read: vi.fn(() => new Promise((_resolve, reject) => {
                    rejectRead = reject;
                }))
            }
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        try {
            const editorRoot = codeEditable();
            const anchor = document.createElement("span");
            editorRoot.appendChild(anchor);
            const editor = fakeEditor(editorRoot, "<p>clean</p>");
            tabManager.activeNote = { type: "text" };
            tabManager.activeContext = { getTextEditor: async () => editor };
            setSelection(anchor, "<p>clean</p>", "clean");

            await run(await menuFor(editorRoot), "electron_context_menu.paste");
            expect(editor.capturePasteTarget).toHaveBeenCalledTimes(1);
            expect(editor.pasteTarget.release).not.toHaveBeenCalled();

            rejectRead(new Error("denied"));
            await vi.waitFor(() => expect(editor.pasteTarget.release).toHaveBeenCalledTimes(1));
            expect(editor.pasteTarget.paste).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalled();
        } finally {
            delete (navigator as { clipboard?: unknown }).clipboard;
        }
    });

    it("pastes into a code note as a typed text insertion", async () => {
        const execCommand = stubExecCommand();
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                read: vi.fn(async () => [
                    { types: [ "text/plain" ], getType: async () => ({ text: async () => "hi" }) }
                ])
            }
        });

        try {
            const content = codeEditable();
            tabManager.activeNote = { type: "code" };
            setSelection(content, "<span>code</span>", "code");

            await run(await menuFor(content), "electron_context_menu.paste");

            await vi.waitFor(() =>
                expect(execCommand).toHaveBeenCalledWith("insertText", false, "hi"));
        } finally {
            delete (navigator as { clipboard?: unknown }).clipboard;
        }
    });

    it("drops the paste rows where the clipboard cannot be read", async () => {
        // Plain HTTP, where the async clipboard API is undefined (#10723).
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });

        try {
            const content = codeEditable();
            tabManager.activeNote = { type: "code" };
            setSelection(content, "<span>code</span>", "code");

            const shown = titles(await menuFor(content));

            expect(shown).not.toContain("electron_context_menu.paste");
            expect(shown).not.toContain("electron_context_menu.paste-as-plain-text");
        } finally {
            delete (navigator as { clipboard?: unknown }).clipboard;
        }
    });

    it("drops the cut row in a read-only code note", async () => {
        const content = codeEditable(true);
        tabManager.activeNote = { type: "code" };
        setSelection(content, "<span>code</span>", "code");

        const rows = await menuFor(content);

        expect(titles(rows)).not.toContain("electron_context_menu.cut");
        expect(titles(rows)).toContain("electron_context_menu.copy");
        expect(titles(submenu(rows, "electron_context_menu.copy")))
            .toContain("electron_context_menu.copy-as-markdown");
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
