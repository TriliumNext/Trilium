import { render } from "preact";
import { act } from "preact/test-utils";
import type { RevealApi } from "reveal.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applySlideMove, getSlideMove, type PresentationModel, type SlideMove } from "./model";
import SlideSidebar from "./sidebar";

vi.mock("../../../services/froca", () => ({
    default: { getNoteFromCache: (noteId: string) => ({ title: `Title of ${noteId}`, getIcon: () => "bx bx-columns" }) }
}));

const presentation: PresentationModel = {
    slides: [
        {
            noteId: "intro",
            type: "text",
            content: { __html: "<h1>Intro</h1>" },
            backgroundColor: "rgb(255, 0, 0)",
            verticalSlides: [
                { noteId: "first", type: "text", content: { __html: "<p>First</p>" } },
                { noteId: "second", type: "text", content: { __html: "<p>Second</p>" } }
            ]
        },
        { noteId: "web", type: "webView", content: { __html: "" }, webViewSrc: "https://example.com/", verticalSlides: undefined },
        { noteId: "board", type: "book", content: { __html: "" }, isCollection: true, verticalSlides: undefined }
    ]
};

describe("SlideSidebar", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it("lists the slides as thumbnails, with vertical slides nested under their slide", () => {
        const sidebar = renderSidebar();

        const topLevel = sidebar.querySelectorAll(":scope > li");
        expect(topLevel).toHaveLength(3);
        const vertical = topLevel[0].querySelectorAll(".presentation-sidebar-vertical-slides > li .slide-thumbnail");
        expect([ ...vertical ].map(thumbnail => thumbnail.getAttribute("data-note-id"))).toEqual([ "first", "second" ]);
        expect(topLevel[1].querySelector("ol")).toBeNull();
    });

    it("renders text slides in a shadow root that adopts the theme's stylesheets", () => {
        const sidebar = renderSidebar();

        const thumbnail = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=intro]");
        const root = thumbnail?.shadowRoot;
        expect(root?.querySelector(".reveal .slides section.present .slide-content")?.innerHTML).toBe("<h1>Intro</h1>");
        expect(root?.querySelector<HTMLElement>(".reveal-viewport")?.style.background).toContain("rgb(255, 0, 0)");
        // The two stylesheets passed in, plus the thumbnail's own.
        expect(root?.adoptedStyleSheets).toHaveLength(3);
        // Every thumbnail shares the same parsed sheets.
        const other = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=first]")?.shadowRoot;
        expect(other?.adoptedStyleSheets[0]).toBe(root?.adoptedStyleSheets[0]);
    });

    it("shows an icon instead of loading a web view or a collection again", () => {
        const sidebar = renderSidebar();

        const web = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=web]");
        expect(web?.shadowRoot).toBeNull();
        expect(web?.querySelector(".bx-globe")).not.toBeNull();
        expect(sidebar.querySelector(".slide-thumbnail[data-note-id=board] .bx-columns")).not.toBeNull();
    });

    it("shows the content of a slide whose editor just closed", () => {
        const sidebar = renderSidebar({ closingContents: { first: { __html: "<p>Edited</p>" } } });

        const root = sidebar.querySelector<HTMLElement>(".slide-thumbnail[data-note-id=first]")?.shadowRoot;
        expect(root?.querySelector(".slide-content")?.innerHTML).toBe("<p>Edited</p>");
    });

    it("marks the active slide and scrolls it into view as it changes", () => {
        const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
        const sidebar = renderSidebar({ activeNoteId: "intro" });
        const getActive = () => [ ...sidebar.querySelectorAll(".slide-thumbnail.active") ]
            .map(thumbnail => thumbnail.getAttribute("data-note-id"));

        expect(getActive()).toEqual([ "intro" ]);
        expect(getButton(sidebar, "intro").getAttribute("aria-current")).toBe("true");
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(sidebar.querySelector("[data-note-id=intro]"));

        const container = sidebar.parentElement ?? undefined;
        renderSidebar({ activeNoteId: "second", container });
        expect(getActive()).toEqual([ "second" ]);
        expect(getButton(sidebar, "intro").hasAttribute("aria-current")).toBe(false);
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(sidebar.querySelector("[data-note-id=second]"));

        renderSidebar({ activeNoteId: "board", container });
        expect(getActive()).toEqual([ "board" ]);
        scrollIntoView.mockRestore();
    });

    it("selects the slide of a clicked thumbnail, and lets the click focus it for the arrow keys", () => {
        const onSelectSlide = vi.fn();
        const sidebar = renderSidebar({ onSelectSlide });

        const button = getButton(sidebar, "second");
        expect(button.getAttribute("type")).toBe("button");
        expect(button.getAttribute("aria-label")).toBe("Title of second");
        button.click();
        getButton(sidebar, "web").click();
        expect(onSelectSlide.mock.calls).toEqual([ [ "second" ], [ "web" ] ]);

        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        button.dispatchEvent(mouseDown);
        expect(mouseDown.defaultPrevented).toBe(false);
    });

    it("takes one tab stop, on the active slide or else the first", () => {
        const sidebar = renderSidebar({ activeNoteId: "second" });
        const getTabStops = () => [ ...sidebar.querySelectorAll<HTMLButtonElement>(".slide-thumbnail-button") ]
            .filter(button => button.tabIndex === 0)
            .map(button => button.querySelector("[data-note-id]")?.getAttribute("data-note-id"));
        expect(getTabStops()).toEqual([ "second" ]);

        renderSidebar({ activeNoteId: undefined, container: sidebar.parentElement ?? undefined });
        expect(getTabStops()).toEqual([ "intro" ]);
    });

    it("moves through the slides in order with the arrow keys, Home and End, keeping them from Reveal.js", () => {
        const onSelectSlide = vi.fn();
        const sidebar = renderSidebar({ onSelectSlide });
        const documentKeys: string[] = [];
        const onDocumentKey = (e: KeyboardEvent) => documentKeys.push(e.key);
        document.addEventListener("keydown", onDocumentKey);
        const press = (noteId: string, key: string) => {
            const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
            getButton(sidebar, noteId).dispatchEvent(event);
            return event;
        };

        expect(press("intro", "ArrowDown").defaultPrevented).toBe(true);
        press("second", "ArrowDown");
        press("first", "ArrowUp");
        press("first", "End");
        press("web", "Home");
        press("board", "ArrowDown");
        press("intro", "ArrowUp");
        expect(onSelectSlide.mock.calls).toEqual([ [ "first" ], [ "web" ], [ "intro" ], [ "board" ], [ "intro" ] ]);

        // Other keys still reach Reveal.js.
        expect(press("intro", "ArrowRight").defaultPrevented).toBe(false);
        expect(documentKeys).toEqual([ "ArrowRight" ]);
        document.removeEventListener("keydown", onDocumentKey);
    });

    it("moves the focus with the active slide, but only while the focus is in the sidebar", () => {
        const sidebar = renderSidebar({ activeNoteId: "intro" });
        const container = sidebar.parentElement ?? undefined;

        renderSidebar({ activeNoteId: "first", container });
        expect(document.activeElement).not.toBe(getButton(sidebar, "first"));

        getButton(sidebar, "first").focus();
        renderSidebar({ activeNoteId: "web", container });
        expect(document.activeElement).toBe(getButton(sidebar, "web"));
    });
});

describe("moving slides with the keyboard", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    /**
     * Renders the sidebar whose moves follow `getSlideMove()` and render again with the moved model, as
     * the presentation does; returns the moves made.
     */
    function renderMovableSidebar() {
        const moves: SlideMove[] = [];
        const container = document.createElement("div");
        let model = presentation;
        const renderModel = () => renderSidebar({
            presentation: model,
            container,
            planSlideMove: (noteId, gap, levelShift) => (
                getSlideMove(model, "deck", noteId, gap, levelShift, () => false)
            ),
            onMoveSlide: (move) => {
                moves.push(move);
                model = applySlideMove(model, move);
                renderModel();
            }
        });
        return { sidebar: renderModel(), moves };
    }

    function press(sidebar: HTMLElement, noteId: string, key: string) {
        const button = getButton(sidebar, noteId);
        button.focus();
        const event = new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true });
        act(() => {
            button.dispatchEvent(event);
        });
        return event;
    }

    it("moves the focused slide up or down past the slides at its level", () => {
        const { sidebar, moves } = renderMovableSidebar();

        // A top-level slide goes past a whole stack of vertical slides.
        press(sidebar, "web", "ArrowUp");
        expect(moves.at(-1)).toEqual({ noteId: "web", targetNoteId: "intro", position: "before" });
        press(sidebar, "web", "ArrowDown");
        expect(moves.at(-1)).toEqual({ noteId: "web", targetNoteId: "board", position: "before" });
        expect(document.activeElement).toBe(getButton(sidebar, "web"));

        press(sidebar, "second", "ArrowUp");
        expect(moves.at(-1)).toEqual({ noteId: "second", targetNoteId: "first", position: "before" });
    });

    it("makes the focused slide vertical or top-level with Alt and the arrows to the side", () => {
        const { sidebar, moves } = renderMovableSidebar();

        press(sidebar, "web", "ArrowRight");
        expect(moves.at(-1)).toEqual({ noteId: "web", targetNoteId: "second", position: "after" });
        expect(document.activeElement).toBe(getButton(sidebar, "web"));

        press(sidebar, "web", "ArrowLeft");
        expect(moves.at(-1)).toEqual({ noteId: "web", targetNoteId: "board", position: "before" });
    });

    it("keeps Alt and the arrows from Reveal.js, even where the slide cannot go", () => {
        const { sidebar, moves } = renderMovableSidebar();
        const documentKeys: string[] = [];
        const onDocumentKey = (e: KeyboardEvent) => documentKeys.push(e.key);
        document.addEventListener("keydown", onDocumentKey);

        expect(press(sidebar, "intro", "ArrowUp").defaultPrevented).toBe(true);
        expect(press(sidebar, "intro", "ArrowRight").defaultPrevented).toBe(true);
        expect(moves).toEqual([]);
        expect(documentKeys).toEqual([]);
        document.removeEventListener("keydown", onDocumentKey);
    });

    it("leaves Alt and the arrows alone when the slides cannot be moved", () => {
        const sidebar = renderSidebar();
        expect(press(sidebar, "web", "ArrowUp").defaultPrevented).toBe(false);
    });
});

describe("dragging slides", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    it("drops a slide dragged straight at its level, marking where it goes", () => {
        const onMoveSlide = vi.fn();
        const sidebar = renderDraggableSidebar(onMoveSlide);
        const drag = startDrag(sidebar, "board");

        // The upper half of a thumbnail is the gap above it.
        expect(drag.over("web", 10)).toBe(true);
        expect(getDropMarks(sidebar)).toEqual([ "web drop-before" ]);
        expect(getItem(sidebar, "board").classList.contains("dragging")).toBe(true);

        // Over vertical slides, a top-level slide goes past the whole stack.
        expect(drag.over("second", 10)).toBe(true);
        expect(getDropMarks(sidebar)).toEqual([ "web drop-before" ]);

        drag.over("web", 10);
        drag.drop("web");
        expect(onMoveSlide).toHaveBeenCalledExactlyOnceWith({ noteId: "board", targetNoteId: "web", position: "before" });
        expect(getDropMarks(sidebar)).toEqual([]);
        expect(getItem(sidebar, "board").classList.contains("dragging")).toBe(false);

        // A vertical slide dragged below a slide without vertical slides becomes its first.
        const vertical = startDrag(sidebar, "first");
        expect(vertical.over("web", 90)).toBe(true);
        expect(getDropMarks(sidebar)).toEqual([ "web drop-into" ]);
    });

    it("changes the level of a slide dragged sideways", () => {
        const onMoveSlide = vi.fn();
        const sidebar = renderDraggableSidebar(onMoveSlide);

        // To the right, a top-level slide becomes a vertical slide.
        const topLevel = startDrag(sidebar, "board");
        expect(topLevel.over("web", 10, 30)).toBe(true);
        expect(getDropMarks(sidebar)).toEqual([ "second drop-after" ]);
        topLevel.drop("web");
        expect(onMoveSlide).toHaveBeenLastCalledWith({ noteId: "board", targetNoteId: "second", position: "after" });

        // To the left, a vertical slide becomes a top-level slide.
        const vertical = startDrag(sidebar, "first");
        expect(vertical.over("board", 90, -30)).toBe(true);
        expect(getDropMarks(sidebar)).toEqual([ "board drop-after" ]);
    });

    it("refuses a drop that changes nothing or that the slides cannot take", () => {
        const onMoveSlide = vi.fn();
        const sidebar = renderDraggableSidebar(onMoveSlide);

        const vertical = startDrag(sidebar, "second");
        expect(vertical.over("web", 10)).toBe(false);
        expect(getDropMarks(sidebar)).toEqual([]);
        vertical.drop("web");
        expect(onMoveSlide).not.toHaveBeenCalled();

        // Under a board, and a refused position clearing the mark of an allowed one.
        const topLevel = startDrag(sidebar, "web");
        topLevel.over("intro", 10);
        expect(getDropMarks(sidebar)).toEqual([ "intro drop-before" ]);
        expect(topLevel.over("board", 90, 30)).toBe(false);
        expect(getDropMarks(sidebar)).toEqual([]);
    });

    it("lets no thumbnail be dragged when the slides cannot be moved", () => {
        const sidebar = renderSidebar();
        expect(getButton(sidebar, "intro").getAttribute("draggable")).not.toBe("true");
        expect(getButton(renderDraggableSidebar(vi.fn()), "intro").getAttribute("draggable")).toBe("true");
    });
});

const THUMBNAIL_HEIGHT = 100;
const THUMBNAIL_PITCH = 110;
const DRAG_START_X = 50;

/** Renders the sidebar with its thumbnails stacked 100px tall, whose moves follow `getSlideMove()`. */
function renderDraggableSidebar(onMoveSlide: (move: SlideMove) => void) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, getThumbnailIndex(this) * THUMBNAIL_PITCH, 160, THUMBNAIL_HEIGHT);
    });
    return renderSidebar({
        planSlideMove: (noteId, gap, levelShift) => (
            getSlideMove(presentation, "deck", noteId, gap, levelShift, () => false)
        ),
        onMoveSlide
    });
}

function getThumbnailIndex(element: HTMLElement) {
    return [ ...document.querySelectorAll(".slide-thumbnail-button") ].indexOf(element);
}

function startDrag(sidebar: HTMLElement, noteId: string) {
    dispatchDrag(getButton(sidebar, noteId), "dragstart", DRAG_START_X, 0);
    return {
        /**
         * Drags over the thumbnail of `targetNoteId`, `y` pixels from its top and `dx` pixels to the side
         * of where the drag started; returns whether a drop is allowed there.
         */
        over: (targetNoteId: string, y: number, dx = 0) => {
            const button = getButton(sidebar, targetNoteId);
            const clientY = getThumbnailIndex(button) * THUMBNAIL_PITCH + y;
            return dispatchDrag(button, "dragover", DRAG_START_X + dx, clientY).defaultPrevented;
        },
        drop: (targetNoteId: string) => {
            dispatchDrag(getButton(sidebar, targetNoteId), "drop", 0, 0);
            dispatchDrag(getButton(sidebar, noteId), "dragend", 0, 0);
        }
    };
}

function dispatchDrag(target: HTMLElement, type: string, clientX: number, clientY: number) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { clientX, clientY, dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" } });
    act(() => {
        target.dispatchEvent(event);
    });
    return event;
}

function getItem(sidebar: HTMLElement, noteId: string) {
    const item = sidebar.querySelector<HTMLElement>(`li[data-slide-id=${noteId}]`);
    if (!item) throw new Error(`No list item for ${noteId}.`);
    return item;
}

function getDropMarks(sidebar: HTMLElement) {
    return [ ...sidebar.querySelectorAll<HTMLElement>("li.drop-before, li.drop-after, li.drop-into") ]
        .map(item => {
            const mark = [ "drop-before", "drop-after", "drop-into" ].find(name => item.classList.contains(name));
            return `${item.dataset.slideId} ${mark}`;
        });
}

function getButton(sidebar: HTMLElement, noteId: string) {
    const button = sidebar.querySelector(`[data-note-id=${noteId}]`)?.closest("button");
    if (!button) throw new Error(`The thumbnail of ${noteId} is not in a button.`);
    return button;
}

describe("useActiveSlideNoteId", () => {
    it("follows the slide that Reveal.js shows", async () => {
        const { useActiveSlideNoteId } = await import("./reveal");
        const listeners: (() => void)[] = [];
        let current = buildSection("intro");
        const api = {
            getCurrentSlide: () => current,
            on: (_event: string, listener: () => void) => listeners.push(listener),
            off: (_event: string, listener: () => void) => listeners.splice(listeners.indexOf(listener), 1)
        } as unknown as RevealApi;

        let activeNoteId: string | undefined;
        function Probe() {
            activeNoteId = useActiveSlideNoteId(api);
            return null;
        }
        const container = document.createElement("div");
        act(() => render(<Probe />, container));
        expect(activeNoteId).toBe("intro");

        current = buildSection("second");
        act(() => {
            for (const listener of listeners) listener();
        });
        expect(activeNoteId).toBe("second");

        act(() => render(null, container));
        expect(listeners).toHaveLength(0);
    });
});

function buildSection(noteId: string) {
    const section = document.createElement("section");
    section.dataset.noteId = noteId;
    return section;
}

const stylesheets = [ ":host { --r-main-color: black; }", ".reveal { color: var(--r-main-color); }" ];

interface RenderOptions {
    presentation?: PresentationModel;
    closingContents?: Record<string, { __html: string }>;
    activeNoteId?: string;
    onSelectSlide?: (noteId: string) => void;
    planSlideMove?: (noteId: string, gap: number, levelShift: -1 | 0 | 1) => SlideMove | undefined;
    onMoveSlide?: (move: SlideMove) => void;
    /** Renders again into the container of an earlier render. */
    container?: HTMLElement;
}

function renderSidebar({
    presentation: model = presentation, closingContents = {}, activeNoteId, onSelectSlide = () => {}, planSlideMove, onMoveSlide,
    container = document.createElement("div")
}: RenderOptions = {}) {
    if (!container.isConnected) document.body.appendChild(container);
    act(() => {
        render(
            <SlideSidebar
                presentation={model}
                stylesheets={stylesheets}
                closingContents={closingContents}
                activeNoteId={activeNoteId}
                onSelectSlide={onSelectSlide}
                planSlideMove={planSlideMove}
                onMoveSlide={onMoveSlide}
            />,
            container
        );
    });
    const sidebar = container.querySelector<HTMLElement>(".presentation-sidebar");
    if (!sidebar) throw new Error("The sidebar did not render.");
    return sidebar;
}
