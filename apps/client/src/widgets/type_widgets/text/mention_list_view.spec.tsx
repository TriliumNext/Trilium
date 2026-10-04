import type { EmojiSuggestion, MentionHostedListState, SlashCommandConfig, SlashCommandDefinition } from "@triliumnext/ckeditor5";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteSuggestions, createNoteFromSuggestion } = vi.hoisted(() => ({
    getNoteSuggestions: vi.fn(async () => [ { notePath: "root/a", noteTitle: "Alpha", highlightedNotePathTitle: "Alpha" } ]),
    createNoteFromSuggestion: vi.fn()
}));

vi.mock("../../../services/note_autocomplete", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/note_autocomplete")>()),
    getNoteSuggestions,
    createNoteFromSuggestion
}));

import { createAutocompleteMentionList, createEmojiList, createNoteMentionList, createSlashCommandList } from "./mention_list_view";

describe("createNoteMentionList", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function open() {
        const list = createNoteMentionList({ allowCreatingNotes: true });
        const commit = vi.fn<MentionHostedListState["commit"]>();
        const setActiveDescendant = vi.fn<MentionHostedListState["setActiveDescendant"]>();
        await act(async () => list.show({ query: "al", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit, setActiveDescendant }));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        return { list, commit, setActiveDescendant };
    }

    it("lists the notes for the query, and mentions the one picked by its path", async () => {
        const { list, commit, setActiveDescendant } = await open();

        expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", { allowCreatingNotes: true, limit: 10 });
        expect(list.element?.textContent).toContain("Alpha");
        // The editor is pointed at the row the list opens on.
        const active = list.element?.querySelector("[aria-selected=true]");
        expect(active?.id).toBeTruthy();
        expect(setActiveDescendant).toHaveBeenLastCalledWith(active?.id);
        expect(list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }))).toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith({ id: "@root/a", notePath: "root/a" });

        await act(async () => list.hide());
        expect(list.element).toBeNull();
        expect(setActiveDescendant).toHaveBeenLastCalledWith(null);
        expect(list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }))).toBe(false);
        list.destroy?.();
    });

    it("mentions a note it creates once it is created, and nothing where the creation is canceled", async () => {
        getNoteSuggestions.mockResolvedValue([ { action: "create-note", noteTitle: "al", highlightedNotePathTitle: "Create" } ] as never);
        createNoteFromSuggestion.mockResolvedValueOnce("root/inbox/al").mockResolvedValueOnce(undefined);

        const created = await open();
        created.list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
        expect(await created.commit.mock.calls[0]?.[0]).toEqual({ id: "@root/inbox/al", notePath: "root/inbox/al" });
        created.list.destroy?.();

        const canceled = await open();
        canceled.list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
        expect(await canceled.commit.mock.calls[0]?.[0]).toBeUndefined();
        canceled.list.destroy?.();
    });

    it("creates a child note under the note the editor is open on when the row is picked", async () => {
        const childRow = { action: "create-child-note", noteTitle: "al", parentNoteId: "active", highlightedNotePathTitle: "Create child" };
        getNoteSuggestions.mockResolvedValue([ childRow ] as never);
        createNoteFromSuggestion.mockResolvedValue(undefined);
        let editedNotePath = "root/first";
        const list = createNoteMentionList({ allowCreatingNotes: true, getParentNotePath: () => editedNotePath });
        const commit = vi.fn<MentionHostedListState["commit"]>();
        // The editor is reused for the next note, so the parent is read as the list is shown.
        editedNotePath = "root/second";
        await act(async () => list.show({ query: "al", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit, setActiveDescendant: vi.fn() }));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });

        list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
        expect(createNoteFromSuggestion).toHaveBeenLastCalledWith(childRow, "root/second");
        list.destroy?.();
    });
});

describe("createAutocompleteMentionList", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("lists the source's entries as a field's dropdown, and takes one only once it is arrowed to", async () => {
        const source = vi.fn(async (query: string) => [ `${query}One`, `${query}Two` ]);
        const list = createAutocompleteMentionList({
            source,
            renderItem: (item) => <b>{item}</b>,
            toMention: (item) => ({ id: `#${item}` })
        });
        const commit = vi.fn<MentionHostedListState["commit"]>();
        const key = (k: string) => list.handleKeyDown(new KeyboardEvent("keydown", { key: k, cancelable: true }));

        await act(async () => list.show({ query: "ab", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit, setActiveDescendant: vi.fn() }));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });

        expect(source).toHaveBeenLastCalledWith("ab");
        expect(list.element?.matches(".form-autocomplete-dropdown")).toBe(true);
        expect([ ...(list.element?.querySelectorAll(".form-autocomplete-item > b") ?? []) ].map((row) => row.textContent))
            .toEqual([ "abOne", "abTwo" ]);
        // Nothing is highlighted, so Enter stays with the editor.
        expect(key("Enter")).toBe(false);
        expect(commit).not.toHaveBeenCalled();

        await act(async () => { key("ArrowDown"); });
        await act(async () => { key("ArrowDown"); });
        expect(key("Tab")).toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith({ id: "#abTwo" });

        await act(async () => list.hide());
        expect(list.element).toBeNull();
        list.destroy?.();
    });
});

describe("createSlashCommandList", () => {
    const definitions: SlashCommandDefinition[] = [
        { id: "blockQuote", title: "Block quote", description: "Insert a quote.", icon: "<svg class=\"quote\"></svg>" },
        { id: "snippet-0", title: "Greeting", iconClass: "tn-icon bx bx-note", iconColorClass: "use-note-color" }
    ];

    it("lists the palette's entries as the command palette lists commands, opening on the first, and commits the one picked", async () => {
        const search = vi.fn(() => definitions);
        const editor = { plugins: { get: () => ({ search }) } } as unknown as Parameters<NonNullable<SlashCommandConfig["list"]>>[0];
        const list = createSlashCommandList(editor);
        const commit = vi.fn<MentionHostedListState["commit"]>();
        const key = (k: string) => list.handleKeyDown(new KeyboardEvent("keydown", { key: k, cancelable: true }));

        await act(async () => list.show({ query: "q", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit, setActiveDescendant: vi.fn() }));
        // The list opens, then looks its entries up at once, with no debounce to wait out.
        await act(async () => {});

        expect(search).toHaveBeenLastCalledWith("q");
        expect(list.element?.matches(".dropdown-menu.note-autocomplete-menu.slash-command-menu")).toBe(true);
        const [ quote, greeting ] = [ ...(list.element?.querySelectorAll(".tn-menu-scroll > .dropdown-item") ?? []) ];
        expect(quote.classList.contains("tn-menu-active")).toBe(true);
        expect(quote.querySelector(".tn-icon.note-suggestion-svg-icon > svg.quote")).not.toBeNull();
        expect(quote.querySelector(".search-result-title")?.textContent).toBe("Block quote");
        expect(quote.querySelector(".note-suggestion-description")?.textContent).toBe("Insert a quote.");
        // A snippet's font icon, in its colour, and no description where it has none.
        expect(greeting.querySelector(".tn-icon.bx-note.use-note-color")).not.toBeNull();
        expect(greeting.querySelector(".note-suggestion-description")).toBeNull();

        await act(async () => { key("ArrowDown"); });
        expect(key("Enter")).toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith({ id: "snippet-0", definition: definitions[1] });
        list.destroy?.();
    });

    it("runs on Tab the command of the refined query, not the one highlighted before it", async () => {
        const search = vi.fn((query: string) => query === "g" ? [ definitions[1] ] : definitions);
        const editor = { plugins: { get: () => ({ search }) } } as unknown as Parameters<NonNullable<SlashCommandConfig["list"]>>[0];
        const list = createSlashCommandList(editor);
        const commit = vi.fn<MentionHostedListState["commit"]>();
        const show = (query: string) => list.show({ query, caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit, setActiveDescendant: vi.fn() });

        await act(async () => show(""));
        await act(async () => {});
        show("g");
        expect(list.handleKeyDown(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }))).toBe(true);
        expect(commit).not.toHaveBeenCalled();

        // Rendered outside `act`, the lookup effect waits for the next frame.
        await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
        expect(commit).toHaveBeenCalledExactlyOnceWith({ id: "snippet-0", definition: definitions[1] });
        list.destroy?.();
    });
});

describe("createEmojiList", () => {
    const suggestions: EmojiSuggestion[] = [
        { id: ":grinning face:", title: ":grinning face:", text: "😀" },
        { id: ":show-all:", title: "Show all emoji...", text: "grin", opensPicker: true, icon: "<svg class=\"emoji\"></svg>" }
    ];

    it("lists the emoji as command rows, the emoji as the icon, and commits the one picked", async () => {
        const search = vi.fn(() => suggestions);
        const editor = { plugins: { get: () => ({ search }) } } as unknown as Parameters<NonNullable<SlashCommandConfig["list"]>>[0];
        const list = createEmojiList(editor);
        const commit = vi.fn<MentionHostedListState["commit"]>();
        const key = (k: string) => list.handleKeyDown(new KeyboardEvent("keydown", { key: k, cancelable: true }));

        await act(async () => list.show({ query: "grin", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit, setActiveDescendant: vi.fn() }));
        await act(async () => {});

        expect(search).toHaveBeenLastCalledWith("grin");
        expect(list.element?.matches(".dropdown-menu.note-autocomplete-menu")).toBe(true);
        const [ grinning, showAll ] = [ ...(list.element?.querySelectorAll(".tn-menu-scroll > .dropdown-item:not(.dropdown-divider)") ?? []) ];
        expect(grinning.classList.contains("tn-menu-active")).toBe(true);
        expect(grinning.querySelector(".tn-icon.note-suggestion-text-icon")?.textContent).toBe("😀");
        expect(grinning.querySelector(".search-result-title")?.textContent).toBe(":grinning face:");
        // The entry opening the picker is set apart, with the icon of the editor's emoji button.
        expect(showAll.previousElementSibling?.matches(".dropdown-divider")).toBe(true);
        expect(showAll.querySelector(".note-suggestion-svg-icon > svg.emoji")).not.toBeNull();
        expect(grinning.previousElementSibling).toBeNull();
        expect(showAll.querySelector(".search-result-title")?.textContent).toBe("Show all emoji...");

        expect(key("Enter")).toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith(suggestions[0]);
        list.destroy?.();
    });
});
