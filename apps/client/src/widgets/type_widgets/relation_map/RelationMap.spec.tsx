import { type ComponentChildren, render } from "preact";
import { useRef, useState } from "preact/hooks";
import { forwardRef } from "preact/compat";
import { useImperativeHandle } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the zoom library, which needs real layout: it applies a transform at once and
// reports it, as the library does once an animation ends.
const { wrapperProps } = vi.hoisted(() => ({ wrapperProps: { current: null as Record<string, unknown> | null } }));
vi.mock("react-zoom-pan-pinch", () => ({
    TransformWrapper: forwardRef((props: { children?: ComponentChildren; onTransform?(ref: unknown, state: object): void }, ref) => {
        wrapperProps.current = props;
        useImperativeHandle(ref, () => {
            const api = {
                instance: { state: { positionX: 0, positionY: 0, scale: 1 } },
                setTransform(positionX: number, positionY: number, scale: number) {
                    api.instance.state = { positionX, positionY, scale };
                    props.onTransform?.(api, api.instance.state);
                },
                zoomIn: (step: number) => api.setTransform(0, 0, api.instance.state.scale + step),
                zoomOut: (step: number) => api.setTransform(0, 0, api.instance.state.scale - step)
            };
            return api;
        }, []);
        return <>{props.children}</>;
    }),
    TransformComponent: (props: { children?: ComponentChildren }) => <div>{props.children}</div>
}));

import Component from "../../../components/component";
import { ParentComponent } from "../../react/react_utils";
import type RelationMapApi from "./api";
import type { MapTransform } from "./api";
import { MapViewport, useCanvasClicks, useMapZoom, useRevealSelectedBox } from "./RelationMap";
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

    /**
     * Renders the wrapper, the viewport with one box, and a toolbar over the viewport. As in the map,
     * the boxes stand in a container without a size of its own, inside the zoom library's content, so
     * a click on empty canvas lands on the content.
     */
    function Harness({ placing }: { placing: boolean }) {
        const clickProps = useCanvasClicks({ placing, onPlace, onSelectNote, onClickEmpty, onOpenNote });
        return (
            <div className="wrapper" {...clickProps}>
                <div className="relation-map-viewport">
                    <div className="canvas">
                        <div className="relation-map-container">
                            <div id={noteIdToId("boxnote")} className="note-box">
                                <span className="title">Box</span>
                            </div>
                        </div>
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
        const { title, canvas, toolbar } = mount(true);

        const event = click(title);
        click(canvas);
        click(toolbar);

        expect(onPlace).toHaveBeenCalledTimes(2);
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
        useRevealSelectedBox({ wrapperRef, containerRef: canvasRef, moveBy, noteId });
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
        const [ dx, dy ] = moveBy.mock.calls[0];
        expect(dx).toBeLessThan(0);
        expect(dy).toBe(0);

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

describe("relation map zoom", () => {
    let container: HTMLElement | undefined;
    const setTransform = vi.fn();
    let boxes = [ { x: 0, y: 0, width: 1840, height: 100 } ];
    let zoom: ReturnType<typeof useMapZoom> | undefined;
    const component = new Component();

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        setTransform.mockClear();
    });

    function Harness({ loadedTransform }: { loadedTransform: MapTransform }) {
        const [ viewport, setViewport ] = useState<HTMLDivElement | null>(null);
        const mapApiRef = useRef({ setTransform } as unknown as RelationMapApi);
        zoom = useMapZoom({ ntxId: "map", viewport, loadedTransform, mapApiRef, getBoxes: () => boxes });
        return <MapViewport zoom={zoom} viewportRef={setViewport}><div className="note-box" /></MapViewport>;
    }

    function mount(loadedTransform: MapTransform) {
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(
            <ParentComponent.Provider value={component}><Harness loadedTransform={loadedTransform} /></ParentComponent.Provider>,
            container as HTMLElement));
    }

    const state = () => zoom?.ref.current?.instance.state;

    /** Gives the viewport a 1000 × 600 layout, which happy-dom does not compute. */
    function sizeViewport() {
        const viewport = container?.querySelector(".relation-map-viewport");
        if (!viewport) throw new Error("no viewport");
        Object.defineProperty(viewport, "clientWidth", { value: 1000 });
        Object.defineProperty(viewport, "clientHeight", { value: 600 });
    }
    const run = (action: "reset" | "fit" | "zoomIn" | "zoomOut") => act(() => { zoom?.[action](); });

    it("pans an unbounded canvas, and leaves boxes, labels and relations to be dragged and clicked", () => {
        mount({ x: 0, y: 0, scale: 1 });

        expect(wrapperProps.current).toMatchObject({
            limitToBounds: false,
            panning: { excluded: [ "note-box", "connection-label", "relation-map-connection-hit" ] }
        });
    });

    it("restores the saved view, saves every change and goes back to the origin on reset", () => {
        mount({ x: -800, y: 600, scale: 1.5 });
        expect(state()).toEqual({ positionX: -800, positionY: 600, scale: 1.5 });
        expect(zoom?.scale).toBe(1.5);

        run("reset");
        expect(state()).toEqual({ positionX: 0, positionY: 0, scale: 1 });
        expect(setTransform).toHaveBeenLastCalledWith({ x: 0, y: 0, scale: 1 });
    });

    it("fits all the boxes into the view, and does nothing on an empty map", () => {
        mount({ x: -800, y: 600, scale: 2 });
        sizeViewport();

        run("fit");
        expect(state()).toEqual({ positionX: 40, positionY: 251, scale: 0.5 });

        boxes = [];
        run("fit");
        expect(state()).toEqual({ positionX: 40, positionY: 251, scale: 0.5 });
    });

    it("takes the focus when its own note context asks for it, and when told to", () => {
        mount({ x: 0, y: 0, scale: 1 });
        const viewport = container?.querySelector(".relation-map-viewport");
        const blur = () => act(() => { (document.activeElement as HTMLElement | null)?.blur(); });

        act(() => { component.handleEvent("focusOnDetail", { ntxId: "other" }); });
        expect(document.activeElement).not.toBe(viewport);

        act(() => { component.handleEvent("focusOnDetail", { ntxId: "map" }); });
        expect(document.activeElement).toBe(viewport);

        blur();
        act(() => zoom?.focus());
        expect(document.activeElement).toBe(viewport);
    });

    it("steps the zoom", () => {
        mount({ x: 0, y: 0, scale: 1 });

        run("zoomIn");
        expect(state()?.scale).toBeCloseTo(1.2);

        run("zoomOut");
        expect(state()?.scale).toBeCloseTo(1);
    });
});
