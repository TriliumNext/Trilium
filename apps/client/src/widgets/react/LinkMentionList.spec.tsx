import type {
    CreateReferenceResponse, NoteReferencesResponse, ReferenceTarget
} from "@triliumnext/commons";
import { createRef, render as preactRender } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const { getNoteSuggestions, createNoteFromSuggestion } = vi.hoisted(() => ({
    createNoteFromSuggestion: vi.fn<() => Promise<string | undefined>>(),
    getNoteSuggestions: vi.fn<(term: string) => Promise<Suggestion[]>>(async () => [])
}));

vi.mock("../../services/note_autocomplete", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/note_autocomplete")>()),
    getNoteSuggestions,
    createNoteFromSuggestion
}));

vi.mock("../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/i18n")>()),
    t: (key: string) => key
}));

import { createAnchorTargets, type LinkTarget } from "../../services/link_targets";
import type { Suggestion } from "../../services/note_autocomplete";
import server from "../../services/server";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import type { AutocompleteListHandle } from "./FormAutocomplete";
import LinkMentionList, { type LinkMentionListProps } from "./LinkMentionList";

/** The response of `GET notes/:noteId/references`, by note id. Empty for a note not listed. */
const noteReferences = new Map<string, NoteReferencesResponse | Promise<NoteReferencesResponse>>();
const anchor = { getBoundingClientRect: () => new DOMRect(10, 10, 1, 16) };
/** The elements that the lists of a test are rendered into, which are emptied after it. */
const hosts: HTMLElement[] = [];
let getReferences: MockInstance<typeof server.get>;
let createHeadingReference: MockInstance<typeof server.postWithSilentErrors>;
let alphaPath: string;
let betaPath: string;

beforeEach(() => {
    vi.useFakeTimers();
    const alpha = buildNote({ title: "Alpha" });
    const beta = buildNote({ title: "Beta" });
    alphaPath = `root/${alpha.noteId}`;
    betaPath = `root/${beta.noteId}`;
    getNoteSuggestions.mockReset();
    getNoteSuggestions.mockResolvedValue([
        { notePath: alphaPath, noteTitle: "Alpha", highlightedNotePathTitle: "Alpha" },
        { notePath: betaPath, noteTitle: "Beta", highlightedNotePathTitle: "Beta" }
    ]);
    createNoteFromSuggestion.mockReset();

    noteReferences.clear();
    noteReferences.set(alpha.noteId, {
        targets: [
            headingTarget("Setup", 2), headingTarget("Linux", 3), headingTarget("Usage", 2, "U"),
            anchorTarget("a b")
        ]
    });
    getReferences = vi.spyOn(server, "get").mockImplementation((async (url: string) => {
        const noteId = /^notes\/(\w+)\/references$/.exec(url)?.[1] ?? "";
        return noteReferences.get(noteId) ?? { targets: [] };
    }) as typeof server.get);
    createHeadingReference = vi.spyOn(server, "postWithSilentErrors")
        .mockResolvedValue({ params: { block: "NewId" } } satisfies CreateReferenceResponse);
});

/** A heading as the server lists it, with the block id `block` when it has one. */
function headingTarget(title: string, level: number, block?: string): ReferenceTarget {
    return block
        ? { kind: "heading", title, level, params: { block } }
        : { kind: "heading", title, level };
}

/** An anchor as the server lists it. */
function anchorTarget(name: string): ReferenceTarget {
    return { kind: "anchor", title: name, params: { bookmark: name } };
}

afterEach(async () => {
    for (const host of hosts.splice(0)) {
        await act(() => preactRender(null, host));
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** Shows the list for `query` where nothing has the focus, as a text editor's caret does. */
async function show(query: string, props: Partial<LinkMentionListProps> = {}) {
    const onPick = vi.fn<LinkMentionListProps["onPick"]>();
    const onLinkNote = vi.fn<LinkMentionListProps["onLinkNote"]>();
    const onKeepLink = vi.fn<LinkMentionListProps["onKeepLink"]>();
    const onActiveDescendant = vi.fn<(id: string | null) => void>();
    const handleRef = createRef<AutocompleteListHandle>() as {
        current: AutocompleteListHandle | null
    };
    const host = document.createElement("div");
    hosts.push(host);
    // In two rounds: the headings that arrive in the first one are listed in the second.
    const settle = async () => {
        for (let round = 0; round < 2; round++) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(300);
            });
        }
    };
    /** Shows the list for `text`, typed after the link to `linkedNotePath` once there is one. */
    const draw = async (text: string, linkedNotePath?: string) => {
        await act(async () => {
            preactRender(
                <LinkMentionList
                    query={text} linkedNotePath={linkedNotePath} anchor={anchor}
                    onPick={onPick} onLinkNote={onLinkNote} onKeepLink={onKeepLink}
                    handleRef={handleRef} onActiveDescendant={onActiveDescendant} {...props}
                />,
                host
            );
        });
        await settle();
    };
    await draw(query);

    return {
        onPick,
        onLinkNote,
        onKeepLink,
        onActiveDescendant,
        handleRef,
        draw,
        settle,
        /** Forwards a key as the host does, and returns whether the list took it. */
        async press(key: string, { repeat = false } = {}) {
            const event = new KeyboardEvent("keydown", { key, repeat, cancelable: true });
            let isTaken = false;
            await act(async () => {
                isTaken = handleRef.current?.handleKeyDown(event) ?? false;
            });
            await settle();
            return isTaken;
        },
        unmount: () => act(() => preactRender(null, host))
    };
}

/** Shows the list for `al`, picks Alpha from it and links it as the host does. */
async function showAlphaLinked(props: Partial<LinkMentionListProps> = {}) {
    const list = await show("al", props);
    await list.press("Enter");
    await list.draw("", alphaPath);
    return list;
}

function popup() {
    return document.querySelector<HTMLElement>(".tn-popup.link-mention-menu");
}

/** The pages in the popup, by name, with how each slides. */
function pages() {
    return [ ...popup()?.querySelectorAll(".link-mention-pages > .link-mention-page") ?? [] ]
        .map((page) => {
            const name = page.classList.contains("link-mention-notes") ? "notes" : "destinations";
            if (page.classList.contains("link-mention-page-entering")) return `${name} entering`;
            return page.classList.contains("link-mention-page-leaving") ? `${name} leaving` : name;
        });
}

/** Ends the slide as the browser does, with the name of the keyframes that ran. */
async function finishSlide() {
    const slideEnd = Object.assign(
        new Event("animationend", { bubbles: true }), { animationName: "tn-slide-out-to-left" }
    );
    await act(async () => {
        popup()?.querySelector(".link-mention-page")?.dispatchEvent(slideEnd);
    });
}

function noteRows() {
    return [ ...popup()?.querySelectorAll<HTMLElement>(
        ".link-mention-notes .dropdown-item"
    ) ?? [] ];
}

function highlightedNote() {
    return noteRows().find((row) => row.classList.contains("tn-menu-active"));
}

/** The rows of the second page that can be picked. */
function rows() {
    return [ ...popup()?.querySelectorAll<HTMLElement>(
        ".link-mention-destinations [role=option]"
    ) ?? [] ];
}

function rowTitle(row: HTMLElement) {
    return row.querySelector(".search-result-title")?.textContent;
}

/** The rows of the second page, by their title, the highlighted one marked with a `*`. */
function rowNames() {
    return rows().map((row) => {
        const mark = row.classList.contains("tn-menu-active") ? "*" : "";
        return `${mark}${rowTitle(row)}`;
    });
}

function rowNamed(title: string) {
    const row = rows().find((other) => rowTitle(other) === title);
    if (!row) throw new Error(`The second page lists no '${title}'.`);
    return row;
}

/** The headings over the groups of rows of the second page. */
function groupTitles() {
    const headers = popup()?.querySelectorAll(".link-mention-destinations .dropdown-header");
    return [ ...headers ?? [] ].map((header) => header.textContent);
}

/** The row of the second page that cannot be picked, with the state of the page. */
function statusRow() {
    return popup()?.querySelector(".link-mention-destinations .dropdown-item.disabled");
}

async function clickRow(title: string) {
    const row = rowNamed(title);
    await act(async () => row.click());
}

/** A promise, with the functions that settle it. */
function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe("LinkMentionList", () => {
    it("lists the notes, links the one picked and lists where its link can point", async () => {
        const references = deferred<NoteReferencesResponse>();
        noteReferences.set(alphaPath.split("/")[1], references.promise);
        const { onPick, onLinkNote, onKeepLink, press, draw, settle } = await show("al");

        const shown = popup();
        expect(shown?.classList.contains("note-mention-menu")).toBe(true);
        expect(pages()).toStrictEqual([ "notes" ]);
        expect(noteRows().map((row) => row.textContent)).toStrictEqual([ "Alpha", "Beta" ]);
        expect(highlightedNote()?.textContent).toBe("Alpha");
        expect(getReferences).not.toHaveBeenCalled();

        // The note is linked at once. The second page slides in over the notes, which keep
        // their rows and their highlight.
        expect(await press("Enter")).toBe(true);
        expect(onLinkNote).toHaveBeenCalledExactlyOnceWith(alphaPath);
        expect(onPick).not.toHaveBeenCalled();
        expect(popup()).toBe(shown);
        expect(pages()).toStrictEqual([ "notes leaving", "destinations entering" ]);
        expect(noteRows()).toHaveLength(2);
        expect(highlightedNote()?.textContent).toBe("Alpha");

        // The whole note is offered while the server reads the headings and anchors.
        expect(getReferences).toHaveBeenCalledExactlyOnceWith(
            `notes/${alphaPath.split("/")[1]}/references`, undefined, false,
            { silentBadRequest: true }
        );
        expect(rowNames()).toStrictEqual([ "*add_link.top_of_note" ]);
        expect(statusRow()?.textContent).toBe("add_link.inspecting_note");
        expect(statusRow()?.querySelector(".bx-loader.bx-spin")).not.toBeNull();

        references.resolve({
            targets: [
                headingTarget("Setup", 2), headingTarget("Linux", 3),
                anchorTarget("alpha"), anchorTarget("zeta")
            ]
        });
        // The rows follow the headings by a render, with nothing said in between.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(statusRow()).toBeNull();
        await settle();
        expect(statusRow()).toBeNull();
        expect(rowNames())
            .toStrictEqual([ "*add_link.top_of_note", "Setup", "Linux", "alpha", "zeta" ]);
        expect(groupTitles())
            .toStrictEqual([ "add_link.link_to_heading", "add_link.link_to_anchor" ]);
        // Each heading is indented by the number of headings it nests under, which are not named.
        const depths = rows().map((row) =>
            row.querySelector("span")?.style.getPropertyValue("--link-mention-depth"));
        expect(depths).toStrictEqual([ "", "", "1", "", "" ]);
        expect(popup()?.querySelector(".note-suggestion-path")).toBeNull();

        await finishSlide();
        expect(pages()).toStrictEqual([ "destinations" ]);

        // The host shows the list for the text typed after the link, which is none yet.
        await draw("", alphaPath);
        expect(rowNames()[0]).toBe("*add_link.top_of_note");
        expect(await press("Enter")).toBe(true);
        expect(onKeepLink).toHaveBeenCalledOnce();
        expect(onPick).not.toHaveBeenCalled();
    });

    it("filters the headings and anchors by the text typed after the link", async () => {
        const { draw, press, onPick } = await showAlphaLinked();
        expect(rowNames())
            .toStrictEqual([ "*add_link.top_of_note", "Setup", "Linux", "Usage", "a b" ]);

        // The whole note is no match. A heading shows the headings it nests under instead of
        // its indent.
        await draw("u", alphaPath);
        expect(rowNames()).toStrictEqual([ "*Setup", "Linux", "Usage" ]);
        expect(groupTitles()).toStrictEqual([ "add_link.link_to_heading" ]);
        expect(rows().map((row) => row.querySelector("b")?.textContent))
            .toStrictEqual([ "u", "u", "U" ]);
        expect(rows().map((row) => row.querySelector(".note-suggestion-path")?.textContent))
            .toStrictEqual([ undefined, "Setup", undefined ]);
        expect(rowNamed("Linux").querySelector("span")?.style.cssText).toBe("");

        await draw("B", alphaPath);
        expect(rowNames()).toStrictEqual([ "*a b" ]);
        expect(groupTitles()).toStrictEqual([ "add_link.link_to_anchor" ]);

        await draw("US", alphaPath);
        expect(rowNames()).toStrictEqual([ "*Usage" ]);
        expect(await press("Enter")).toBe(true);
        expect(onPick).toHaveBeenCalledExactlyOnceWith(`${alphaPath}?block=U`);
        // The text typed after the link looks up no notes.
        expect(getNoteSuggestions.mock.calls.map(([ term ]) => term)).toStrictEqual([ "al" ]);
    });

    it("opens on the first match, also where a later one is named as the text", async () => {
        noteReferences.set(alphaPath.split("/")[1], {
            targets: [ headingTarget("Usage notes", 2, "N"), headingTarget("Usage", 2) ]
        });
        const { draw, press, onPick } = await showAlphaLinked();

        await draw("usage", alphaPath);
        expect(rowNames()).toStrictEqual([ "*Usage notes", "Usage" ]);
        await press("Enter");
        expect(onPick).toHaveBeenCalledExactlyOnceWith(`${alphaPath}?block=N`);
    });

    it("says so when no heading or anchor matches, and leaves the keys to the host", async () => {
        const { draw, press, onPick, onKeepLink } = await showAlphaLinked();

        await draw("zz", alphaPath);
        expect(rows()).toHaveLength(0);
        expect(groupTitles()).toHaveLength(0);
        expect(statusRow()?.textContent).toBe("quick-search.no-results");
        expect(await press("Enter")).toBe(false);
        expect(await press("ArrowDown")).toBe(false);
        expect(onPick).not.toHaveBeenCalled();
        expect(onKeepLink).not.toHaveBeenCalled();

        // The text deleted again lists everything, on the whole note.
        await draw("", alphaPath);
        expect(statusRow()).toBeNull();
        expect(rowNames())
            .toStrictEqual([ "*add_link.top_of_note", "Setup", "Linux", "Usage", "a b" ]);
    });

    it("says so when the note picked has no heading and no anchor to link to", async () => {
        const { press, draw, onKeepLink } = await show("al");
        await press("ArrowDown");
        await press("Enter");
        await draw("", betaPath);

        expect(rowNames()).toStrictEqual([ "*add_link.top_of_note" ]);
        expect(statusRow()?.textContent).toBe("add_link.no_link_targets");
        expect(statusRow()?.querySelector(".bx-info-circle")).not.toBeNull();

        await press("Enter");
        expect(onKeepLink).toHaveBeenCalledOnce();
    });

    it("links a heading or an anchor, giving a heading a block id first", async () => {
        // The keys of the second page move through its rows.
        const first = await showAlphaLinked();
        expect(await first.press("ArrowDown")).toBe(true);
        expect(rowNames()).toContain("*Setup");
        await first.press("ArrowUp");
        await first.press("ArrowUp");
        expect(rowNames()).toContain("*a b");
        await first.press("ArrowUp");
        expect(rowNames()).toContain("*Usage");
        expect(await first.press("Tab")).toBe(true);
        expect(first.onPick).toHaveBeenCalledExactlyOnceWith(`${alphaPath}?block=U`);
        expect(createHeadingReference).not.toHaveBeenCalled();
        await first.unmount();

        const second = await showAlphaLinked();
        await clickRow("a b");
        expect(second.onPick).toHaveBeenCalledExactlyOnceWith(`${alphaPath}?bookmark=a%20b`);
        await second.unmount();

        // A heading without a block id is linked once the server has given it one.
        const third = await showAlphaLinked();
        await clickRow("Setup");
        expect(createHeadingReference).toHaveBeenCalledExactlyOnceWith(
            `notes/${alphaPath.split("/")[1]}/references`,
            { kind: "heading", index: 0, title: "Setup" }
        );
        expect(third.onPick).toHaveBeenCalledOnce();
        expect(third.onPick.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
        expect(await third.onPick.mock.calls[0]?.[0]).toBe(`${alphaPath}?block=NewId`);
        expect(third.onKeepLink).not.toHaveBeenCalled();
    });

    it("links nothing, with an error, when the heading cannot get a block id", async () => {
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        createHeadingReference.mockRejectedValueOnce("{\"message\":\"The headings changed\"}");
        const { onPick } = await showAlphaLinked();
        await clickRow("Setup");

        expect(await onPick.mock.calls[0]?.[0]).toBeUndefined();
        expect(showError).toHaveBeenCalledExactlyOnceWith("add_link.heading_reference_failed");
        expect(consoleError).toHaveBeenCalledOnce();
    });

    it("picks a heading or an anchor only once the link is in the text", async () => {
        const { press, draw, onPick, onKeepLink } = await show("al");
        await press("Enter");
        await press("ArrowDown");
        expect(rowNames()).toContain("*Setup");

        // The keys that pick are kept from the host, and the rows stay.
        expect(await press("Enter")).toBe(true);
        expect(await press("Tab")).toBe(true);
        await clickRow("a b");
        expect(rowNames())
            .toStrictEqual([ "add_link.top_of_note", "*Setup", "Linux", "Usage", "a b" ]);
        expect(onPick).not.toHaveBeenCalled();

        // A key held down picks nothing either.
        await draw("", alphaPath);
        expect(await press("Enter", { repeat: true })).toBe(true);
        expect(await press("Tab", { repeat: true })).toBe(true);
        expect(onPick).not.toHaveBeenCalled();
        expect(onKeepLink).not.toHaveBeenCalled();

        expect(await press("Enter")).toBe(true);
        expect(onPick).toHaveBeenCalledExactlyOnceWith(expect.any(Promise));
    });

    it("takes the pick of the whole note before the link is in the text", async () => {
        const { press, onPick, onKeepLink } = await show("al");
        await press("Enter");

        // The Enter that picked the note, still held down, picks nothing.
        expect(await press("Enter", { repeat: true })).toBe(true);
        expect(onKeepLink).not.toHaveBeenCalled();
        expect(await press("Enter")).toBe(true);
        expect(onKeepLink).toHaveBeenCalledOnce();
        expect(onPick).not.toHaveBeenCalled();
    });

    it("returns to the notes for a query that changes before the note is linked", async () => {
        const { press, draw, settle, onLinkNote } = await show("al");
        await press("Enter");
        await finishSlide();
        await press("ArrowDown");
        expect(rowNames()).toContain("*Setup");

        await draw("alp");
        expect(pages()).toStrictEqual([ "notes entering", "destinations leaving" ]);
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("alp", expect.anything());
        // The keys go to the list of notes again.
        expect(await press("ArrowDown")).toBe(true);
        expect(highlightedNote()?.textContent).toBe("Beta");
        await finishSlide();
        expect(pages()).toStrictEqual([ "notes" ]);

        await draw("al");
        expect(pages()).toStrictEqual([ "notes" ]);
        expect(highlightedNote()?.textContent).toBe("Alpha");

        // A note picked again opens on the whole note.
        await act(async () => noteRows()[0]?.click());
        await settle();
        expect(pages()).toStrictEqual([ "notes leaving", "destinations entering" ]);
        expect(rowNames())
            .toStrictEqual([ "*add_link.top_of_note", "Setup", "Linux", "Usage", "a b" ]);
        expect(onLinkNote).toHaveBeenCalledTimes(2);
    });

    it("drops the headings of a note picked earlier that arrive late", async () => {
        const references = deferred<NoteReferencesResponse>();
        noteReferences.set(alphaPath.split("/")[1], references.promise);
        noteReferences.set(betaPath.split("/")[1], {
            targets: [ headingTarget("Beta heading", 2, "B") ]
        });
        const { press, draw, settle } = await show("al");
        await press("Enter");
        await draw("alp");
        await press("ArrowDown");
        await press("Enter");
        expect(rowNames()).toStrictEqual([ "*add_link.top_of_note", "Beta heading" ]);

        references.resolve({ targets: [ headingTarget("Alpha heading", 2) ] });
        await settle();
        expect(rowNames()).toStrictEqual([ "*add_link.top_of_note", "Beta heading" ]);
    });

    it("lists the headings and anchors that the host's editor holds for its own note", async () => {
        const createLinkPath = vi.fn(() => `${betaPath}?block=Own`);
        const intro: LinkTarget = { kind: "heading", title: "Intro", level: 2, createLinkPath };
        const ownTargets = [ intro, ...createAnchorTargets([ "top" ], betaPath) ];
        const getOwnTargets = vi.fn((notePath: string): LinkTarget[] | undefined =>
            notePath === betaPath ? ownTargets : undefined);
        const { press, draw, onPick } = await show("al", { getOwnTargets });

        await press("ArrowDown");
        await press("Enter");
        expect(getOwnTargets).toHaveBeenCalledExactlyOnceWith(betaPath);
        expect(getReferences).not.toHaveBeenCalled();
        expect(rowNames()).toStrictEqual([ "*add_link.top_of_note", "Intro", "top" ]);

        await draw("", betaPath);
        await press("ArrowDown");
        expect(createLinkPath).not.toHaveBeenCalled();
        await press("Enter");
        expect(onPick).toHaveBeenCalledExactlyOnceWith(`${betaPath}?block=Own`);
        expect(createHeadingReference).not.toHaveBeenCalled();
    });

    it("points the host at the highlighted note, then at the highlighted row", async () => {
        const { press, onActiveDescendant, handleRef, unmount } = await show("al");

        expect(onActiveDescendant).toHaveBeenLastCalledWith(highlightedNote()?.id);
        expect(highlightedNote()?.id).toBeTruthy();

        await press("Enter");
        expect(rows()[0]?.id).toBeTruthy();
        expect(rows()[0]?.getAttribute("aria-selected")).toBe("true");
        expect(onActiveDescendant).toHaveBeenLastCalledWith(rows()[0]?.id);
        await press("ArrowDown");
        expect(onActiveDescendant).toHaveBeenLastCalledWith(rows()[1]?.id);

        await unmount();
        expect(onActiveDescendant).toHaveBeenLastCalledWith(null);
        expect(handleRef.current).toBeNull();
        expect(popup()).toBeNull();
    });

    it("creates a note from a creation row, which is linked without a second page", async () => {
        const createRow: Suggestion = {
            action: "create-note", noteTitle: "al", highlightedNotePathTitle: "Create note"
        };
        getNoteSuggestions.mockResolvedValue([ createRow ]);
        createNoteFromSuggestion.mockResolvedValueOnce("root/inbox/created");
        const { press, onPick, onLinkNote } = await show("al", { allowCreatingNotes: true });

        expect(await press("Enter")).toBe(true);
        expect(await onPick.mock.calls[0]?.[0]).toBe("root/inbox/created");
        expect(onLinkNote).not.toHaveBeenCalled();
        expect(getReferences).not.toHaveBeenCalled();
    });

    it("keeps the width of the notes, and their height until the text filters", async () => {
        const { getBoundingClientRect } = Element.prototype;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
            this: Element
        ) {
            if (this.matches(".tn-popup")) return new DOMRect(0, 0, 420, 200);
            if (this.matches(".link-mention-pages")) return new DOMRect(0, 0, 420, 180);
            return getBoundingClientRect.call(this);
        });
        const pagesHeight = () =>
            popup()?.querySelector<HTMLElement>(".link-mention-pages")?.style.minHeight;
        const { press, draw } = await show("al");
        expect([ popup()?.style.width, pagesHeight() ]).toStrictEqual([ "", "" ]);

        await press("Enter");
        expect([ popup()?.style.width, pagesHeight() ]).toStrictEqual([ "420px", "180px" ]);
        await draw("", alphaPath);
        expect([ popup()?.style.width, pagesHeight() ]).toStrictEqual([ "420px", "180px" ]);
        await draw("s", alphaPath);
        expect([ popup()?.style.width, pagesHeight() ]).toStrictEqual([ "420px", "" ]);
    });

    it("switches pages at once with motion disabled, where no animation runs", async () => {
        document.body.classList.add("motion-disabled");
        try {
            const { press, draw } = await show("al");
            await press("Enter");
            expect(pages()).toStrictEqual([ "destinations" ]);
            await draw("alp");
            expect(pages()).toStrictEqual([ "notes" ]);
        } finally {
            document.body.classList.remove("motion-disabled");
        }
    });
});
