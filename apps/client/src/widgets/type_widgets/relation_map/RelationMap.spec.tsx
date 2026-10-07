import type { PanZoom } from "panzoom";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCanvasClicks, useRevealSelectedBox } from "./RelationMap";
import { noteIdToId } from "./utils";

describe("relation map canvas clicks", () => {
    let container: HTMLElement | undefined;
    const onPlace = vi.fn();
    const onSelectNote = vi.fn();
    const onClickEmpty = vi.fn();
    const onOpenNote = vi.fn();

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        for (const fn of [ onPlace, onSelectNote, onClickEmpty, onOpenNote ]) fn.mockClear();
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** Renders the wrapper, the panned canvas with one box, and a toolbar over the canvas. */
    function Harness({ placing }: { placing: boolean }) {
        const containerRef = useRef<HTMLDivElement>(null);
        const clickProps = useCanvasClicks({ containerRef, placing, onPlace, onSelectNote, onClickEmpty, onOpenNote });
        return (
            <div className="wrapper" {...clickProps}>
                <div ref={containerRef} className="canvas">
                    <div id={noteIdToId("boxnote")} className="note-box">
                        <span className="title">Box</span>
                    </div>
                </div>
                <button className="toolbar" type="button" />
            </div>
        );
    }

    function mount(placing = false) {
        act(() => render(<Harness placing={placing} />, container as HTMLElement));
        const find = (selector: string) => {
            const element = container?.querySelector<HTMLElement>(selector);
            if (!element) throw new Error(`${selector} was not rendered`);
            return element;
        };
        return { wrapper: find(".wrapper"), canvas: find(".canvas"), title: find(".title"), toolbar: find(".toolbar") };
    }

    /** A press and release at the same spot, or `moved` pixels apart. */
    function click(target: HTMLElement, { moved = 0, type = "click", ...init }: MouseEventInit & { moved?: number; type?: string } = {}) {
        target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10 + moved, clientY: 10, ...init });
        act(() => { target.dispatchEvent(event); });
        return event;
    }

    /** Clicks that reach the document, where the app's own click handlers listen. */
    const reachedDocument = vi.fn();
    beforeEach(() => {
        reachedDocument.mockClear();
        document.addEventListener("click", reachedDocument);
    });
    afterEach(() => document.removeEventListener("click", reachedDocument));

    it("selects the box clicked, and keeps the click to the map", () => {
        const { title } = mount();

        const event = click(title);

        expect(onSelectNote).toHaveBeenCalledWith("boxnote");
        expect(event.defaultPrevented).toBe(true);
        expect(reachedDocument).not.toHaveBeenCalled();
    });

    it("opens the note on a modified or middle click, and leaves a pan or drag to the map", () => {
        const { title, canvas } = mount();

        const ctrlClick = click(title, { ctrlKey: true });
        const middleClick = click(title, { type: "auxclick", button: 1 });
        expect(onOpenNote.mock.calls).toEqual([ [ "boxnote", ctrlClick ], [ "boxnote", middleClick ] ]);
        expect(reachedDocument).not.toHaveBeenCalled();

        click(title, { moved: 20 });
        click(title, { moved: 20, ctrlKey: true });
        click(canvas, { moved: 20 });

        expect(onSelectNote).not.toHaveBeenCalled();
        expect(onClickEmpty).not.toHaveBeenCalled();
        expect(onOpenNote).toHaveBeenCalledTimes(2);
    });

    it("closes the pane on empty canvas, but not on what stands over the map", () => {
        const { wrapper, canvas, toolbar } = mount();

        click(canvas);
        click(wrapper);
        expect(onClickEmpty).toHaveBeenCalledTimes(2);

        click(toolbar);
        expect(onClickEmpty).toHaveBeenCalledTimes(2);
    });

    it("places a note wherever an armed map is clicked, a box included", () => {
        const { title, toolbar } = mount(true);

        const event = click(title);
        click(toolbar);

        expect(onPlace).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
        expect(onSelectNote).not.toHaveBeenCalled();
    });
});

describe("relation map revealing the selected box", () => {
    let container: HTMLElement | undefined;
    const moveBy = vi.fn();

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        moveBy.mockClear();
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    function Harness({ noteId }: { noteId: string | undefined }) {
        const wrapperRef = useRef<HTMLDivElement>(null);
        const canvasRef = useRef<HTMLDivElement>(null);
        useRevealSelectedBox({ wrapperRef, containerRef: canvasRef, panZoom: { moveBy } as unknown as PanZoom, noteId });
        return (
            <div ref={wrapperRef} className="wrapper">
                <div ref={canvasRef} className="canvas" />
            </div>
        );
    }

    /** Gives the map a 1200 × 800 layout, which happy-dom does not compute. */
    function mount(noteId: string | undefined) {
        act(() => render(<Harness noteId={noteId} />, container as HTMLElement));
        const wrapper = container?.querySelector<HTMLElement>(".wrapper");
        if (wrapper) placeAt(wrapper, { left: 0, top: 0, right: 1200, bottom: 800 });
    }

    /** Adds a box to the canvas at the given page position, as `NoteBox` would render it. */
    function addBox(noteId: string, left: number) {
        const box = document.createElement("div");
        box.id = noteIdToId(noteId);
        placeAt(box, { left, top: 100, right: left + 160, bottom: 150 });
        act(() => { container?.querySelector(".canvas")?.appendChild(box); });
    }

    function placeAt(element: HTMLElement, rect: { left: number; top: number; right: number; bottom: number }) {
        element.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => rect });
    }

    it("pans a box out from under the pane, and leaves one alone that stands clear", () => {
        addBoxBeforeMount("under", 1000);
        expect(moveBy).toHaveBeenCalledTimes(1);
        const [ dx, dy, smooth ] = moveBy.mock.calls[0];
        expect(dx).toBeLessThan(0);
        expect([ dy, smooth ]).toEqual([ 0, true ]);

        moveBy.mockClear();
        addBoxBeforeMount("clear", 100);
        expect(moveBy).not.toHaveBeenCalled();
    });

    it("waits for the box of a note placed a moment ago", async () => {
        mount("placed");
        expect(moveBy).not.toHaveBeenCalled();

        addBox("placed", 1000);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
        expect(moveBy).toHaveBeenCalledTimes(1);
    });

    /** Adds the box before selecting its note, as when the user clicks an existing box. */
    function addBoxBeforeMount(noteId: string, left: number) {
        if (container) render(null, container);
        mount(undefined);
        addBox(noteId, left);
        mount(noteId);
    }
});
