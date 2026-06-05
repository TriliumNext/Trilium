import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../components/component";
import type NoteContext from "../components/note_context";
import froca from "../services/froca";
import { buildNote } from "../test/easy-froca";
import ScrollPadding from "./scroll_padding";
import { NoteContextContext, ParentComponent } from "./react/react_utils";

// --- ResizeObserver capture -----------------------------------------------------------------------
// happy-dom's ResizeObserver is inert; replace it so we can fire the callback and exercise refreshHeight.

interface CapturedObserver {
    cb: () => void;
    observed: Element[];
    disconnected: boolean;
}

let observers: CapturedObserver[] = [];
let originalResizeObserver: typeof ResizeObserver | undefined;

class FakeResizeObserver {
    entry: CapturedObserver;
    constructor(cb: () => void) {
        this.entry = { cb, observed: [], disconnected: false };
        observers.push(this.entry);
    }
    observe(el: Element) { this.entry.observed.push(el); }
    unobserve() {}
    disconnect() { this.entry.disconnected = true; }
}

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

/** Renders ScrollPadding inside a `.scrolling-container` wrapped in the Trilium providers. */
function renderScrollPadding(noteContext: NoteContext | null, parent: Component, withContainer = true) {
    const host = document.createElement("div");
    container = host;
    if (withContainer) {
        host.className = "scrolling-container";
        Object.defineProperty(host, "offsetHeight", { configurable: true, value: 400 });
    }
    document.body.appendChild(host);
    act(() => {
        render((
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={noteContext}>
                    <ScrollPadding />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), host);
    });
    return host;
}

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root/note1",
        viewScope: { viewMode: "default" },
        ...overrides
    } as unknown as NoteContext;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    observers = [];
    originalResizeObserver = window.ResizeObserver;
    Object.assign(window, { ResizeObserver: FakeResizeObserver });
});

afterEach(() => {
    const host = container;
    if (host) {
        act(() => render(null, host));
        host.remove();
        container = undefined;
    }
    if (originalResizeObserver) {
        Object.assign(window, { ResizeObserver: originalResizeObserver });
    }
    vi.restoreAllMocks();
});

describe("ScrollPadding", () => {
    it("renders the active padding widget for a text note in default view and sets up the observer", () => {
        const note = buildNote({ id: "txt", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note });
        const root = renderScrollPadding(ctx, new Component());

        const widget = root.querySelector(".scroll-padding-widget");
        expect(widget).toBeTruthy();
        // Initial height is computed from the container (400 / 2 = 200) on the effect's initial refresh.
        expect((widget as HTMLElement).style.height).toBe("200px");

        // The ResizeObserver was created and observing the scrolling container.
        expect(observers.length).toBe(1);
        expect(observers[0]?.observed).toContain(root);
    });

    it("recomputes height when the observer fires after the container resizes", () => {
        const note = buildNote({ id: "txt2", title: "T", type: "text" });
        const root = renderScrollPadding(fakeNoteContext({ note }), new Component());
        const widget = root.querySelector(".scroll-padding-widget");
        expect((widget as HTMLElement).style.height).toBe("200px");

        Object.defineProperty(root, "offsetHeight", { configurable: true, value: 600 });
        act(() => observers.forEach(o => o.cb()));
        expect((widget as HTMLElement).style.height).toBe("300px");
    });

    it("triggers scrollToEnd with the ntxId when the widget is clicked", () => {
        const note = buildNote({ id: "txt3", title: "T", type: "text" });
        const parent = new Component();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined);
        const root = renderScrollPadding(fakeNoteContext({ note, ntxId: "ntxClick" }), parent);

        const widget = root.querySelector(".scroll-padding-widget") as HTMLElement;
        widget.click();
        expect(triggerCommand).toHaveBeenCalledWith("scrollToEnd", { ntxId: "ntxClick" });
    });

    it("is enabled for code notes too", () => {
        const note = buildNote({ id: "code1", title: "C", type: "code" });
        const root = renderScrollPadding(fakeNoteContext({ note }), new Component());
        expect(root.querySelector(".scroll-padding-widget")).toBeTruthy();
    });

    it("renders the inert placeholder for unsupported note types", () => {
        const note = buildNote({ id: "img1", title: "I", type: "image" });
        const root = renderScrollPadding(fakeNoteContext({ note }), new Component());
        expect(root.querySelector(".scroll-padding-widget")).toBeNull();
        expect(root.querySelector("div")).toBeTruthy();
        // Disabled → effect returns early, so no observer is created.
        expect(observers.length).toBe(0);
    });

    it("is disabled when the view mode is not default", () => {
        const note = buildNote({ id: "txtSrc", title: "T", type: "text" });
        const root = renderScrollPadding(fakeNoteContext({ note, viewScope: { viewMode: "source" } }), new Component());
        expect(root.querySelector(".scroll-padding-widget")).toBeNull();
        expect(observers.length).toBe(0);
    });

    it("is disabled for Trilium SQLite notes (mime guard)", () => {
        const note = buildNote({ id: "sqlite1", title: "S", type: "code" });
        Object.assign(note, { mime: "text/x-sqlite;schema=trilium" });
        const root = renderScrollPadding(fakeNoteContext({ note }), new Component());
        expect(root.querySelector(".scroll-padding-widget")).toBeNull();
    });

    it("is disabled for Markdown code notes (mime guard)", () => {
        const note = buildNote({ id: "md1", title: "M", type: "code" });
        Object.assign(note, { mime: "text/markdown" });
        const root = renderScrollPadding(fakeNoteContext({ note }), new Component());
        expect(root.querySelector(".scroll-padding-widget")).toBeNull();
    });

    it("is disabled when content is unavailable (protected note without session)", () => {
        const note = buildNote({ id: "prot1", title: "P", type: "text" });
        Object.assign(note, { isProtected: true });
        vi.spyOn(note, "isContentAvailable").mockReturnValue(false);
        const root = renderScrollPadding(fakeNoteContext({ note }), new Component());
        expect(root.querySelector(".scroll-padding-widget")).toBeNull();
    });

    it("renders the placeholder when there is no note context at all", () => {
        const root = renderScrollPadding(null, new Component());
        expect(root.querySelector(".scroll-padding-widget")).toBeNull();
        expect(observers.length).toBe(0);
    });

    it("does not create an observer when the scrolling container ancestor is missing", () => {
        const note = buildNote({ id: "noContainer", title: "T", type: "text" });
        // withContainer=false → the widget has no `.scrolling-container` ancestor.
        const root = renderScrollPadding(fakeNoteContext({ note }), new Component(), false);
        const widget = root.querySelector(".scroll-padding-widget");
        // Still enabled and rendered, but the effect's container lookup fails so no observer is set up.
        expect(widget).toBeTruthy();
        expect(observers.length).toBe(0);
        // Height stays at its default of 10 since refreshHeight never ran with a container.
        expect((widget as HTMLElement).style.height).toBe("10px");
    });

    it("disconnects the observer on unmount", () => {
        const note = buildNote({ id: "unmount1", title: "T", type: "text" });
        const root = renderScrollPadding(fakeNoteContext({ note }), new Component());
        expect(observers.length).toBe(1);
        act(() => render(null, root));
        expect(observers[0]?.disconnected).toBe(true);
    });
});
