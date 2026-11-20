import type { CKTextEditor } from "@triliumnext/ckeditor5";
import type { ReferenceTarget } from "@triliumnext/commons";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import type { MenuCommandItem } from "../../menus/context_menu";
import froca from "../../services/froca";
import options from "../../services/options";
import server from "../../services/server";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import { highlightedTexts } from "../../test/highlights";
import { createFilterableTab } from "../../test/outline_filter";
import { renderInto } from "../../test/render";
import { useActiveHeading } from "../react/hooks/dom";
import { setEditorNoteId } from "../react/NoteStore";
import { ParentComponent } from "../react/react_utils";
import { useOutlineReport } from "./outline_filter";
import RightPanelWidget, { NavigatedInNote } from "./RightPanelWidget";
import TableOfContents, {
    AbstractTableOfContents, type HeadingContext, type HeadingLinks
} from "./TableOfContents";

const { showMenu, getHeadings, assignBlockId } = vi.hoisted(() => ({
    showMenu: vi.fn(),
    getHeadings: vi.fn(),
    assignBlockId: vi.fn()
}));
// `TableOfContents` loads `attributeChangeAffectsHeading` through a lazy `import()`. Pulling the
// real module in loads the whole editor package from source, which takes longer than these tests
// run and leaves the load in flight once happy-dom is torn down. Every change the fake editor
// below reports is an insert, which the widget acts on without consulting the helper.
vi.mock("@triliumnext/ckeditor5", () => ({
    attributeChangeAffectsHeading: () => false,
    getHeadings,
    assignBlockId
}));
vi.mock("../../menus/context_menu", () => ({ default: { show: showMenu } }));
vi.mock("../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/i18n")>(),
    t: (key: string) => key
}));

const HEADINGS = [
    { id: "first", level: 1, text: "First" },
    { id: "second", level: 2, text: "Second" }
];

describe("useActiveHeading", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("re-subscribes when getHeadingElement changes, even though the container element does not", () => {
        // The editor is swapped (a rebuild) while .scrolling-container, an ancestor of the
        // editor root, stays put — so the listener has to follow getHeadingElement, not the container.
        const container = scrollingContainer();
        const probe = mount(container, headingLookup({ first: 0, second: 500 }));
        scroll(container);
        expect(activeOf(probe)).toBe("first");

        update(probe, container, headingLookup({ first: 0, second: 0 }));
        scroll(container);
        expect(activeOf(probe)).toBe("second");
    });

    it("takes the last heading above the line, and clears once the container goes away", () => {
        const container = scrollingContainer();
        const probe = mount(container, headingLookup({ first: 0, second: 0 }));
        scroll(container);
        expect(activeOf(probe)).toBe("second");

        update(probe, null, headingLookup({ first: 0, second: 0 }));
        expect(activeOf(probe)).toBe("");
    });

    it("skips a heading hidden in a collapsed section", () => {
        const container = scrollingContainer();
        const lookup = headingLookup({ first: 0, second: 0 });
        const second = lookup(HEADINGS[1]);
        if (!second) throw new Error("the second heading is missing");
        second.style.visibility = "hidden";

        const probe = mount(container, lookup);
        scroll(container);
        expect(activeOf(probe)).toBe("first");
    });
});

function ActiveHeadingProbe({ container, getHeadingElement }: {
    container: HTMLElement | null;
    getHeadingElement(heading: typeof HEADINGS[number]): HTMLElement | null;
}) {
    const activeHeadingId = useActiveHeading({
        headings: HEADINGS,
        scrollingContainer: container,
        getHeadingElement
    });

    return <div data-active={activeHeadingId ?? ""} />;
}

type HeadingLookup = (heading: typeof HEADINGS[number]) => HTMLElement | null;

function mount(container: HTMLElement | null, getHeadingElement: HeadingLookup) {
    let probe: HTMLElement | undefined;
    act(() => {
        probe = renderInto(<ActiveHeadingProbe container={container} getHeadingElement={getHeadingElement} />);
    });
    if (!probe) throw new Error("probe did not render");
    return probe;
}

function update(probe: HTMLElement, container: HTMLElement | null, getHeadingElement: HeadingLookup) {
    act(() => {
        render(<ActiveHeadingProbe container={container} getHeadingElement={getHeadingElement} />, probe);
    });
}

function scroll(container: HTMLElement) {
    act(() => {
        container.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(100);
    });
}

function activeOf(probe: HTMLElement) {
    return probe.firstElementChild?.getAttribute("data-active");
}

/**
 * happy-dom reports zeroes for every rect, so each element is given the top the test needs. It is
 * in the document, as `checkVisibility()` finds a detached element hidden.
 */
function elementAt(top: number) {
    const el = document.createElement("h1");
    el.getBoundingClientRect = () => ({ top }) as DOMRect;
    document.body.appendChild(el);
    return el;
}

function scrollingContainer() {
    const container = elementAt(0);
    document.body.appendChild(container);
    return container;
}

/** Stands in for one editor instance: which DOM element each heading currently maps to. */
function headingLookup(tops: Record<string, number>): HeadingLookup {
    const elements = new Map(Object.entries(tops).map(([id, top]) => [id, elementAt(top)]));
    return (heading) => elements.get(heading.id) ?? null;
}

/**
 * Regression tests for the table of contents while an auto-read-only note is temporarily made
 * editable ("Edit this note").
 *
 * The sidebar swaps its source the instant `readOnlyTemporarilyDisabled` flips: the read-only
 * extractor (which reads the rendered content element) gives way to the editor one. The note
 * detail, meanwhile, keeps the CKEditor instance mounted behind the read-only view with the
 * previously edited note still in it, and hands it this note's content only once the blob
 * arrives — a wait the auto-read-only threshold guarantees is a long one. Extracting from the
 * editor in between put the other note's headings in the sidebar, so unlocking a note appeared
 * to shift its table of contents back to a previous version.
 */
describe("TableOfContents while an auto-read-only note is temporarily editable", () => {
    it("leaves out the headings of the note the reused editor still holds, until it has this note's", async () => {
        const toc = await setupUnlockScenario();

        // Read-only: the headings come from the rendered content, and are the note's own.
        expect(toc.headings()).toEqual([ "Current" ]);

        await toc.unlock();
        expect(toc.headings()).not.toContain("Previously edited note");
        expect(toc.headings()).toEqual([]);

        // The blob arrives and the note detail loads it into the editor.
        await toc.editor.loadNote(toc.noteId, [ [ 2, "Current" ], [ 3, "Nested" ] ]);
        expect(toc.headings()).toEqual([ "Current", "Nested" ]);
    });

    it("shows the editor's headings straight away when it already holds the note", async () => {
        const toc = await setupUnlockScenario();
        await toc.editor.loadNote(toc.noteId, [ [ 2, "Current" ] ]);

        await toc.unlock();

        expect(toc.headings()).toEqual([ "Current" ]);
    });

    it("picks up a heading typed into the editor before the effects have settled", async () => {
        // The attribute-change check is loaded lazily, but the change listener itself is attached
        // synchronously with the unlock: a `setData()` in between must not go unseen.
        const toc = await setupUnlockScenario();
        await toc.unlock({ rounds: 1 });

        await toc.editor.loadNote(toc.noteId, [ [ 2, "Typed while loading" ] ]);

        expect(toc.headings()).toEqual([ "Typed while loading" ]);
    });

    it("reads the headings once per frame, however many changes arrive in it", async () => {
        const toc = await setupUnlockScenario();
        await toc.unlock();
        const createRangeIn = vi.spyOn(toc.editor.editor.model, "createRangeIn");

        await toc.editor.loadNote(toc.noteId, [ [ 2, "Current" ] ], { changes: 3 });

        expect(createRangeIn).toHaveBeenCalledTimes(1);
        expect(toc.headings()).toEqual([ "Current" ]);
    });

    it("reads the headings without changing the model, and keeps each heading's id", async () => {
        const toc = await setupUnlockScenario();
        await toc.unlock();
        const change = vi.spyOn(toc.editor.editor.model, "change");

        await toc.editor.loadNote(toc.noteId, [ [ 2, "Current" ], [ 2, "Current" ] ]);
        const [ first, second ] = toc.rows();
        expect(toc.rows()).toHaveLength(2);
        await toc.editor.notify();

        expect(change).not.toHaveBeenCalled();
        expect(toc.rows()).toHaveLength(2);
        expect(toc.rows()[0]).toBe(first);
        expect(toc.rows()[1]).toBe(second);
    });
});

describe("TableOfContents in a host that covers the note", () => {
    it("tells the host once a heading is pressed, so that it can close over the heading", async () => {
        const onNavigated = vi.fn();
        const toc = await setupUnlockScenario({ onNavigated });
        const heading = toc.container.querySelector<HTMLElement>(".toc .item-content");
        expect(heading?.textContent).toBe("Current");

        await act(async () => heading?.click());

        expect(onNavigated).toHaveBeenCalledOnce();
    });
});

describe("the collapsed headings of the outline", () => {
    it("stay collapsed when the card collapses, and start over for another note", async () => {
        vi.spyOn(server, "put").mockResolvedValue({});
        const headings = [
            { id: "first", level: 1, text: "First" },
            { id: "inner", level: 2, text: "Inner" },
            { id: "last", level: 1, text: "Last" }
        ];
        const outline = await renderContextOutline(headings);
        const isCollapsed = () => outline.rows()[0]?.classList.contains("collapsed");

        await act(async () => {
            outline.rows()[0].querySelector<HTMLElement>(".collapse-button")?.click();
        });
        expect(isCollapsed()).toBe(true);

        const header = outline.container.querySelector<HTMLElement>("#toc .card-header");
        await act(async () => header?.click());
        expect(outline.rows()).toHaveLength(0);
        await act(async () => header?.click());
        expect(outline.rows()).toHaveLength(3);
        expect(isCollapsed()).toBe(true);

        await outline.switchNote(headings);
        expect(outline.rows()).toHaveLength(3);
        expect(isCollapsed()).toBe(false);
    });
});

describe("the outline while its tab filters", () => {
    let tab: ReturnType<typeof createFilterableTab>;

    beforeEach(() => {
        options.load({ rightPaneCollapsedItems: "[]" } as Parameters<typeof options.load>[0]);
        vi.spyOn(server, "put").mockResolvedValue({});
        tab = createFilterableTab();
    });

    afterEach(() => {
        tab.destroy();
        vi.restoreAllMocks();
    });

    it("lists the matches flat with the headings above them, then the tree again", async () => {
        const headings = [
            { id: "setup", level: 1, text: "Setup" },
            { id: "linux", level: 2, text: "Linux" },
            { id: "budget", level: 3, text: "<b>Bud</b>get" },
            { id: "usage", level: 1, text: "Budget usage" }
        ];
        const scrollToHeading = vi.fn();
        const getTarget = vi.fn(async (_heading: object) => null);
        const noteContext = markdownContext("filter-ntx");
        noteContext.setContextData("toc", {
            headings, scrollToHeading, headingLinks: { getTarget, hasPublicLinks: true }
        });
        appContext.tabManager = {
            getActiveContext: () => noteContext
        } as typeof appContext.tabManager;
        await tab.render([ <TableOfContents /> ]);
        const rows = () => [ ...tab.container.querySelectorAll<HTMLElement>(".toc li") ];
        await act(async () => {
            rows()[0].querySelector<HTMLElement>(".collapse-button")?.click();
        });

        await tab.type("budget");
        expect(rows().map((row) => row.querySelector(".item-title")?.textContent))
            .toStrictEqual([ "Budget", "Budget usage" ]);
        expect(rows().map((row) => row.querySelector(".item-path")?.textContent))
            .toStrictEqual([ "Setup / Linux", undefined ]);
        expect(tab.container.querySelector(".toc .collapse-button")).toBeNull();
        // One range across the formatting.
        expect(highlightedTexts("search-match", rows()[0])).toStrictEqual([ "Budget" ]);

        const items = await openRowMenu(rows()[0]);
        expect(items.map((item) => item.title)).toStrictEqual([ "block_reference.copy_reference" ]);

        await tab.press("Enter");
        expect(scrollToHeading).toHaveBeenCalledExactlyOnceWith(headings[2]);

        await tab.type("");
        expect(rows().map((row) => row.querySelector(".item-content")?.textContent))
            .toStrictEqual([ "Setup", "Linux", "Budget", "Budget usage" ]);
        expect(rows()[0].classList.contains("collapsed")).toBe(true);
    });

    it("waits for the headings of a note whose content the editor does not hold yet", async () => {
        const first = buildNote({ title: "First", type: "text" });
        const second = buildNote({ title: "Second", type: "text" });
        let shownNote = first;
        const noteContext = new NoteContext("switch-ntx");
        noteContext.noteId = first.noteId;
        noteContext.notePath = first.noteId;
        noteContext.viewScope = { viewMode: "default", isReadOnly: false };
        Object.defineProperty(noteContext, "note", { get: () => shownNote });
        appContext.tabManager = {
            getActiveContext: () => noteContext
        } as typeof appContext.tabManager;
        const editor = fakeTextEditor();
        await editor.loadNote(first.noteId, [ [ 2, "Budget" ] ]);
        vi.spyOn(noteContext, "getTextEditor").mockImplementation(async (callback) => {
            callback?.(editor.editor);
            return editor.editor;
        });
        await tab.render([ <TableOfContents /> ]);
        await settle();

        shownNote = second;
        noteContext.noteId = second.noteId;
        noteContext.notePath = second.noteId;
        await act(async () => {
            await appContext.triggerEvent("noteSwitched", {
                noteContext, notePath: second.noteId
            });
        });
        await settle();
        const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
        await tab.type("budget");
        await tab.press("Enter");
        expect(scrollIntoView).not.toHaveBeenCalled();

        await editor.loadNote(second.noteId, [ [ 2, "Budget" ] ]);
        await settle();
        expect(scrollIntoView).toHaveBeenCalledOnce();
        expect(scrollIntoView.mock.contexts[0]).toBe(editor.items()[0].el);
    });

    it("acts on the split in front, for one note open in two splits", async () => {
        const note = buildNote({ title: "Guide", type: "code", mime: "text/x-markdown" });
        const firstSplit = markdownContext("split-1", note);
        const secondSplit = markdownContext("split-2", note);
        const firstScroll = vi.fn();
        const secondScroll = vi.fn();
        const headings = [ { id: "budget", level: 1, text: "Budget" } ];
        firstSplit.setContextData("toc", { headings, scrollToHeading: firstScroll });
        secondSplit.setContextData("toc", { headings, scrollToHeading: secondScroll });
        let activeContext = firstSplit;
        appContext.tabManager = {
            getActiveContext: () => activeContext
        } as typeof appContext.tabManager;
        let finishLoading: () => void = () => {};
        function LoadingSection() {
            const [ isLoading, setIsLoading ] = useState(true);
            finishLoading = () => setIsLoading(false);
            useOutlineReport("loading", isLoading
                ? { status: "loading", navigates: true }
                : { status: "ready", count: 0 });
            return <RightPanelWidget id="loading" title="loading">loading</RightPanelWidget>;
        }
        await tab.render([ <LoadingSection />, <TableOfContents /> ]);

        await tab.type("budget");
        await tab.press("Enter");
        activeContext = secondSplit;
        await act(async () => {
            await appContext.triggerEvent("activeContextChanged", { noteContext: secondSplit });
        });
        expect(tab.field()?.value).toBe("");
        await act(async () => finishLoading());
        expect(firstScroll).not.toHaveBeenCalled();
        expect(secondScroll).not.toHaveBeenCalled();

        await tab.type("budget");
        await tab.press("Enter");
        expect(secondScroll).toHaveBeenCalledOnce();
        expect(firstScroll).not.toHaveBeenCalled();
    });
});

/** A note context that shows a Markdown note, `note` or a new one. */
function markdownContext(ntxId: string, note = buildNote({
    title: "Guide", type: "code", mime: "text/x-markdown"
})) {
    const noteContext = new NoteContext(ntxId);
    noteContext.noteId = note.noteId;
    noteContext.notePath = note.noteId;
    noteContext.viewScope = { viewMode: "default" };
    Object.defineProperty(noteContext, "note", { get: () => note });
    return noteContext;
}

describe("the menu of an outline heading", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        restoreClipboard();
    });

    it("opens on a right click and a long press, with the published heading", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const headings = [
            { id: "a", level: 2, text: "Alpha" }, { id: "b", level: 3, text: "Beta" }
        ];
        const getTarget = vi.fn(async (_heading: object) => null);
        const toc = await renderContextOutline(headings, { getTarget, hasPublicLinks: true });
        const [ , second ] = toc.rows();

        const items = await openRowMenu(second);
        expect(items.map((item) => item.title)).toStrictEqual([ "block_reference.copy_reference" ]);
        expect(getTarget).not.toHaveBeenCalled();
        stubClipboard();
        pick(items, 0);
        await settle();
        expect(getTarget).toHaveBeenCalledTimes(1);
        expect(getTarget.mock.calls[0][0]).toBe(headings[1]);

        showMenu.mockClear();
        vi.useFakeTimers();
        const press = new Event("touchstart", { bubbles: true });
        Object.defineProperty(press, "touches", { value: [ { pageX: 1, pageY: 2 } ] });
        act(() => {
            second.dispatchEvent(press);
            vi.advanceTimersByTime(400);
        });
        vi.useRealTimers();
        await settle();
        expect(showMenu).toHaveBeenCalledTimes(1);
    });

    it("leaves the browser's menu to a source whose headings cannot be linked", async () => {
        const toc = await renderContextOutline([ { id: "a", level: 2, text: "Alpha" } ]);
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

        act(() => { toc.rows()[0].dispatchEvent(event); });
        await settle();
        expect(event.defaultPrevented).toBe(false);
        expect(showMenu).not.toHaveBeenCalled();
    });
});

describe("the copy button of an outline heading", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        restoreClipboard();
    });

    it("copies a reference to its heading, writing the clipboard within the click", async () => {
        const headings = [
            { id: "a", level: 2, text: "Alpha" }, { id: "b", level: 3, text: "Beta" }
        ];
        const getTarget = vi.fn(async (heading: { id: string; text: string }) => ({
            kind: "heading" as const,
            title: heading.text,
            params: { block: heading.id },
            createLinkPath: () => `guide?block=${heading.id}`
        }));
        const toc = await renderContextOutline(headings, { getTarget, hasPublicLinks: true });
        const button = toc.rows()[1].querySelector<HTMLElement>(".tree-item-button.bx-copy");
        expect(button?.title).toBe("block_reference.copy_reference");

        const writes = stubClipboard();
        act(() => { button?.click(); });
        expect(navigator.clipboard.write).toHaveBeenCalledOnce();
        expect(await writes[0]).toStrictEqual({
            "text/plain": "#guide?block=b",
            "text/html": `<a class="reference-link" href="#guide?block=b">Guide - Beta</a>`
        });
        await settle();
        expect(getTarget).toHaveBeenCalledOnce();
        expect(getTarget.mock.calls[0][0]).toBe(headings[1]);
        expect(showMenu).not.toHaveBeenCalled();
    });

    it("is left out where a heading cannot be linked", async () => {
        const headingLinks = { getTarget: async () => null, hasPublicLinks: false };
        const unlinked = await renderContextOutline([ { id: "a", level: 2, text: "Alpha" } ]);
        const disabled = await renderContextOutline([
            { id: "a", level: 2, text: "Alpha", isDisabled: true },
            { id: "b", level: 2, text: "Beta" }
        ], headingLinks);
        const inert = renderInto(
            <AbstractTableOfContents
                headings={[ { id: "a", level: 2, text: "Alpha" } ]}
                scrollToHeading={() => {}}
                note={buildNote({ title: "Inert" })}
                headingLinks={headingLinks}
                isInert
            />
        );

        expect(unlinked.rows()[0].querySelector(".tree-item-button")).toBeNull();
        expect(disabled.rows().map((row) => !!row.querySelector(".tree-item-button")))
            .toStrictEqual([ false, true ]);
        expect(inert.querySelector(".toc li")).not.toBeNull();
        expect(inert.querySelector(".tree-item-button")).toBeNull();
    });
});

describe("copying a reference from a read-only text note", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        restoreClipboard();
    });

    it("links a heading that owns an id after the marked listing alone", async () => {
        const toc = await renderReadOnlyOutline(
            `<h2>Intro</h2><h2 data-trilium-block-id="kept">Setup</h2>`
        );
        const get = answerMarked(toc.blobId, [ heading("Intro"), heading("Setup", "kept") ],
            `<h2 ${mark(0)}>Intro</h2><h2 data-trilium-block-id="kept" ${mark(1)}>Setup</h2>`);
        const post = vi.spyOn(server, "postWithSilentErrors");

        expect(await copyFromRow(toc.rows()[1])).toStrictEqual({
            "text/plain": `#${toc.noteId}?block=kept`,
            "text/html":
                `<a class="reference-link" href="#${toc.noteId}?block=kept">Guide - Setup</a>`
        });
        expect(get).toHaveBeenCalledExactlyOnceWith(`notes/${toc.noteId}/references/marked`);
        expect(post).not.toHaveBeenCalled();
    });

    it("tells two headings of one title apart by their marks, with ids and without", async () => {
        // The page as the browser repairs it: the heading that stood in the table comes first.
        const repaired = (first: string, second: string) => `<h2${first}>Install</h2><table><tbody>`
            + `<tr><td><h2${second}>Install</h2></td></tr></tbody></table>`;
        const toc = await renderReadOnlyOutline(repaired("", ""));
        answerMarked(toc.blobId, [ heading("Install"), heading("Install") ],
            repaired(` ${mark(1)}`, ` ${mark(0)}`));
        const post = vi.spyOn(server, "postWithSilentErrors")
            .mockResolvedValue({ params: { block: "New" } });

        expect((await copyFromRow(toc.rows()[0]))?.["text/plain"]).toBe(`#${toc.noteId}?block=New`);
        expect(post).toHaveBeenLastCalledWith(`notes/${toc.noteId}/references`,
            { kind: "heading", index: 1, title: "Install", blobId: toc.blobId });
        await copyFromRow(toc.rows()[1]);
        expect(post).toHaveBeenLastCalledWith(`notes/${toc.noteId}/references`,
            { kind: "heading", index: 0, title: "Install", blobId: toc.blobId });

        const ids = ` data-trilium-block-id="moved"`;
        const cellIds = ` data-trilium-block-id="cell"`;
        const withIds = await renderReadOnlyOutline(repaired(ids, cellIds));
        answerMarked(withIds.blobId, [ heading("Install", "cell"), heading("Install", "moved") ],
            repaired(`${ids} ${mark(1)}`, `${cellIds} ${mark(0)}`));
        expect((await copyFromRow(withIds.rows()[0]))?.["text/plain"])
            .toBe(`#${withIds.noteId}?block=moved`);
        expect((await copyFromRow(withIds.rows()[1]))?.["text/plain"])
            .toBe(`#${withIds.noteId}?block=cell`);
        expect(post).toHaveBeenCalledTimes(2);
    });

    it("posts the title that the server lists, not the label on the page", async () => {
        const toc = await renderReadOnlyOutline(
            `<h2><a class="reference-link" href="#root/other">Install</a></h2>`
        );
        answerMarked(toc.blobId, [ heading("Old title") ],
            `<h2 ${mark(0)}><a class="reference-link" href="#root/other">Old title</a></h2>`);
        const post = vi.spyOn(server, "postWithSilentErrors")
            .mockResolvedValue({ params: { block: "New" } });

        expect((await copyFromRow(toc.rows()[0]))?.["text/html"]).toContain("Guide - Old title");
        expect(post).toHaveBeenCalledExactlyOnceWith(`notes/${toc.noteId}/references`,
            { kind: "heading", index: 0, title: "Old title", blobId: toc.blobId });
    });

    it("copies nothing for a heading that it cannot tell apart, with one toast", async () => {
        const cases: {
            page: string; marked: string; headings: ReferenceTarget[];
            blobId?: string | null; isStale?: boolean; prepare?(toc: ReadOnlyOutline): void;
        }[] = [
            // A heading that the server does not list.
            { page: "<h2>A</h2>", marked: "<h2>A</h2>", headings: [] },
            // An empty heading that stores an index in range of the listing.
            {
                page: `<h2 data-trilium-heading-index="0"></h2><h2>A</h2>`,
                marked: `<h2 data-trilium-heading-index="0"></h2><h2 ${mark(0)}>A</h2>`,
                headings: [ heading("A") ]
            },
            // A page whose headings are not those of the marked content.
            {
                page: "<h2>A</h2><h3>B</h3>", marked: `<h2 ${mark(0)}>A</h2>`,
                headings: [ heading("A") ]
            },
            // A listed id that the page resolves to an earlier element.
            {
                page: `<p data-trilium-block-id="dup">P</p><h2 data-trilium-block-id="dup">A</h2>`,
                marked: `<p data-trilium-block-id="dup">P</p><h2 ${mark(0)}>A</h2>`,
                headings: [ heading("A", "dup") ]
            },
            // A heading that left the content after the menu opened.
            {
                page: "<h2>A</h2>", marked: `<h2 ${mark(0)}>A</h2>`, headings: [ heading("A") ],
                prepare: (toc) => toc.contentEl.querySelector("h2")?.remove()
            },
            // A page that names no blob.
            {
                page: "<h2>A</h2>", marked: `<h2 ${mark(0)}>A</h2>`, headings: [ heading("A") ],
                blobId: null
            },
            // A listing of a blob newer than the one on screen, with and without an id, while
            // froca's cache still has the blob of the page.
            {
                page: "<h2>A</h2>", marked: `<h2 ${mark(0)}>A</h2>`, headings: [ heading("A") ],
                isStale: true
            },
            {
                page: `<h2 data-trilium-block-id="a">A</h2>`,
                marked: `<h2 data-trilium-block-id="a" ${mark(0)}>A</h2>`,
                headings: [ heading("A", "a") ],
                isStale: true
            }
        ];

        for (const { page, marked, headings, blobId, isStale, prepare } of cases) {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            const toc = await renderReadOnlyOutline(page, blobId);
            answerMarked(isStale ? "newer" : toc.blobId, headings, marked);
            if (isStale) {
                vi.spyOn(froca, "getBlob").mockResolvedValue({ blobId: toc.blobId } as never);
            }
            const post = vi.spyOn(server, "postWithSilentErrors");
            const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
            const items = await openRowMenu(toc.rows()[0]);
            prepare?.(toc);

            expect(await pickAndRead(items, 0)).toBeNull();
            expect(post).not.toHaveBeenCalled();
            expect(showError).toHaveBeenCalledExactlyOnceWith("block_reference.copy_failed");
            vi.restoreAllMocks();
        }
    });

    it("offers no menu on a help page", async () => {
        const toc = await renderReadOnlyOutline("<h2>A</h2>", undefined, "_help_page");
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

        act(() => { toc.rows()[0].dispatchEvent(event); });
        await settle();
        expect(event.defaultPrevented).toBe(false);
        expect(showMenu).not.toHaveBeenCalled();
    });
});

describe("copying a reference from an editable text note", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        restoreClipboard();
    });

    /** The outline of the editor holding the note, and its first heading as the editor lists it. */
    async function renderEditableOutline() {
        const toc = await setupUnlockScenario();
        await toc.unlock();
        await toc.editor.loadNote(toc.noteId, [ [ 2, "Current" ] ]);
        const [ item ] = toc.editor.items();
        getHeadings.mockReturnValue([ { element: item, text: "Current", level: 2 } ]);
        assignBlockId.mockReturnValue("New");
        return { ...toc, item };
    }

    function answerLiveNote(content: string | null) {
        return vi.spyOn(server, "getWithSilentErrors").mockResolvedValue({ blobId: "b", content });
    }

    it("copies the id the editor gives the heading, once it is in the saved note", async () => {
        const toc = await renderEditableOutline();
        const trigger = vi.spyOn(appContext, "triggerEvent");
        const read = answerLiveNote(`<h2 data-trilium-block-id="New">Current</h2>`);

        expect(await copyFromRow(toc.rows()[0])).toStrictEqual({
            "text/plain": `#${toc.noteId}?block=New`,
            "text/html": `<a class="reference-link" href="#${toc.noteId}?block=New">`
                + "Big note - Current</a>"
        });
        expect(assignBlockId).toHaveBeenCalledExactlyOnceWith(toc.editor.editor.model, toc.item);
        expect(trigger).toHaveBeenCalledWith("saveNoteChanges", { noteId: toc.noteId });
        expect(read).toHaveBeenCalledExactlyOnceWith(`notes/${toc.noteId}/blob`);
    });

    it("copies nothing when the editor lost the heading, or the save lost the id", async () => {
        const cases: ((toc: Awaited<ReturnType<typeof renderEditableOutline>>) => void)[] = [
            (toc) => setEditorNoteId(toc.editor.editor, "othernote"),
            (toc) => { (toc.editor.editor as { isReadOnly: boolean }).isReadOnly = true; },
            (toc) => { toc.item.isAttached = () => false; },
            () => {}
        ];

        for (const prepare of cases) {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            const toc = await renderEditableOutline();
            answerLiveNote("<h2>Current</h2>");
            const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
            const items = await openRowMenu(toc.rows()[0]);
            prepare(toc);

            expect(await pickAndRead(items, 0)).toBeNull();
            expect(showError).toHaveBeenCalledExactlyOnceWith("block_reference.copy_failed");
            vi.restoreAllMocks();
        }
    });
});

interface ReadOnlyOutline {
    noteId: string;
    blobId: string;
    contentEl: HTMLElement;
    rows(): HTMLElement[];
}

/**
 * Renders the outline of a read-only text note whose page shows `html`, rendered from the blob
 * `blobId`; `null` leaves the blob unnamed.
 */
async function renderReadOnlyOutline(
    html: string, blobId: string | null = "shown", noteId?: string
): Promise<ReadOnlyOutline> {
    options.load({ rightPaneCollapsedItems: "[]" } as Parameters<typeof options.load>[0]);
    showMenu.mockClear();
    const note = buildNote({
        ...(noteId ? { id: noteId } : {}), title: "Guide", type: "text", content: html
    });
    const noteContext = new NoteContext("toc-read-only-ntx");
    noteContext.noteId = note.noteId;
    noteContext.notePath = note.noteId;
    noteContext.viewScope = { viewMode: "default", isReadOnly: true };
    Object.defineProperty(noteContext, "note", { get: () => note });
    appContext.tabManager = { getActiveContext: () => noteContext } as typeof appContext.tabManager;

    const contentEl = document.createElement("div");
    contentEl.innerHTML = html;
    if (blobId !== null) {
        // The page shows the note's own blob.
        note.blobId = blobId;
        contentEl.dataset.blobId = blobId;
    }
    document.body.appendChild(contentEl);
    vi.spyOn(noteContext, "getContentElement").mockResolvedValue($(contentEl));

    const parent = new Component();
    appContext.child(parent);
    let container!: HTMLElement;
    await act(async () => {
        container = renderInto(
            <ParentComponent.Provider value={parent}>
                <TableOfContents />
            </ParentComponent.Provider>
        );
    });
    await settle();
    return {
        noteId: note.noteId,
        blobId: blobId ?? "",
        contentEl,
        rows: () => [ ...container.querySelectorAll<HTMLElement>(".toc li") ]
    };
}

function heading(title: string, block?: string): ReferenceTarget {
    return block
        ? { kind: "heading", title, level: 2, params: { block } }
        : { kind: "heading", title, level: 2 };
}

/** The mark of the heading at `index`, with the token `Tok`. */
function mark(index: number) {
    return `data-trilium-heading-index="Tok.${index}"`;
}

/** Mocks the marked listing of the note: `headings` and `markedContent`, read from `blobId`. */
function answerMarked(blobId: string, headings: ReferenceTarget[], markedContent: string) {
    return vi.spyOn(server, "getWithSilentErrors")
        .mockResolvedValue({ blobId, headings, markedContent, markToken: "Tok" });
}

/** Copies a reference to the heading of `row`, and returns what the clipboard got, or `null`. */
async function copyFromRow(row: HTMLElement) {
    return await pickAndRead(await openRowMenu(row), 0);
}

/** Picks the row at `index` and returns what the clipboard got, or `null` for a failed write. */
async function pickAndRead(items: MenuCommandItem<string>[], index: number) {
    const writes = stubClipboard();
    pick(items, index);
    const written = await writes[0]?.catch(() => null);
    await settle();
    return written ?? null;
}

/** Renders the outline of a Markdown note that publishes `headings` and `headingLinks`. */
async function renderContextOutline(
    headings: HeadingContext["headings"], headingLinks?: HeadingLinks
) {
    options.load({ rightPaneCollapsedItems: "[]" } as Parameters<typeof options.load>[0]);
    showMenu.mockClear();
    let note = buildNote({ title: "Guide", type: "code", mime: "text/x-markdown" });
    const noteContext = new NoteContext("toc-context-ntx");
    noteContext.noteId = note.noteId;
    noteContext.notePath = note.noteId;
    Object.defineProperty(noteContext, "note", { get: () => note });
    appContext.tabManager = { getActiveContext: () => noteContext } as typeof appContext.tabManager;
    noteContext.setContextData("toc", { headings, scrollToHeading: () => {}, headingLinks });

    const parent = new Component();
    appContext.child(parent);
    let container!: HTMLElement;
    await act(async () => {
        container = renderInto(
            <ParentComponent.Provider value={parent}>
                <TableOfContents />
            </ParentComponent.Provider>
        );
    });
    await settle();
    return {
        note,
        container,
        rows: () => [ ...container.querySelectorAll<HTMLElement>(".toc li") ],
        /** Shows another Markdown note in the same context, publishing `newHeadings`. */
        async switchNote(newHeadings: HeadingContext["headings"]) {
            note = buildNote({ title: "Other guide", type: "code", mime: "text/x-markdown" });
            noteContext.noteId = note.noteId;
            noteContext.notePath = note.noteId;
            await act(async () => {
                noteContext.setContextData("toc", {
                    headings: newHeadings, scrollToHeading: () => {}
                });
                await appContext.triggerEvent("noteSwitched", {
                    noteContext, notePath: note.noteId
                });
            });
            await settle();
        }
    };
}

/** Right-clicks `row` and returns the rows of the menu that opens. */
async function openRowMenu(row: HTMLElement) {
    showMenu.mockClear();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { row.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(showMenu).toHaveBeenCalledTimes(1));
    return showMenu.mock.calls[0][0].items as MenuCommandItem<string>[];
}

/** Picks the row at `index`, as the context menu does. */
function pick(items: MenuCommandItem<string>[], index: number) {
    items[index].handler?.(items[index], new MouseEvent("click"));
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

/** A clipboard whose writes read their data, as a browser does; returns the written data. */
function stubClipboard() {
    const writes: Promise<Record<string, string>>[] = [];
    (globalThis as any).ClipboardItem = class {
        constructor(public readonly data: Record<string, Promise<Blob>>) {}
    };
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            write: vi.fn((items: { data: Record<string, Promise<Blob>> }[]) => {
                const entries = Object.entries(items[0].data).map(async ([ type, blob ]) =>
                    [ type, await (await blob).text() ] as const);
                const written = Promise.all(entries).then(Object.fromEntries);
                writes.push(written);
                return written.then(() => undefined);
            })
        }
    });
    return writes;
}

function restoreClipboard() {
    delete (globalThis as any).ClipboardItem;
    if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
}

async function setupUnlockScenario({ onNavigated }: { onNavigated?: () => void } = {}) {
    options.load({ rightPaneCollapsedItems: "[]" } as Parameters<typeof options.load>[0]);

    const note = buildNote({ id: "bignote", title: "Big note", type: "text", content: "<h2>Current</h2>" });
    const noteContext = new NoteContext("toc-ntx");
    noteContext.noteId = note.noteId;
    noteContext.notePath = note.noteId;
    noteContext.viewScope = { viewMode: "default", isReadOnly: true };
    Object.defineProperty(noteContext, "note", { get: () => note });
    appContext.tabManager = { getActiveContext: () => noteContext } as typeof appContext.tabManager;

    // What the read-only view has on screen.
    const contentEl = document.createElement("div");
    contentEl.innerHTML = "<h2>Current</h2>";
    document.body.appendChild(contentEl);
    vi.spyOn(noteContext, "getContentElement").mockResolvedValue($(contentEl));

    // The editor the note detail keeps mounted behind the read-only view, still holding the note
    // the user edited before navigating here.
    const editor = fakeTextEditor();
    await editor.loadNote("othernote", [ [ 2, "Previously edited note" ] ]);
    vi.spyOn(noteContext, "getTextEditor").mockImplementation(async (callback) => {
        callback?.(editor.editor);
        return editor.editor;
    });

    const parent = new Component();
    appContext.child(parent);
    let container!: HTMLElement;
    await act(async () => {
        container = renderInto(
            <ParentComponent.Provider value={parent}>
                <NavigatedInNote.Provider value={onNavigated ?? null}>
                    <TableOfContents />
                </NavigatedInNote.Provider>
            </ParentComponent.Provider>
        );
    });
    await settle();

    return {
        noteId: note.noteId,
        editor,
        container,
        headings: () => [ ...container.querySelectorAll(".toc .item-content") ].map((el) => el.textContent),
        rows: () => [ ...container.querySelectorAll<HTMLElement>(".toc li") ],
        async unlock({ rounds }: { rounds?: number } = {}) {
            await act(async () => {
                if (noteContext.viewScope) noteContext.viewScope.readOnlyTemporarilyDisabled = true;
                await appContext.triggerEvent("readOnlyTemporarilyDisabled", { noteContext });
            });
            await settle(rounds);
        }
    };
}

/** Lets the effects, the content element they await and the extraction's animation frame run. */
async function settle(rounds = 5) {
    for (let i = 0; i < rounds; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

/**
 * The parts of a CKEditor instance {@link TableOfContents} reads: a model whose walker yields the
 * headings it was last loaded with, and a `change:data` event for when they are replaced.
 */
function fakeTextEditor() {
    const listeners = new Set<() => void>();
    let items: FakeHeadingItem[] = [];

    const editor = {
        isReadOnly: false,
        model: {
            document: {
                getRoot: () => ({}),
                differ: { getChanges: () => [ { type: "insert" } ] },
                on: (_event: string, callback: () => void) => listeners.add(callback),
                off: (_event: string, callback: () => void) => listeners.delete(callback)
            },
            change: () => {},
            createRangeIn: () => ({ getWalker: () => items.map((item) => ({ type: "elementStart", item })) })
        },
        editing: {
            mapper: { toViewElement: (item: FakeHeadingItem) => item },
            view: { domConverter: { mapViewToDom: (viewElement: FakeHeadingItem) => viewElement.el } }
        }
    } as unknown as CKTextEditor;

    return {
        editor,
        /**
         * Stands in for the note detail feeding the editor a note's content once its blob arrives,
         * reported as `changes` separate changes within one frame.
         */
        async loadNote(noteId: string, headings: [ number, string ][], { changes = 1 } = {}) {
            items = headings.map(([ level, text ]) => fakeHeadingItem(level, text));
            setEditorNoteId(editor, noteId);
            await notify(changes);
        },
        /** Reports a change that leaves the headings as they are. */
        notify,
        /** The heading elements of the model. */
        items: () => items
    };

    async function notify(changes = 1) {
        await act(async () => {
            for (let i = 0; i < changes; i++) {
                for (const listener of [ ...listeners ]) listener();
            }
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });
    }
}

interface FakeHeadingItem {
    name: string;
    el: HTMLElement;
    is(type: string, name?: string): boolean;
    getChildren(): never[];
    isAttached(): boolean;
}

function fakeHeadingItem(level: number, text: string): FakeHeadingItem {
    const el = document.createElement(`h${level}`);
    el.textContent = text;

    return {
        name: `heading${level}`,
        el,
        is: (type, name) => type === "element" && (!name || name === `heading${level}`),
        getChildren: () => [],
        isAttached: () => true
    };
}
