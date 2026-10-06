import { createRef, render as preactRender } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteSuggestions, getCommandSuggestions, createNoteFromSuggestion } = vi.hoisted(() => ({
    createNoteFromSuggestion: vi.fn<(suggestion: Suggestion, childParentNotePath?: string | null) => Promise<string | undefined>>(),
    getNoteSuggestions: vi.fn<(term: string, options?: NoteSuggestionOptions) => Promise<Suggestion[]>>(async () => []),
    getCommandSuggestions: vi.fn<(term: string) => Suggestion[]>(() => [])
}));

vi.mock("../../services/note_autocomplete", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/note_autocomplete")>()),
    getNoteSuggestions,
    getCommandSuggestions,
    createNoteFromSuggestion
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type { NoteSuggestionOptions, Suggestion } from "../../services/note_autocomplete";
import { collectShortcutHints } from "../../services/shortcut_hints";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import type { AutocompleteListHandle } from "./FormAutocomplete";
import NoteAutocomplete, { filterCommandEntries, HighlightedText, type NoteAutocompleteHandle, type NoteAutocompleteProps, NoteMentionList } from "./NoteAutocomplete";
import { ParentComponent } from "./react_utils";

async function render(props: NoteAutocompleteProps = {}) {
    let container = document.createElement("div");
    await act(async () => {
        container = renderInto(<NoteAutocomplete {...props} />);
    });
    // Lets `froca.getNote()` resolve the title of a `noteId`.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });

    const input = container.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("no input rendered");
    return { container, input };
}

/** The classes of the buttons after the input, in document order. */
function buttonClasses(container: HTMLElement) {
    return [ ...container.querySelectorAll(".input-group > a") ].map((button) => button.className);
}

describe("NoteAutocomplete", () => {
    it("renders the input with its classes and attributes", async () => {
        const { container, input } = await render({ id: "picker", placeholder: "Find" });

        expect(container.firstElementChild?.className).toBe("input-group");
        expect(input.className).toBe("note-autocomplete form-control note-autocomplete-input");
        expect(input.id).toBe("picker");
        expect(input.placeholder).toBe("Find");
        expect(input.getAttribute("autocomplete")).toBe("off");
        expect(input.getAttribute("dir")).toBe("auto");
    });

    it("sets tabIndex on the input only when the host gives one", async () => {
        expect((await render({ tabIndex: 205 })).input.getAttribute("tabindex")).toBe("205");
        expect((await render()).input.hasAttribute("tabindex")).toBe(false);
    });

    it("places the buttons after the input in the plugin's order, as the options allow", async () => {
        expect(buttonClasses((await render()).container)).toEqual([
            "input-group-text go-to-selected-note-button bx bx-arrow-to-right disabled",
            "input-group-text input-clearer-button bx bxs-tag-x"
        ]);

        const withoutGoTo = buttonClasses((await render({ opts: { hideGoToSelectedNoteButton: true } })).container);
        expect(withoutGoTo).toEqual([ "input-group-text input-clearer-button bx bxs-tag-x" ]);

        expect(buttonClasses((await render({ opts: { hideAllButtons: true } })).container)).toEqual([]);
    });

    it("shows the title of the note given, and enables going to it", async () => {
        const note = buildNote({ title: "Target" });
        const { container, input } = await render({ noteId: note.noteId });

        expect(input.value).toBe("Target");
        expect(input.dataset.notePath).toBe(note.noteId);
        const goTo = container.querySelector(".go-to-selected-note-button");
        expect(goTo?.classList.contains("disabled")).toBe(false);
        expect(goTo?.getAttribute("href")).toBe(`#${note.noteId}`);
    });

    it("shows the text given, trimmed, with no note selected", async () => {
        const { container, input } = await render({ text: "  query " });

        expect(input.value).toBe("query");
        expect(input.dataset.notePath).toBe("");
        expect(container.querySelector(".go-to-selected-note-button")?.getAttribute("href")).toBe("#");
    });

    it("reports typing, and the selected note id on blur", async () => {
        const note = buildNote({ title: "Target" });
        const onTextChange = vi.fn();
        const onBlur = vi.fn();
        const { input } = await render({ noteId: note.noteId, onTextChange, onBlur });

        await act(async () => {
            input.value = "Targ";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(onTextChange).toHaveBeenCalledWith("Targ");

        await act(async () => {
            input.focus();
            input.blur();
        });
        expect(onBlur).toHaveBeenLastCalledWith(note.noteId);

        await act(async () => {
            input.value = " ";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            input.focus();
            input.blur();
        });
        expect(onBlur).toHaveBeenLastCalledWith("");
    });
});

describe("NoteAutocomplete's suggestion list", () => {
    const notes: Suggestion[] = [
        { notePath: "root/a", noteTitle: "Alpha", notePathTitle: "Alpha", highlightedNotePathTitle: "<b>Al</b>pha", icon: "bx bx-file" },
        { notePath: "root/x/b", noteTitle: "Beta", notePathTitle: "X / Beta", highlightedNotePathTitle: "X / Beta",
            highlightedAttributeSnippet: "#tag<br>#status=&quot;<b>al</b>&quot;" }
    ];
    const commands: Suggestion[] = [
        { action: "command", commandId: "cmd1", noteTitle: "Cmd One", highlightedNotePathTitle: "Cmd One",
            commandDescription: "Does a thing", commandShortcut: "Ctrl+1", icon: "bx bx-cog" },
        { action: "command", commandId: "cmd2", noteTitle: "Cmd Two", highlightedNotePathTitle: "Cmd Two" }
    ];

    beforeEach(() => {
        vi.useFakeTimers();
        getNoteSuggestions.mockReset();
        getNoteSuggestions.mockResolvedValue(notes);
        getCommandSuggestions.mockReset();
        getCommandSuggestions.mockReturnValue(commands);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function mount(props: NoteAutocompleteProps = {}) {
        let input: HTMLInputElement | null = null;
        await act(async () => {
            input = renderInto(<NoteAutocomplete {...props} />).querySelector("input");
        });
        if (!input) throw new Error("no input rendered");
        return input as HTMLInputElement;
    }

    /** Lets the debounced lookup run and the popup place itself. */
    async function settle() {
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    }

    async function type(input: HTMLInputElement, text: string) {
        await act(async () => {
            input.value = text;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await settle();
    }

    async function press(input: HTMLInputElement, key: string, modifiers: KeyboardEventInit = {}) {
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
        });
        await settle();
    }

    /** The queries the notes were looked up for, in order. */
    function queries() {
        return getNoteSuggestions.mock.calls.map(([ query ]) => query);
    }

    /** The rows of the popup, without the full-text search row a non-blank query always ends with. */
    function rows() {
        return allRows().filter((row) => row !== fullTextRow());
    }

    function allRows() {
        return [ ...document.querySelectorAll<HTMLElement>(".note-autocomplete-menu > .tn-menu-scroll > .dropdown-item") ];
    }

    function fullTextRow() {
        return allRows().find((row) => row.querySelector(".bx-search"));
    }

    it("groups the recent notes under headings by when they were visited, which the keys step over", async () => {
        const today = new Date();
        const daysAgo = (days: number) =>
            new Date(today.getFullYear(), today.getMonth(), today.getDate() - days, 0, 1).toISOString().replace("T", " ");
        getNoteSuggestions.mockResolvedValue([
            { ...notes[0], utcDateVisited: daysAgo(0) },
            { ...notes[1], utcDateVisited: daysAgo(0) },
            { notePath: "root/c", noteTitle: "Gamma", highlightedNotePathTitle: "Gamma", utcDateVisited: daysAgo(40) }
        ]);
        const input = await mount();
        await act(async () => { input.focus(); });
        await settle();

        const menu = document.querySelector(".note-autocomplete-menu .tn-menu-scroll");
        const layout = [ ...(menu?.children ?? []) ].map((child) =>
            child.querySelector(".dropdown-header") ? "heading" : child.className.split(" ")[0]);
        expect(layout).toEqual([ "heading", "dropdown-item", "dropdown-item", "heading", "dropdown-item" ]);
        expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);
        await press(input, "ArrowUp");
        expect(rows()[2].classList.contains("tn-menu-active")).toBe(true);

        // A search's results carry no visit times, and no headings.
        getNoteSuggestions.mockResolvedValue(notes);
        await type(input, "al");
        expect(document.querySelector(".note-autocomplete-menu .dropdown-header")).toBeNull();
    });

    it("reports the highlighted suggestion as the keys move, and none once the list closes", async () => {
        const onHighlight = vi.fn();
        const input = await mount({ onHighlight });
        await type(input, "al");
        expect(onHighlight).toHaveBeenLastCalledWith(notes[0]);

        await press(input, "ArrowDown");
        expect(onHighlight).toHaveBeenLastCalledWith(notes[1]);

        await press(input, "Escape");
        expect(onHighlight).toHaveBeenLastCalledWith(undefined);
    });

    it("shows a note's title first and the path to it after, while other rows keep their one title", async () => {
        getNoteSuggestions.mockResolvedValue([
            { ...notes[1], highlightedNoteTitle: "<b>Be</b>ta", highlightedParentPathTitle: "X" },
            { ...notes[0], highlightedNoteTitle: "Alpha", highlightedParentPathTitle: "" },
            { action: "create-note", noteTitle: "be", highlightedNotePathTitle: "Create be" }
        ]);
        const input = await mount();
        await type(input, "be");

        const [ beta, alpha ] = rows();
        expect(beta.querySelector(".search-result-title")?.innerHTML).toBe("<b>Be</b>ta");
        // Wrapped, so a path too long for the row can be cut at its start, keeping the nearest parents.
        expect(beta.querySelector(".note-suggestion-path > span")?.innerHTML).toBe("X");
        // A top-level note has no path to show.
        expect(alpha.querySelector(".note-suggestion-path")).toBeNull();
        const create = allRows().find((row) => row.querySelector(".bx-plus"));
        expect(create?.querySelector(".search-result-title")?.textContent).toBe("Create be");
        expect(create?.querySelector(".note-suggestion-path")).toBeNull();
    });

    it("lists the notes as the rows of a menu, the first one highlighted", async () => {
        const input = await mount();
        await type(input, "al");

        expect(queries().at(-1)).toBe("al");
        const [ alpha, beta ] = rows();
        expect(rows()).toHaveLength(2);
        expect(document.querySelector(".note-autocomplete-menu")?.className)
            .toContain("dropdown-menu show tn-dropdown-menu tn-menu-keyboard");
        expect(alpha.className).toBe("dropdown-item tn-menu-active");
        expect(alpha.querySelector(".tn-icon")?.className).toBe("bx bx-file tn-icon");
        expect(alpha.querySelector(".search-result-title")?.innerHTML).toBe("<b>Al</b>pha");
        expect(beta.querySelector(".tn-icon")?.className).toBe("bx bx-note tn-icon");
        // One outline badge per attribute, its highlight kept.
        const badges = beta.querySelectorAll(".note-suggestion-attributes > .ext-badge.outline");
        const names = [ ...badges ].map((badge) => badge.querySelector(".attribute-badge-name")?.textContent);
        expect(names).toEqual([ "tag", "status" ]);
        expect(badges[1].querySelector(".attribute-badge-value b")?.textContent).toBe("al");
        expect(input.getAttribute("aria-expanded")).toBe("true");
        expect(input.getAttribute("aria-activedescendant")).toBe(alpha.id);
    });

    it("gives each kind of row its icon, and never shows a content snippet", async () => {
        getNoteSuggestions.mockResolvedValue([
            { action: "search-notes", highlightedNotePathTitle: "S" },
            { action: "create-note", highlightedNotePathTitle: "C" },
            { action: "create-child-note", highlightedNotePathTitle: "C" },
            { action: "external-link", highlightedNotePathTitle: "E" },
            // The list matches by title and attributes, so a body excerpt would suggest a content
            // match that fast search never made.
            { notePath: "root/c", highlightedNotePathTitle: "T", highlightedContentSnippet: "some <b>matched</b> content" } as Suggestion
        ]);
        const input = await mount();
        await type(input, "x");

        expect(rows().map((row) => row.querySelector(".tn-icon")?.className)).toEqual([
            "bx bx-file-find tn-icon", "bx bx-plus tn-icon", "bx bx-subdirectory-right tn-icon", "bx bx-link-external tn-icon", "bx bx-note tn-icon"
        ]);
        expect(rows()[4].textContent).toBe("T");
    });

    it("picks the highlighted note with Enter, and reports it", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const input = await mount({ onChange, noteIdChanged });
        await type(input, "b");
        await press(input, "ArrowDown");
        expect(rows()[1].classList.contains("tn-menu-active")).toBe(true);

        await press(input, "Enter");
        expect(onChange).toHaveBeenCalledWith(notes[1]);
        expect(noteIdChanged).toHaveBeenCalledWith("b");
        expect(input.value).toBe("Beta");
        expect(input.dataset.notePath).toBe("root/x/b");
        expect(rows()).toHaveLength(0);
    });

    it("scrolls the highlighted row into view for the keyboard, not for the pointer", async () => {
        const scrollIntoView = vi.fn();
        const original = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = scrollIntoView;
        try {
            const input = await mount();
            await type(input, "b");
            scrollIntoView.mockClear();

            await act(async () => {
                rows()[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 40 }));
            });
            expect(rows()[1].classList.contains("tn-menu-active")).toBe(true);
            expect(scrollIntoView).not.toHaveBeenCalled();

            await press(input, "ArrowUp");
            expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);
            expect(scrollIntoView).toHaveBeenCalledOnce();
        } finally {
            HTMLElement.prototype.scrollIntoView = original;
        }
    });

    it("keeps the keyboard's row when the list moves under a pointer that does not", async () => {
        const input = await mount();
        await type(input, "b");
        const hoverAt = async (row: HTMLElement, type: string, clientY: number) => {
            await act(async () => {
                row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY }));
            });
        };

        await hoverAt(rows()[1], "mousemove", 40);
        expect(rows()[1].classList.contains("tn-menu-active")).toBe(true);
        await press(input, "ArrowUp");
        expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);

        // Scrolling slides another row under the pointer: the browser reports it entering, and can
        // report a move at the same spot.
        await hoverAt(rows()[1], "mouseenter", 40);
        await hoverAt(rows()[1], "mousemove", 40);
        expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);

        // A pointer that moves takes the row again.
        await hoverAt(rows()[1], "mousemove", 44);
        expect(rows()[1].classList.contains("tn-menu-active")).toBe(true);
    });

    // Issue #5669: a second Enter that arrives before the list re-renders submits the host's form
    // rather than picking a row of the list the first Enter closed.
    it("leaves a second Enter in the same task to the host", async () => {
        const onChange = vi.fn();
        const input = await mount({ onChange });
        await type(input, "b");
        await press(input, "ArrowDown");

        const prevented: boolean[] = [];
        await act(async () => {
            for (let i = 0; i < 2; i++) {
                const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
                input.dispatchEvent(e);
                prevented.push(e.defaultPrevented);
            }
        });

        expect(prevented).toEqual([ true, false ]);
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith(notes[1]);
    });

    it("holds an Enter pressed before the newer query's notes come, then picks among them", async () => {
        const onChange = vi.fn();
        const input = await mount({ onChange });
        await type(input, "al");
        expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);

        let resolve: (suggestions: Suggestion[]) => void = () => {};
        getNoteSuggestions.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        await type(input, "be");
        const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        await act(async () => { input.dispatchEvent(enter); });

        expect(enter.defaultPrevented).toBe(true);
        expect(onChange).not.toHaveBeenCalled();

        await act(async () => { resolve([ notes[1] ]); });
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith(notes[1]);
    });

    it("drops a held Enter once the text changes again", async () => {
        const onChange = vi.fn();
        const input = await mount({ onChange });
        await type(input, "al");

        let resolve: (suggestions: Suggestion[]) => void = () => {};
        getNoteSuggestions.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        await type(input, "be");
        await press(input, "Enter");
        await type(input, "bet");

        await act(async () => { resolve([ notes[1] ]); });
        await settle();
        expect(onChange).not.toHaveBeenCalled();
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("bet", expect.anything());
        expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);
    });

    it("searches on the first keystroke, and paces the rest of a burst", async () => {
        const input = await mount();

        for (const term of [ "a", "al", "alp" ]) {
            await act(async () => {
                input.value = term;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
        }
        // No timer has run, so the debounce of `FormAutocomplete` would not have searched yet.
        expect(queries()).toEqual([ "a" ]);

        await settle();
        expect(queries()).toEqual([ "a", "alp" ]);
    });

    it("lists the recent notes when an empty field gets focus, and waits for typing in a filled one", async () => {
        const input = await mount();
        await act(async () => { input.focus(); });
        await settle();
        expect(queries().at(-1)).toBe("");
        expect(rows()).toHaveLength(2);

        await type(input, "a");
        await press(input, "Enter");
        await act(async () => { input.blur(); });
        getNoteSuggestions.mockClear();

        await act(async () => { input.focus(); });
        await settle();
        expect(queries()).toEqual([]);
        expect(rows()).toHaveLength(0);
    });

    it("lists the recent notes through the handle, with the callbacks of the latest render", async () => {
        const handleRef = createRef<NoteAutocompleteHandle>();
        const firstOnTextChange = vi.fn();
        let container = document.createElement("div");
        await act(async () => {
            container = renderInto(<NoteAutocomplete handleRef={handleRef} onTextChange={firstOnTextChange} />);
        });
        const input = container.querySelector("input");
        if (!input) throw new Error("no input rendered");
        await type(input, "a");
        await press(input, "Enter");

        const latestOnTextChange = vi.fn();
        await act(async () => {
            preactRender(<NoteAutocomplete handleRef={handleRef} onTextChange={latestOnTextChange} />, container);
        });
        input.blur();
        firstOnTextChange.mockClear();

        await act(async () => { handleRef.current?.showRecentNotes(); });
        await settle();

        expect(input.value).toBe("");
        expect(input.dataset.notePath).toBe("");
        expect(latestOnTextChange).toHaveBeenCalledWith("");
        expect(firstOnTextChange).not.toHaveBeenCalled();
        expect(queries().at(-1)).toBe("");
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).toBe(input);
    });

    it("lists into the host's container, open past a blur, Escape and Tab, until a pick", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const input = await mount({ container: { current: host } });
        await type(input, "a");

        const menu = host.querySelector<HTMLElement>(":scope > menu.note-suggestion-list");
        expect(menu?.querySelectorAll(":scope > .dropdown-item")).toHaveLength(3);
        // In the host's flow, with no position of its own.
        expect(menu?.hasAttribute("style")).toBe(false);
        expect(document.querySelector(".dropdown-menu.note-autocomplete-menu")).toBeNull();
        // Drawn as the popup draws its rows.
        const beta = menu?.querySelectorAll<HTMLElement>(".dropdown-item")[1];
        expect(beta?.querySelector(".tn-icon")?.className).toBe("bx bx-note tn-icon");
        expect(beta?.querySelector(".search-result-title")?.innerHTML).toBe("X / Beta");
        expect(beta?.querySelectorAll(".note-suggestion-attributes > .ext-badge")).toHaveLength(2);

        await act(async () => {
            input.focus();
            input.blur();
        });
        expect(host.querySelectorAll(".dropdown-item")).toHaveLength(3);

        // Both are left to the host, as a dialog closes on Escape.
        const reachedHost: string[] = [];
        const listen = (e: KeyboardEvent) => reachedHost.push(e.key);
        document.body.addEventListener("keydown", listen);
        await press(input, "Escape");
        await press(input, "Tab");
        document.body.removeEventListener("keydown", listen);
        expect(host.querySelectorAll(".dropdown-item")).toHaveLength(3);
        expect(reachedHost).toEqual([ "Escape", "Tab" ]);

        await press(input, "Enter");
        expect(host.querySelector(".note-suggestion-list")).toBeNull();
        host.remove();
    });

    it("lists the commands for a `>` in a command palette, as menu rows", async () => {
        // In a host's container, as Jump to Note lists them.
        const host = document.createElement("div");
        document.body.append(host);
        const input = await mount({ opts: { isCommandPalette: true }, container: { current: host } });
        await type(input, "> cmd");

        expect(getCommandSuggestions).toHaveBeenLastCalledWith("> cmd");
        expect(getNoteSuggestions).not.toHaveBeenCalled();
        const [ described, bare ] = host.querySelectorAll<HTMLElement>(".note-suggestion-list > .dropdown-item");
        expect(described.querySelector(".tn-icon")?.className).toBe("bx bx-cog tn-icon");
        expect(described.querySelector(".search-result-title")?.textContent).toBe("Cmd One");
        expect(described.querySelector(".note-suggestion-description")?.textContent).toBe("Does a thing");
        // One key each, drawn as a search row's are.
        expect(described.querySelectorAll(".note-suggestion-shortcut > kbd")).toHaveLength(2);
        expect(bare.querySelector(".tn-icon")?.className).toBe("bx bx-terminal tn-icon");
        expect(bare.querySelector(".note-suggestion-description, kbd")).toBeNull();
        host.remove();

        // Elsewhere a `>` is only text to search for.
        const plain = await mount();
        await type(plain, "> cmd");
        expect(queries().at(-1)).toBe("> cmd");
        expect(getCommandSuggestions).toHaveBeenCalledTimes(1);
    });

    it("reports a picked command and leaves the field as it was", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const input = await mount({ opts: { isCommandPalette: true }, onChange, noteIdChanged });
        await type(input, ">");
        await press(input, "Enter");

        expect(onChange).toHaveBeenCalledWith(commands[0]);
        expect(noteIdChanged).not.toHaveBeenCalled();
        expect(input.value).toBe(">");
        expect(input.dataset.notePath).toBe("");
        expect(rows()).toHaveLength(0);
    });

    it("lists every command through the handle", async () => {
        const handleRef = createRef<NoteAutocompleteHandle>();
        const onTextChange = vi.fn();
        const input = await mount({ opts: { isCommandPalette: true }, handleRef, onTextChange });

        await act(async () => { handleRef.current?.showAllCommands(); });
        await settle();

        expect(input.value).toBe(">");
        expect(onTextChange).toHaveBeenLastCalledWith(">");
        expect(getCommandSuggestions).toHaveBeenLastCalledWith(">");
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).toBe(input);
    });

    it("lists the suggestions for the text given", async () => {
        const onTextChange = vi.fn();
        const input = await mount({ text: "  al ", onTextChange });
        await settle();

        expect(input.value).toBe("al");
        expect(onTextChange).toHaveBeenCalledWith("al");
        expect(queries().at(-1)).toBe("al");
        expect(rows()).toHaveLength(2);
    });

    it("sets the text through the handle at once, with its note selected, and lists it", async () => {
        const handleRef = createRef<NoteAutocompleteHandle>();
        const input = await mount({ handleRef });
        input.blur();

        // Read before any render, as Add Link selects the text right after the call.
        act(() => {
            handleRef.current?.setText("  Beta ", "root/x/b");
            expect(input.value).toBe("Beta");
        });
        await settle();

        expect(input.dataset.notePath).toBe("root/x/b");
        expect(queries().at(-1)).toBe("Beta");
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).not.toBe(input);
    });

    function button(selector: string) {
        const found = document.querySelector<HTMLElement>(selector);
        if (!found) throw new Error(`no ${selector} rendered`);
        return found;
    }

    it("empties the field and reports a cleared selection from the clear button", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const onTextChange = vi.fn();
        const input = await mount({ onChange, noteIdChanged, onTextChange });
        await type(input, "a");
        await press(input, "Enter");

        await act(async () => { button(".input-clearer-button").click(); });

        expect(input.value).toBe("");
        expect(input.dataset.notePath).toBe("");
        expect(onTextChange).toHaveBeenLastCalledWith("");
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(noteIdChanged).toHaveBeenLastCalledWith(undefined);
    });

    it("offers searching the content after the notes, for a non-blank query only", async () => {
        const input = await mount();
        await type(input, "al");

        const row = fullTextRow();
        expect(row).toBeDefined();
        expect(allRows().at(-1)).toBe(row);
        // Two keys, drawn as a button's shortcut is; their labels are translated.
        expect(row?.querySelectorAll(".note-suggestion-shortcut > kbd")).toHaveLength(2);
        expect(row?.querySelector(".tn-icon")?.className).toBe("bx bx-search tn-icon");
        // Set apart from the notes above it.
        expect(row?.previousElementSibling?.className).toBe("dropdown-divider");
        expect(document.querySelectorAll(".note-autocomplete-menu .dropdown-divider")).toHaveLength(1);
        // The first note keeps the highlight, though the row's title is the query itself.
        expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);

        await type(input, " ");
        expect(rows()).toHaveLength(2);
        expect(fullTextRow()).toBeUndefined();
    });

    it("searches the content from its row, saying so until the results come", async () => {
        let finish: (rows: Suggestion[]) => void = () => {};
        const onChange = vi.fn();
        const input = await mount({ onChange });
        await type(input, "al");
        getNoteSuggestions.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

        const row = fullTextRow();
        if (!row) throw new Error("no full-text search row rendered");
        await act(async () => { row.click(); });
        await settle();

        expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", expect.objectContaining({ fastSearch: false }));
        expect(rows()).toHaveLength(1);
        expect(rows()[0].querySelector(".search-result-title")).not.toBeNull();
        expect(rows()[0].getAttribute("role")).toBeNull();

        // Enter waits for the results rather than taking a row of the fast search.
        await press(input, "Enter");
        expect(input.dataset.notePath).toBe("");

        await act(async () => { finish([ notes[1] ]); });
        await settle();
        expect(rows()).toHaveLength(1);
        expect(rows()[0].querySelector(".search-result-title")?.textContent).toBe("X / Beta");
        expect(onChange).not.toHaveBeenCalled();

        // The next keystroke searches the titles again.
        await type(input, "alp");
        expect(queries().at(-1)).toBe("alp");
    });

    it("searches the content on Shift+Enter, keeping the key from the host", async () => {
        const onKeyDown = vi.fn();
        const input = await mount({ onKeyDown });

        // Nothing to search for in an empty field.
        const empty = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
        await act(async () => { input.dispatchEvent(empty); });
        await settle();
        expect(getNoteSuggestions).not.toHaveBeenCalled();

        await type(input, "al");
        const shiftEnter = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
        await act(async () => { input.dispatchEvent(shiftEnter); });
        await settle();

        expect(shiftEnter.defaultPrevented).toBe(true);
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", expect.objectContaining({ fastSearch: false }));
        expect(onKeyDown).not.toHaveBeenCalledWith(shiftEnter);
    });

    it("searches for what an input method commits, not what it is composing", async () => {
        const onChange = vi.fn();
        const input = await mount({ onChange });
        await type(input, "n");
        getNoteSuggestions.mockClear();

        await act(async () => { input.dispatchEvent(new Event("compositionstart", { bubbles: true })); });
        await type(input, "ni");
        await type(input, "nih");
        expect(getNoteSuggestions).not.toHaveBeenCalled();

        // The Enter that commits a candidate, and a Shift+Enter, belong to the input method.
        for (const shiftKey of [ false, true ]) {
            const key = new KeyboardEvent("keydown", { key: "Enter", shiftKey, isComposing: true, bubbles: true, cancelable: true });
            await act(async () => { input.dispatchEvent(key); });
            expect(key.defaultPrevented).toBe(false);
        }
        await settle();
        expect(onChange).not.toHaveBeenCalled();
        expect(getNoteSuggestions).not.toHaveBeenCalled();

        await act(async () => { input.dispatchEvent(new Event("compositionend", { bubbles: true })); });
        await settle();
        expect(queries()).toEqual([ "nih" ]);
    });

    describe("action rows", () => {
        const searchRow: Suggestion = { action: "search-notes", noteTitle: "al", highlightedNotePathTitle: "Search for al" };
        const linkRow: Suggestion = { action: "external-link", externalLink: "https://e.com", highlightedNotePathTitle: "Insert" };
        const createRow: Suggestion = { action: "create-note", noteTitle: "New", highlightedNotePathTitle: "Create New" };

        let triggerCommand: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(() => Promise.resolve() as never);
            createNoteFromSuggestion.mockReset();
        });

        afterEach(() => {
            triggerCommand.mockRestore();
        });

        it("asks for the rows the options allow", async () => {
            const input = await mount({ opts: { allowCreatingNotes: true, allowJumpToSearchNotes: true, allowExternalLinks: true } });
            await type(input, "al");

            expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", {
                allowCreatingNotes: true, allowJumpToSearchNotes: true, allowExternalLinks: true
            });
        });

        it("opens on the first note, with the creation rows last and a line of their own", async () => {
            getNoteSuggestions.mockResolvedValue([ ...notes, searchRow, createRow ]);
            const input = await mount();
            await type(input, "al");

            expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);
            const dividers = [ ...document.querySelectorAll(".note-autocomplete-menu .dropdown-divider") ];
            expect(dividers).toHaveLength(2);
            expect(dividers[0].nextElementSibling).toBe(fullTextRow());
            expect(dividers[1].previousElementSibling?.querySelector(".bx-file-find")).not.toBeNull();
            expect(dividers[1].nextElementSibling?.querySelector(".bx-plus")).not.toBeNull();

            // Up from the first note wraps to the creation row, the search rows having keys of their own.
            await press(input, "ArrowUp");
            expect(allRows().at(-1)?.querySelector(".bx-plus")).not.toBeNull();
            expect(allRows().at(-1)?.classList.contains("tn-menu-active")).toBe(true);
        });

        it("says no note matched ahead of the rows acting on the query, in both kinds of list", async () => {
            getNoteSuggestions.mockResolvedValue([ searchRow, createRow ]);
            const input = await mount();
            await type(input, "New");

            const menu = document.querySelector(".note-autocomplete-menu .tn-menu-scroll");
            const first = menu?.firstElementChild;
            expect(first?.classList.contains("disabled")).toBe(true);
            expect(first?.getAttribute("role")).toBeNull();
            expect(first?.querySelector(".bx-info-circle")).not.toBeNull();
            expect(first?.nextElementSibling?.className).toBe("dropdown-divider");
            // Not a row the keys reach: the list still opens on creating the note.
            expect(allRows().find((row) => row.classList.contains("tn-menu-active"))?.querySelector(".bx-plus")).not.toBeNull();

            const host = document.createElement("div");
            document.body.append(host);
            const contained = await mount({ container: { current: host } });
            await type(contained, "New");
            const firstContained = host.querySelector(".note-suggestion-list")?.firstElementChild;
            expect(firstContained?.classList.contains("disabled")).toBe(true);
            expect(firstContained?.nextElementSibling?.className).toBe("dropdown-divider");
            host.remove();

            // A list with notes needs no such row.
            getNoteSuggestions.mockResolvedValue([ ...notes, createRow ]);
            await type(input, "al");
            expect(document.querySelector(".note-autocomplete-menu .tn-menu-scroll > .disabled")).toBeNull();
        });

        it("opens on creating the note when no note matches, past the search rows ahead of it", async () => {
            getNoteSuggestions.mockResolvedValue([ searchRow, createRow ]);
            const input = await mount();
            await type(input, "New");

            const active = allRows().find((row) => row.classList.contains("tn-menu-active"));
            expect(active?.querySelector(".bx-plus")).not.toBeNull();
        });

        it("sets both search rows apart from the notes with one line", async () => {
            getNoteSuggestions.mockResolvedValue([ ...notes, searchRow ]);
            const input = await mount();
            await type(input, "al");

            const dividers = [ ...document.querySelectorAll(".note-autocomplete-menu .dropdown-divider") ];
            expect(dividers).toHaveLength(1);
            expect(dividers[0].previousElementSibling).toBe(rows()[1]);
            expect(dividers[0].nextElementSibling).toBe(fullTextRow());
        });

        it("offers the searches beside a host's list rather than in it", async () => {
            const onChange = vi.fn();
            const host = document.createElement("div");
            document.body.append(host);
            const input = await mount({ onChange, container: { current: host }, opts: { allowJumpToSearchNotes: true }, searchFooter: true });
            await type(input, "al");

            // The list holds the notes alone.
            expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", expect.objectContaining({ allowJumpToSearchNotes: false }));
            expect(host.querySelectorAll(".note-suggestion-list > .dropdown-item")).toHaveLength(2);
            expect(host.querySelector(".note-suggestion-list > .dropdown-divider")).toBeNull();

            // A switch under the list searches the contents, and stays on as the query changes.
            const contentsSwitch = () => host.querySelector<HTMLInputElement>(".note-suggestion-footer input.switch-toggle");
            expect(contentsSwitch()?.checked).toBe(false);
            await act(async () => { contentsSwitch()?.dispatchEvent(new Event("input", { bubbles: true })); });
            await settle();
            expect(contentsSwitch()?.checked).toBe(true);
            expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", expect.objectContaining({ fastSearch: false }));
            await type(input, "alp");
            expect(getNoteSuggestions).toHaveBeenLastCalledWith("alp", expect.objectContaining({ fastSearch: false }));
            await press(input, "Enter", { shiftKey: true });
            expect(contentsSwitch()?.checked).toBe(false);
            expect(getNoteSuggestions.mock.lastCall?.[1]?.fastSearch).toBeUndefined();
            expect(document.activeElement).toBe(input);

            // The switch leaves its key to the shortcut hints, which the footer opens as quick search's does.
            expect(host.querySelector(".note-suggestion-footer .switch-widget kbd")).toBeNull();
            expect(host.querySelector(".note-suggestion-footer .shortcut-hint-button")).not.toBeNull();

            // The footer under the list opens the full search, reported for the host to close on.
            const footer = host.querySelector<HTMLButtonElement>(".note-suggestion-footer button.show-in-full-search");
            // A plain button, as quick search's: its key is in the shortcut hints.
            expect(footer).not.toBeNull();
            expect(footer?.querySelector("kbd, .tn-icon")).toBeNull();
            await act(async () => { footer?.click(); });
            expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "alp" });
            expect(onChange).toHaveBeenLastCalledWith({ action: "search-notes", noteTitle: "alp" });

            // The recent notes keep the footer, so the list does not move, and its key hints; the
            // searches are hidden, with nothing to search for.
            await type(input, " ");
            const footerBar = host.querySelector(".note-suggestion-footer");
            expect(footerBar?.classList.contains("nothing-to-search")).toBe(true);
            expect(footerBar?.querySelector(".shortcut-hint-button")).not.toBeNull();
            await press(input, "Enter", { shiftKey: true });
            expect(contentsSwitch()?.checked).toBe(false);
            await type(input, "al");
            expect(footerBar?.classList.contains("nothing-to-search")).toBe(false);
            host.remove();

            // A host that does not ask for the footer, the Empty tab, lists the searches as rows.
            const plainHost = document.createElement("div");
            document.body.append(plainHost);
            const plainInput = await mount({ container: { current: plainHost }, opts: { allowJumpToSearchNotes: true } });
            await type(plainInput, "al");
            expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", expect.objectContaining({ allowJumpToSearchNotes: true }));
            expect(plainHost.querySelector(".note-suggestion-footer")).toBeNull();
            expect(plainHost.querySelector(".note-suggestion-list > .dropdown-item .bx-search")).not.toBeNull();
            plainHost.remove();

            // A dropdown keeps its content search row and has no footer.
            const popupInput = await mount();
            await type(popupInput, "al");
            expect(fullTextRow()).toBeDefined();
            expect(document.querySelector(".note-suggestion-footer")).toBeNull();
        });

        it("lists the keys of a host's list in the shortcut hints, and leaves a dropdown's host alone", async () => {
            const keysFor = async (props: NoteAutocompleteProps) => {
                const parent = new Component();
                await act(async () => {
                    renderInto(<ParentComponent.Provider value={parent}><NoteAutocomplete {...props} /></ParentComponent.Provider>);
                });
                return collectShortcutHints(parent).flatMap((section) => section.hints)
                    .map((hint) => ("keys" in hint ? hint.keys.join(" ") : hint.action));
            };

            const host = document.createElement("div");
            expect(await keysFor({ container: { current: host }, opts: { allowJumpToSearchNotes: true }, searchFooter: true }))
                .toEqual([ "Up Down", "Enter", "Shift+Enter", "Ctrl+Enter" ]);
            expect(await keysFor({ container: { current: host }, searchFooter: true }))
                .toEqual([ "Up Down", "Enter", "Shift+Enter" ]);
            expect(await keysFor({ container: { current: host } })).toEqual([]);
            expect(await keysFor({})).toEqual([]);
        });

        it("runs a search from its row, with its shortcut shown, reporting it for the host to close on", async () => {
            const onChange = vi.fn();
            getNoteSuggestions.mockResolvedValue([ searchRow ]);
            const input = await mount({ onChange });
            await type(input, "al");

            expect(allRows().find((row) => row.querySelector(".bx-file-find"))?.querySelectorAll(".note-suggestion-shortcut > kbd")).toHaveLength(2);
            // One line, under the row saying no note matched.
            const dividers = document.querySelectorAll(".note-autocomplete-menu .dropdown-divider");
            expect(dividers).toHaveLength(1);
            expect(dividers[0].previousElementSibling?.classList.contains("disabled")).toBe(true);
            // Past the full-text search row ahead of it.
            await press(input, "ArrowDown");
            await press(input, "Enter");
            expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "al" });
            expect(onChange).toHaveBeenCalledWith({ action: "search-notes", noteTitle: "al" });
            expect(input.value).toBe("al");
        });

        it("runs a search on Ctrl+Enter where allowed, keeping the key from other listeners", async () => {
            const onChange = vi.fn();
            const input = await mount({ onChange, opts: { allowJumpToSearchNotes: true, isCommandPalette: true } });
            await type(input, " al ");
            const laterListener = vi.fn();
            input.addEventListener("keydown", laterListener);

            await press(input, "Enter", { ctrlKey: true });
            expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "al" });
            expect(onChange).toHaveBeenCalledWith({ action: "search-notes", noteTitle: "al" });
            expect(laterListener).not.toHaveBeenCalled();

            // Nothing to search for in a blank field or a command query, though the key is still kept.
            triggerCommand.mockClear();
            for (const text of [ "  ", "> cmd" ]) {
                await type(input, text);
                await press(input, "Enter", { ctrlKey: true });
            }
            expect(triggerCommand).not.toHaveBeenCalled();
            expect(laterListener).not.toHaveBeenCalled();

            triggerCommand.mockClear();
            const plain = await mount();
            await type(plain, "al");
            await press(plain, "Enter", { ctrlKey: true });
            expect(triggerCommand).not.toHaveBeenCalled();
        });

        it("fills in an external link from its row, with no note selected", async () => {
            const onChange = vi.fn();
            const noteIdChanged = vi.fn();
            getNoteSuggestions.mockResolvedValue([ linkRow ]);
            const input = await mount({ onChange, noteIdChanged });
            await type(input, "https://e.com");
            await press(input, "Enter");

            expect(input.value).toBe("https://e.com");
            expect(input.dataset.notePath).toBe("");
            expect(onChange).toHaveBeenCalledWith(linkRow);
            expect(noteIdChanged).not.toHaveBeenCalled();
        });

        it("creates a note from its row and reports it as picked, or nothing when canceled", async () => {
            const onChange = vi.fn();
            const noteIdChanged = vi.fn();
            getNoteSuggestions.mockResolvedValue([ createRow ]);
            createNoteFromSuggestion.mockResolvedValueOnce("root/inbox/created");
            const input = await mount({ onChange, noteIdChanged });
            await type(input, "New");
            await press(input, "Enter");

            expect(createNoteFromSuggestion).toHaveBeenCalledWith(createRow);
            expect(onChange).toHaveBeenCalledWith({ ...createRow, notePath: "root/inbox/created" });
            expect(noteIdChanged).toHaveBeenCalledWith("created");
            expect(input.value).toBe("New");
            expect(input.dataset.notePath).toBe("root/inbox/created");

            onChange.mockClear();
            createNoteFromSuggestion.mockResolvedValueOnce(undefined);
            await type(input, "New");
            await press(input, "Enter");
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    it("empties the field through the handle without reporting it", async () => {
        const handleRef = createRef<NoteAutocompleteHandle>();
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const onTextChange = vi.fn();
        const input = await mount({ handleRef, onChange, noteIdChanged, onTextChange });
        await type(input, "a");
        await press(input, "Enter");
        for (const callback of [ onChange, noteIdChanged, onTextChange ]) callback.mockClear();

        // From the host's own `noteIdChanged`, as the relation field clears the box it took from.
        act(() => {
            handleRef.current?.clear();
            expect(input.value).toBe("");
        });
        await settle();

        expect(input.dataset.notePath).toBe("");
        expect(onChange).not.toHaveBeenCalled();
        expect(noteIdChanged).not.toHaveBeenCalled();
        expect(onTextChange).not.toHaveBeenCalled();
    });

    it("spans the whole field, the buttons included", async () => {
        const input = await mount();
        const group = input.closest(".input-group");
        if (!group) throw new Error("no input group rendered");
        group.getBoundingClientRect = () => DOMRect.fromRect({ width: 720, height: 30 });
        input.getBoundingClientRect = () => DOMRect.fromRect({ width: 600, height: 30 });
        await type(input, "a");

        expect(document.querySelector<HTMLElement>(".note-autocomplete-menu")?.style.width).toBe("720px");
    });

    it("spans the element a host anchors it to instead", async () => {
        const frame = document.createElement("div");
        frame.getBoundingClientRect = () => DOMRect.fromRect({ width: 680, height: 30 });
        const input = await mount({ anchorRef: { current: frame } });
        await type(input, "a");

        expect(document.querySelector<HTMLElement>(".note-autocomplete-menu")?.style.width).toBe("680px");
    });

    it("lists inside the modal around the field, above the modal's own layer", async () => {
        let modal: HTMLElement | null = null;
        await act(async () => {
            modal = renderInto(<div className="modal"><NoteAutocomplete /></div>).querySelector(".modal");
        });
        const input = (modal as HTMLElement | null)?.querySelector("input");
        if (!modal || !input) throw new Error("no input rendered");
        await type(input, "a");

        const menu = document.querySelector(".note-autocomplete-menu");
        expect(menu).not.toBe(null);
        expect(menu?.closest(".modal")).toBe(modal);
    });

    it("widens past a narrow field, and spans a wide one", async () => {
        const input = await mount();
        const group = input.closest(".input-group");
        if (!group) throw new Error("no input group rendered");
        group.getBoundingClientRect = () => DOMRect.fromRect({ width: 320, height: 30 });
        await type(input, "a");
        expect(document.querySelector<HTMLElement>(".note-autocomplete-menu")?.style.width).toBe("500px");

        group.getBoundingClientRect = () => DOMRect.fromRect({ width: 640, height: 30 });
        await type(input, "al");
        expect(document.querySelector<HTMLElement>(".note-autocomplete-menu")?.style.width).toBe("640px");
    });

    it("picks a clicked note", async () => {
        const noteIdChanged = vi.fn();
        const input = await mount({ noteIdChanged });
        await type(input, "a");

        await act(async () => { rows()[0].click(); });
        expect(noteIdChanged).toHaveBeenCalledWith("a");
        expect(input.value).toBe("Alpha");
    });

    it("reports a selection cleared by emptying the field", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const input = await mount({ onChange, noteIdChanged });
        await type(input, "a");
        await press(input, "Enter");

        await type(input, "");
        await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(noteIdChanged).toHaveBeenLastCalledWith(undefined);
        expect(input.dataset.notePath).toBe("");
    });

    it("closes on Escape, and stays closed in a read-only field", async () => {
        const input = await mount();
        await type(input, "a");
        await press(input, "Escape");
        expect(rows()).toHaveLength(0);

        const readOnly = await mount({ readOnly: true });
        await press(readOnly, "ArrowDown");
        expect(rows()).toHaveLength(0);
    });
});

describe("NoteMentionList", () => {
    const notes: Suggestion[] = [
        { notePath: "root/a", noteTitle: "Alpha", notePathTitle: "Alpha", highlightedNotePathTitle: "<b>Al</b>pha", icon: "bx bx-file" },
        { notePath: "root/b", noteTitle: "Beta", notePathTitle: "Beta", highlightedNotePathTitle: "Beta" }
    ];
    const createRow: Suggestion = { action: "create-note", noteTitle: "al", highlightedNotePathTitle: "Create note" };
    const anchor = { getBoundingClientRect: () => new DOMRect(10, 10, 1, 16) };

    beforeEach(() => {
        vi.useFakeTimers();
        getNoteSuggestions.mockReset();
        getNoteSuggestions.mockResolvedValue(notes);
        createNoteFromSuggestion.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Shows the list for `query` where nothing has the focus, as a text editor's caret does. */
    async function show(query: string, props: Partial<Parameters<typeof NoteMentionList>[0]> = {}) {
        const onPick = vi.fn();
        const handleRef = createRef<AutocompleteListHandle>() as { current: AutocompleteListHandle | null };
        const host = document.createElement("div");
        const draw = async (text: string) => {
            await act(async () => {
                preactRender(<NoteMentionList query={text} anchor={anchor} onPick={onPick} handleRef={handleRef} {...props} />, host);
            });
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        };
        await draw(query);
        const press = async (key: string) => {
            const event = new KeyboardEvent("keydown", { key, cancelable: true });
            let taken = false;
            await act(async () => { taken = handleRef.current?.handleKeyDown(event) ?? false; });
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            return taken;
        };
        return { onPick, draw, press, unmount: () => act(() => preactRender(null, host)) };
    }

    const rows = () => [ ...document.querySelectorAll<HTMLElement>(".note-autocomplete-menu > .tn-menu-scroll > .dropdown-item") ];

    it("lists the notes for the query as the field does, and again as the query changes", async () => {
        const { draw, unmount } = await show("al", { allowCreatingNotes: true });

        // At most ten notes, which the server stops at.
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", { allowCreatingNotes: true, limit: 10 });
        expect(rows().map((row) => row.querySelector(".search-result-title")?.innerHTML)).toEqual([ "<b>Al</b>pha", "Beta" ]);
        expect(rows()[0].querySelector(".tn-icon")?.className).toContain("bx-file");
        // Capped in width by its own class, as it has no field to take a width from.
        expect(rows()[0].closest(".tn-popup")?.classList.contains("note-mention-menu")).toBe(true);

        await draw("alp");
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("alp", { allowCreatingNotes: true, limit: 10 });
        expect(rows()).toHaveLength(2);
        await unmount();
    });

    it("runs no search held back for a query once the list is closed, and lets go of its keys", async () => {
        const handleRef = createRef<AutocompleteListHandle>() as { current: AutocompleteListHandle | null };
        const host = document.createElement("div");
        const draw = (text: string) => act(async () => {
            preactRender(<NoteMentionList query={text} anchor={anchor} onPick={() => {}} handleRef={handleRef} />, host);
        });

        await draw("al");
        // Typed within the scheduler's window, so its search waits.
        await draw("alp");
        await act(() => preactRender(null, host));
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

        expect(getNoteSuggestions).not.toHaveBeenCalledWith("alp", expect.anything());
        expect(handleRef.current).toBeNull();
    });

    it("takes the highlighted note on Tab as on Enter", async () => {
        const { onPick, press, unmount } = await show("al");

        expect(await press("Tab")).toBe(true);
        expect(onPick).toHaveBeenCalledExactlyOnceWith("root/a");
        await unmount();
    });

    it("holds Tab and Enter pressed on a refined query until its notes arrive, and takes from those", async () => {
        const handleRef = createRef<AutocompleteListHandle>() as { current: AutocompleteListHandle | null };
        const host = document.createElement("div");
        const onPick = vi.fn();
        const draw = (text: string) => preactRender(<NoteMentionList query={text} anchor={anchor} onPick={onPick} handleRef={handleRef} />, host);
        const press = (key: string) => handleRef.current?.handleKeyDown(new KeyboardEvent("keydown", { key, cancelable: true })) ?? false;

        for (const key of [ "Tab", "Enter" ]) {
            getNoteSuggestions.mockResolvedValue(notes);
            await act(async () => draw("al"));
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);

            // Pressed as soon as the host shows the newer query, before the list has looked it up.
            getNoteSuggestions.mockResolvedValue([ notes[1] ]);
            draw("be");
            expect(press(key)).toBe(true);
            expect(onPick).not.toHaveBeenCalled();

            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(onPick).toHaveBeenCalledExactlyOnceWith("root/b");
            onPick.mockClear();
            await act(async () => preactRender(null, host));
        }
    });

    it("drops a held key once the host's query changes again, and leaves a composing Tab alone", async () => {
        const handleRef = createRef<AutocompleteListHandle>() as { current: AutocompleteListHandle | null };
        const host = document.createElement("div");
        const onPick = vi.fn();
        const draw = (text: string) => preactRender(<NoteMentionList query={text} anchor={anchor} onPick={onPick} handleRef={handleRef} />, host);
        const press = (key: string, init: KeyboardEventInit = {}) =>
            handleRef.current?.handleKeyDown(new KeyboardEvent("keydown", { key, cancelable: true, ...init })) ?? false;

        await act(async () => draw("al"));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        // An input method's Tab, while it composes, is the editor's.
        expect(press("Tab", { isComposing: true })).toBe(false);

        draw("be");
        expect(press("Tab")).toBe(true);
        // Typed on before the notes for "be" arrive, so the Tab confirmed text that is gone.
        draw("bet");
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(rows().length).toBeGreaterThan(0);
        expect(onPick).not.toHaveBeenCalled();
        await act(async () => preactRender(null, host));
    });

    it("takes the keys while it shows notes, and reports the path of the one Enter or a click picks", async () => {
        const { onPick, press, unmount } = await show("al");

        expect(rows()[0].classList.contains("tn-menu-active")).toBe(true);
        expect(await press("ArrowDown")).toBe(true);
        expect(rows()[1].classList.contains("tn-menu-active")).toBe(true);
        expect(await press("Enter")).toBe(true);
        expect(onPick).toHaveBeenCalledExactlyOnceWith("root/b");
        // Picked, the list is closed and the keys are the editor's again.
        expect(rows()).toHaveLength(0);
        expect(await press("ArrowDown")).toBe(false);
        await unmount();

        const clicked = await show("al");
        await act(async () => rows()[0].click());
        expect(clicked.onPick).toHaveBeenCalledExactlyOnceWith("root/a");
        await clicked.unmount();
    });

    it("leaves Enter to the editor with nothing highlighted where it opens without a preselection", async () => {
        const { onPick, press, unmount } = await show("al", { preselect: false });

        expect(rows().some((row) => row.classList.contains("tn-menu-active"))).toBe(false);
        expect(await press("Enter")).toBe(false);
        expect(onPick).not.toHaveBeenCalled();
        await unmount();
    });

    it("creates the note of a creation row, and reports its path once created", async () => {
        getNoteSuggestions.mockResolvedValue([ createRow ]);
        createNoteFromSuggestion.mockResolvedValueOnce("root/inbox/created");
        const { onPick, press, unmount } = await show("al", { allowCreatingNotes: true });

        // With no note to open, the list opens on the creation row.
        expect(await press("Enter")).toBe(true);
        expect(createNoteFromSuggestion).toHaveBeenCalledWith(createRow, undefined);
        expect(await onPick.mock.calls[0]?.[0]).toBe("root/inbox/created");
        await unmount();
    });

    it("creates a child note under the note the host edits", async () => {
        const childRow: Suggestion = { action: "create-child-note", noteTitle: "al", parentNoteId: "active", highlightedNotePathTitle: "Create child note" };
        getNoteSuggestions.mockResolvedValue([ childRow ]);
        createNoteFromSuggestion.mockResolvedValueOnce("root/edited/created");
        const { press, unmount } = await show("al", { allowCreatingNotes: true, parentNotePath: "root/edited" });

        expect(await press("Enter")).toBe(true);
        expect(createNoteFromSuggestion).toHaveBeenCalledExactlyOnceWith(childRow, "root/edited");
        await unmount();
    });
});

describe("HighlightedText", () => {
    it("sets the first occurrence of the query in bold, whatever its case, and nothing where there is none", () => {
        const html = (text: string, query: string) => {
            const host = document.createElement("div");
            preactRender(<HighlightedText text={text} query={query} />, host);
            return host.innerHTML;
        };

        expect(html("ownedLabelCount", "label")).toBe("owned<b>Label</b>Count");
        expect(html("labelCount", "la")).toBe("<b>la</b>belCount");
        expect(html("a<b>&", "<b")).toBe("a<b>&lt;b</b>&gt;&amp;");
        expect(html("title", "xyz")).toBe("title");
        expect(html("title", "")).toBe("title");
    });
});

describe("filterCommandEntries", () => {
    it("keeps the entries holding the query, ignoring case, those starting with it first", () => {
        const entries = [ "contentSize", "dateCreated", "content", "childrenCount", "title" ]
            .map((title) => ({ id: title, title }));

        expect(filterCommandEntries(entries, "CONT").map((entry) => entry.title)).toEqual([ "contentSize", "content" ]);
        expect(filterCommandEntries(entries, "c").map((entry) => entry.title))
            .toEqual([ "contentSize", "content", "childrenCount", "dateCreated" ]);
        expect(filterCommandEntries(entries, "")).toEqual(entries);
    });
});

describe("filterCommandEntries with aliases", () => {
    it("ranks title prefixes, then alias prefixes, then titles and aliases holding the query", () => {
        const entries = [
            { id: "toc", title: "Table of contents", aliases: [ "outline" ] },
            { id: "rule", title: "Horizontal line", aliases: [ "divider", "rule" ] },
            { id: "table", title: "Table", aliases: [ "grid" ] },
            { id: "code", title: "Code block", aliases: [ "snippet", "pre" ] },
            { id: "quote", title: "Block quote", aliases: [ "citation" ] }
        ];
        const ids = (query: string) => filterCommandEntries(entries, query).map((entry) => entry.id);

        expect(ids("ta")).toEqual([ "toc", "table", "rule", "quote" ]);
        expect(ids("r")).toEqual([ "rule", "table", "code" ]);
        expect(ids("GRID")).toEqual([ "table" ]);
        expect(ids("tline")).toEqual([ "toc" ]);
    });
});
