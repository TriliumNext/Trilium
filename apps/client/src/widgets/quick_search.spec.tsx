import type { EditorView } from "@codemirror/view";
import type { QuickSearchResponse } from "@triliumnext/commons";
import { options, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context";
import Component from "../components/component";
import { calculateHash } from "../services/link";
import server from "../services/server";
import { renderInto } from "../test/render";
import QuickSearch from "./quick_search";
import { ParentComponent } from "./react/react_utils";
import type { SearchCompletion } from "./ribbon/search_completions";

// The completions fetch attribute names and values through the server, so a spec that opens them
// supplies its own.
const completions = vi.hoisted(() => ({
    at: null as ((before: string, explicit: boolean) => SearchCompletion | null) | null
}));
// Echoes the key and its interpolation, so a spec can tell which message a row shows.
vi.mock("../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/i18n")>()),
    t: (key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key)
}));

vi.mock("./ribbon/search_completions", () => ({
    searchCompletionAt: (before: string, explicit: boolean) => completions.at?.(before, explicit) ?? null
}));

describe("QuickSearch", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        completions.at = null;
    });

    it("renders the search field, focuses it on the quickSearch shortcut and marks a typed query", async () => {
        const host = new Component();
        const { container, editor } = await mount(host);
        const root = container.querySelector(".quick-search");

        expect(root?.querySelector(".search-string .cm-editor")).not.toBeNull();

        expect(editor.hasFocus).toBe(false);
        await act(async () => {
            await host.handleEvent("quickSearch", {});
        });
        expect(editor.hasFocus).toBe(true);

        expect(root?.classList.contains("has-query")).toBe(false);
        typeQuery(editor, "hello");
        expect(root?.classList.contains("has-query")).toBe(true);
        typeQuery(editor, "");
        expect(root?.classList.contains("has-query")).toBe(false);
    });

    it("searches on Enter and lists every result with its highlighted snippets", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(30, [ "hello" ]));
        const { editor } = await mount();

        typeQuery(editor, "  hello ");
        pressEnter(editor);

        expect(get).toHaveBeenCalledWith("quick-search/hello");
        const [ first ] = await waitForResults(30);

        expect(first.getAttribute("href")).toBe(calculateHash({
            notePath: "root/note0",
            viewScope: { searchTerms: [ "hello" ] }
        }));
        // The row already shows the note's path and snippets, so the hover preview stays away.
        expect(first.classList.contains("no-tooltip-preview")).toBe(true);
        expect(first.querySelector(".quick-search-item-icon")?.classList.contains("bx-note")).toBe(true);
        expect(first.querySelector(".search-result-title")?.innerHTML).toBe("<b>Note</b> 0");
        const badges = first.querySelectorAll(".search-result-attributes > .ext-badge.outline");
        const values = [ ...badges ].map((badge) => badge.querySelector(".attribute-badge-value")?.textContent);
        expect(values).toEqual([ "1954", "tolkien" ]);
        expect(first.querySelector(".search-result-content")?.innerHTML).toBe("about <b>hello</b>");
    });

    it("links to the plain note path when the search highlighted nothing", async () => {
        const plain = response(1, []);
        delete plain.searchResults[0].highlightedNotePathTitle;
        vi.spyOn(server, "get").mockResolvedValue(plain);
        const { editor } = await mount();

        typeQuery(editor, "#book");
        pressEnter(editor);

        const [ first ] = await waitForResults(1);
        expect(first.getAttribute("href")).toBe(calculateHash({ notePath: "root/note0" }));
        // Nor its title, which then shows as it stands.
        expect(first.querySelector(".search-result-title")?.innerHTML).toBe("Note 0");
    });

    it("shows progress while searching, then says when nothing matches", async () => {
        const pending = deferred<QuickSearchResponse>();
        vi.spyOn(server, "get").mockReturnValue(pending.promise as never);
        const { editor } = await mount();

        typeQuery(editor, "nothing");
        pressEnter(editor);

        await vi.waitFor(() => expect(placeholderItems()).toHaveLength(1));
        expect(placeholderItems()[0].querySelector(".bx-loader")).not.toBeNull();

        await act(async () => pending.resolve(response(0, [])));
        await vi.waitFor(() => expect(placeholderItems()[0]?.querySelector(".bx-loader")).toBeNull());
        expect(placeholderItems()).toHaveLength(1);
        expect(resultItems()).toHaveLength(0);
    });

    it("shows the error the search ran into, above whatever it still found", async () => {
        const failed = { ...response(0, []), error: "Note content can be searched only with operators" };
        const get = vi.spyOn(server, "get").mockResolvedValue(failed);
        const { editor } = await mount();

        typeQuery(editor, "note.content > 3");
        pressEnter(editor);

        // In place of "No results found", which would hide why.
        const error = await vi.waitFor(() => {
            const row = menu()?.querySelector(".quick-search-error");
            expect(row).not.toBeNull();
            return row;
        });
        // A caution card titled as an error, with the server's message as its body.
        expect(error?.classList.contains("extended-admonition")).toBe(true);
        expect(error?.classList.contains("caution")).toBe(true);
        expect(error?.querySelector(".admonition-title")?.textContent).toBe("search_string.error_title");
        expect(error?.querySelector(".admonition-body")?.textContent)
            .toBe("Note content can be searched only with operators");
        expect(placeholderItems()).toEqual([]);

        get.mockResolvedValue({ ...response(2, []), error: "Note content can be searched only with operators" });
        pressEnter(editor);
        await waitForResults(2);
        expect(menu()?.querySelector(".quick-search-results")?.firstElementChild?.classList.contains("quick-search-error")).toBe(true);
    });

    it("keeps the results of the latest search when an earlier one answers last", async () => {
        const earlier = deferred<QuickSearchResponse>();
        const later = deferred<QuickSearchResponse>();
        vi.spyOn(server, "get")
            .mockReturnValueOnce(earlier.promise as never)
            .mockReturnValueOnce(later.promise as never);
        const { editor } = await mount();

        typeQuery(editor, "first");
        pressEnter(editor);
        await vi.waitFor(() => expect(menu()).not.toBeNull());

        // Enter on open results runs the search again.
        typeQuery(editor, "second");
        pressEnter(editor);

        await act(async () => later.resolve(response(2, [])));
        await act(async () => earlier.resolve(response(5, [])));
        await waitForResults(2);
    });

    it("leaves the results closed for an empty query, and closes them when one is opened", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { editor } = await mount();

        typeQuery(editor, "   ");
        pressEnter(editor);
        await act(async () => {});
        expect(get).not.toHaveBeenCalled();
        expect(menu()).toBeNull();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const [ first ] = await waitForResults(3);

        await act(async () => first.click());
        await vi.waitFor(() => expect(menu()).toBeNull());
    });

    it("opens and closes the results from the search button", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { container, editor } = await mount();
        const button = container.querySelector<HTMLButtonElement>(".search-button");
        if (!button) throw new Error("The search button did not render.");

        typeQuery(editor, "hello");
        await act(async () => button.click());
        await waitForResults(3);
        expect(get).toHaveBeenCalledWith("quick-search/hello");
        expect(button.classList.contains("active")).toBe(true);

        await act(async () => button.click());
        await vi.waitFor(() => expect(menu()).toBeNull());
        expect(button.classList.contains("active")).toBe(false);
    });

    it("moves between the results with Up and Down, and gives the field focus back on Escape", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { editor } = await mount();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const [ first, second ] = await waitForResults(3);

        const press = (target: HTMLElement, key: string) => act(() => {
            target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        });
        first.focus();
        // A key the results do not answer stays where it was pressed.
        expect(first.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true })))
            .toBe(true);
        expect(document.activeElement).toBe(first);

        press(first, "ArrowDown");
        expect(document.activeElement).toBe(second);
        press(second, "ArrowUp");
        expect(document.activeElement).toBe(first);

        press(first, "Escape");
        await vi.waitFor(() => expect(menu()).toBeNull());
        expect(editor.hasFocus).toBe(true);
    });

    it("steps from the field into the first result on ArrowDown, and back on ArrowUp", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { editor } = await mount();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const [ first ] = await waitForResults(3);
        editor.focus();

        // A modifier leaves the key to the field.
        pressArrowDown(editor, { ctrlKey: true });
        pressArrowDown(editor, { shiftKey: true });
        expect(editor.hasFocus).toBe(true);

        pressArrowDown(editor);
        expect(document.activeElement).toBe(first);

        act(() => {
            first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
        });
        expect(editor.hasFocus).toBe(true);
        expect(menu()).not.toBeNull();
    });

    it("lets the keys and the pointer take turns marking a result", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { editor } = await mount();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const [ first, , third ] = await waitForResults(3);
        editor.focus();

        // With focus in the field, a pointer moving over a result leaves the focus there.
        movePointer(third, 4);
        expect(editor.hasFocus).toBe(true);

        // The keys mark their row and silence the hover a resting pointer would add.
        pressArrowDown(editor);
        expect(document.activeElement).toBe(first);
        expect(menu()?.classList.contains("tn-menu-keyboard")).toBe(true);

        // A pointer that does not move, as when a row slides under it, changes nothing.
        movePointer(third, 0);
        expect(document.activeElement).toBe(first);

        // A pointer that moves takes over: its row gets the focus, so the keys go on from there.
        movePointer(third, 4);
        expect(document.activeElement).toBe(third);
        expect(menu()?.classList.contains("tn-menu-keyboard")).toBe(false);
    });

    it("moves a page of results at a time with PageDown and PageUp", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(30, []));
        const { editor } = await mount();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const rows = await waitForResults(30);

        // Rows 50px tall in a scroller that shows four of them.
        const scroller = menu()?.querySelector<HTMLElement>(".quick-search-results");
        if (!scroller) throw new Error("The results did not render.");
        Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 200 });
        for (const [ index, row ] of rows.entries()) {
            Object.defineProperty(row, "offsetTop", { configurable: true, get: () => index * 50 });
        }

        const press = (key: string) => act(() => {
            document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        });
        rows[0].focus();
        press("PageDown");
        expect(document.activeElement).toBe(rows[4]);
        expect(menu()?.classList.contains("tn-menu-keyboard")).toBe(true);
        press("PageUp");
        expect(document.activeElement).toBe(rows[0]);

        // Held at either end rather than wrapping round.
        press("PageUp");
        expect(document.activeElement).toBe(rows[0]);
        rows[27].focus();
        press("PageDown");
        expect(document.activeElement).toBe(rows[29]);
        press("PageDown");
        expect(document.activeElement).toBe(rows[29]);
    });

    it("drops an open completion list on Escape before the results", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        completions.at = (before, explicit) => (explicit ? {
            kind: "entries", key: "keywords", from: before.length, query: "", preselect: true,
            entries: () => [ { id: "and", title: "and", insert: "and" }, { id: "asc", title: "asc", insert: "asc" } ]
        } : null);
        const { editor } = await mount();

        typeQuery(editor, "a");
        pressEnter(editor);
        await waitForResults(3);
        editor.focus();

        act(() => {
            editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true, bubbles: true, cancelable: true }));
        });
        const completionList = () => document.querySelector(".note-autocomplete-menu:not(.quick-search-menu)");
        await vi.waitFor(() => expect(completionList()).not.toBeNull());

        pressKey(editor.contentDOM, "Escape");
        await vi.waitFor(() => expect(completionList()).toBeNull());
        expect(menu()).not.toBeNull();

        pressKey(editor.contentDOM, "Escape");
        await vi.waitFor(() => expect(menu()).toBeNull());
        expect(editor.hasFocus).toBe(true);

        // With the results closed, Escape is left to whatever the field sits in.
        expect(editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Escape", bubbles: true, cancelable: true
        }))).toBe(true);
    });

    it("leaves ArrowDown to the field while the results are closed or hold nothing to focus", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(0, []));
        const { editor } = await mount();

        typeQuery(editor, "nothing");
        editor.focus();
        pressArrowDown(editor);
        expect(editor.hasFocus).toBe(true);
        expect(menu()).toBeNull();

        pressEnter(editor);
        await vi.waitFor(() => expect(get).toHaveBeenCalled());
        await vi.waitFor(() => expect(placeholderItems()[0]?.querySelector(".bx-loader")).toBeNull());
        pressArrowDown(editor);
        expect(editor.hasFocus).toBe(true);
    });

    it("hands the query to the full search from a footer below the results, and on Ctrl+Enter", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(30, []));
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const { editor } = await mount();

        typeQuery(editor, " #book AND tolkien ");
        pressEnter(editor);
        await waitForResults(30);

        // Pinned below the scroller rather than at the end of the list, so it is always in reach.
        const footer = menu()?.lastElementChild;
        expect(footer?.classList.contains("quick-search-footer")).toBe(true);
        const button = footer?.querySelector<HTMLButtonElement>(".show-in-full-search");
        if (!button) throw new Error("The footer has no full search button.");
        // Its key is in the shortcut hints, not on the button.
        expect(button.querySelector("kbd")).toBeNull();

        await act(async () => button.click());
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "#book AND tolkien" });
        await vi.waitFor(() => expect(menu()).toBeNull());

        // From the field too, with the results closed.
        triggerCommand.mockClear();
        act(() => {
            editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter", ctrlKey: true, bubbles: true, cancelable: true
            }));
        });
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "#book AND tolkien" });
        expect(menu()).toBeNull();
    });

    it("opens the shortcut hints from the footer, and stays open for a press in them", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        const { editor } = await mount();

        typeQuery(editor, "hello");
        pressEnter(editor);
        await waitForResults(3);

        const button = menu()?.querySelector<HTMLButtonElement>(".quick-search-footer .shortcut-hint-button");
        if (!button) throw new Error("The footer has no shortcut hints button.");
        await act(async () => button.click());

        const [ name, data ] = triggerEvent.mock.calls.find(([ event ]) => event === "shortcutHintsRequested") ?? [];
        expect(name).toBe("shortcutHintsRequested");
        const titles = (data as { sections: { titleKey?: string }[] }).sections.map((section) => section.titleKey);
        expect(titles).toEqual(expect.arrayContaining([ "search_string.hints.title", "quick-search.hints.title" ]));

        const pane = document.createElement("div");
        pane.className = "shortcut-hints-panel";
        document.body.append(pane);
        act(() => {
            pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        });
        expect(menu()).not.toBeNull();
        pane.remove();
    });

    it("leaves the open results alone while the query is typed", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(15, []));
        const { editor } = await mount();

        typeQuery(editor, "h");
        pressEnter(editor);
        await waitForResults(15);

        let resultRenders = 0;
        const previousDiffed = options.diffed;
        options.diffed = (vnode: VNode) => {
            if (typeof vnode.type === "function" && vnode.type.name === "QuickSearchResult") resultRenders++;
            previousDiffed?.(vnode);
        };
        try {
            typeQuery(editor, "he");
            typeQuery(editor, "hel");
            typeQuery(editor, "hell");
        } finally {
            options.diffed = previousDiffed;
        }
        expect(resultRenders).toBe(0);
    });

    it("stands the results under the search box, which a press does not close them from", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        // happy-dom lays nothing out, so the viewport is given a size to place the popup in.
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        const { container, editor } = await mount();
        const box = container.querySelector<HTMLElement>(".quick-search-box");
        if (!box) throw new Error("The search box did not render.");
        vi.spyOn(box, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 20, y: 40, width: 300, height: 30 }));

        typeQuery(editor, "hello");
        pressEnter(editor);
        await waitForResults(3);
        await vi.waitFor(() => expect(menu()?.style.left).toBe("20px"));

        await act(async () => {
            editor.contentDOM.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        });
        expect(menu()).not.toBeNull();
    });
});

/** Renders the component and waits for the CodeMirror modules it imports on demand. */
async function mount(host = new Component()) {
    let container: HTMLDivElement | undefined;
    act(() => {
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <QuickSearch />
            </ParentComponent.Provider>
        );
    });
    if (!container) {
        throw new Error("The component did not render.");
    }

    const { EditorView } = await import("@codemirror/view");
    let editor: EditorView | null = null;
    for (let attempt = 0; attempt < 50 && !editor; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const dom = container.querySelector(".cm-editor");
        editor = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
    }

    if (!editor) {
        throw new Error(`The editor did not mount: ${container.innerHTML}`);
    }

    return { container, editor };
}

function typeQuery(editor: EditorView, value: string) {
    act(() => {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    });
}

function pressEnter(editor: EditorView) {
    act(() => {
        editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", code: "Enter", bubbles: true, cancelable: true
        }));
    });
}

function pressArrowDown(editor: EditorView, modifiers: KeyboardEventInit = {}) {
    act(() => {
        editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true, ...modifiers
        }));
    });
}

function pressKey(target: Element, key: string) {
    act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
}

function movePointer(target: HTMLElement, movement: number) {
    act(() => {
        target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: movement }));
    });
}

/** The popup is portaled to `<body>`, outside the rendered container. */
function menu() {
    return document.querySelector<HTMLElement>(".quick-search-menu");
}

function resultItems() {
    return Array.from(menu()?.querySelectorAll<HTMLAnchorElement>(".quick-search-results > a.dropdown-item") ?? []);
}

async function waitForResults(count: number) {
    return vi.waitFor(() => {
        const items = resultItems();
        expect(items).toHaveLength(count);
        return items;
    });
}

/** The disabled row that stands in for results while searching, or when nothing matches. */
function placeholderItems() {
    return Array.from(menu()?.querySelectorAll(".dropdown-item.disabled") ?? []);
}

function response(count: number, highlightedTokens: string[]): QuickSearchResponse {
    const searchResults = Array.from({ length: count }, (_, index) => ({
        noteId: `note${index}`,
        notePath: `root/note${index}`,
        noteTitle: `Note ${index}`,
        notePathTitle: `Note ${index}`,
        highlightedNotePathTitle: `<b>Note</b> ${index}`,
        highlightedAttributeSnippet: "#year=&quot;1954&quot;<br>#author=&quot;tolkien&quot;",
        highlightedContentSnippet: "about <b>hello</b>",
        icon: "bx bx-note"
    }));

    return {
        searchResultNoteIds: searchResults.map((result) => result.noteId),
        searchResults,
        highlightedTokens,
        error: null
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
