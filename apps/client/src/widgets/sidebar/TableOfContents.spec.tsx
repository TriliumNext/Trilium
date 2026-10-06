import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { setEditorNoteId } from "../react/NoteStore";
import { ParentComponent } from "../react/react_utils";
import TableOfContents, { useActiveHeading } from "./TableOfContents";

// `TableOfContents` loads `attributeChangeAffectsHeading` through a lazy `import()`. Pulling the
// real module in loads the whole editor package from source, which takes longer than these tests
// run and leaves the load in flight once happy-dom is torn down. Every change the fake editor
// below reports is an insert, which the widget acts on without consulting the helper.
vi.mock("@triliumnext/ckeditor5", () => ({
    attributeChangeAffectsHeading: () => false
}));

const HEADINGS = [
    { id: "first", level: 1, text: "First" },
    { id: "second", level: 2, text: "Second" }
];

describe("useActiveHeading", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("re-subscribes when getHeadingElement changes, even though the container element does not", () => {
        // The editor is swapped (watchdog recovery) while .scrolling-container, an ancestor of the
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

/** happy-dom reports zeroes for every rect, so each element is given the top the test needs. */
function elementAt(top: number) {
    const el = document.createElement("h1");
    el.getBoundingClientRect = () => ({ top }) as DOMRect;
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
});

async function setupUnlockScenario() {
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
                <TableOfContents />
            </ParentComponent.Provider>
        );
    });
    await settle();

    return {
        noteId: note.noteId,
        editor,
        headings: () => [ ...container.querySelectorAll(".toc .item-content") ].map((el) => el.textContent),
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
        model: {
            document: {
                getRoot: () => ({}),
                differ: { getChanges: () => [ { type: "insert" } ] },
                on: (_event: string, callback: () => void) => listeners.add(callback),
                off: (_event: string, callback: () => void) => listeners.delete(callback)
            },
            change: (callback: (writer: { setAttribute(name: string, value: string, item: FakeHeadingItem): void }) => void) =>
                callback({ setAttribute: (name, value, item) => item.attrs.set(name, value) }),
            createRangeIn: () => ({ getWalker: () => items.map((item) => ({ type: "elementStart", item })) })
        },
        editing: {
            mapper: { toViewElement: (item: FakeHeadingItem) => item },
            view: { domConverter: { mapViewToDom: (viewElement: FakeHeadingItem) => viewElement.el } }
        }
    } as unknown as CKTextEditor;

    return {
        editor,
        /** Stands in for the note detail feeding the editor a note's content once its blob arrives. */
        async loadNote(noteId: string, headings: [ number, string ][]) {
            items = headings.map(([ level, text ]) => fakeHeadingItem(level, text));
            setEditorNoteId(editor, noteId);
            await act(async () => {
                for (const listener of [ ...listeners ]) listener();
                await new Promise((resolve) => requestAnimationFrame(resolve));
            });
        }
    };
}

interface FakeHeadingItem {
    name: string;
    el: HTMLElement;
    attrs: Map<string, string>;
    is(type: string, name?: string): boolean;
    getAttribute(key: string): string | undefined;
    getChildren(): never[];
}

function fakeHeadingItem(level: number, text: string): FakeHeadingItem {
    const el = document.createElement(`h${level}`);
    el.textContent = text;
    const attrs = new Map<string, string>();

    return {
        name: `heading${level}`,
        el,
        attrs,
        is: (type, name) => type === "element" && (!name || name === `heading${level}`),
        getAttribute: (key) => attrs.get(key),
        getChildren: () => []
    };
}
