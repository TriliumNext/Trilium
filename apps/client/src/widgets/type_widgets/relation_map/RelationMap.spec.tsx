import { type ComponentChildren, render } from "preact";
import { useRef, useState } from "preact/hooks";
import { forwardRef } from "preact/compat";
import { useImperativeHandle } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the zoom library, which needs real layout: it applies a transform at once and
// reports it, as the library does once an animation ends.
const { wrapperProps, pasteNotes, createNote } = vi.hoisted(() => ({
    wrapperProps: { current: null as Record<string, unknown> | null },
    pasteNotes: vi.fn<(note: unknown, data?: DataTransfer | null) => Promise<string[]>>(),
    createNote: vi.fn<(parentNotePath: string, options: object) => Promise<{ note: { noteId: string } | null }>>()
}));
vi.mock("../../../services/note_paste", () => ({ pasteNotes }));
vi.mock("../../../services/note_create", () => ({ default: { createNote } }));
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
import type FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import type RelationMapApi from "./api";
import type { MapTransform } from "./api";
import { MapViewport, useCanvasClicks, useMapPaste, useMapZoom, useNotePlacement, useRevealSelectedBox } from "./RelationMap";
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

describe("relation map paste", () => {
    let container: HTMLElement | undefined;
    let mapNote: FNote;
    const addMultipleNotes = vi.fn();
    let pasteAt: ReturnType<typeof useMapPaste>["pasteAt"] | undefined;
    let mapApiRef: { current: RelationMapApi | null } = { current: null };

    beforeEach(() => {
        addMultipleNotes.mockClear();
        pasteNotes.mockReset().mockResolvedValue([ "first", "second" ]);
        mapNote = buildNote({ id: "map", title: "Map" });
        buildNote({ id: "first", title: "First" });
        buildNote({ id: "second", title: "Second" });
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** The map at 2x, with an editor over it as the note pane has. */
    function Harness({ isReadOnly }: { isReadOnly: boolean }) {
        const [ viewport, setViewport ] = useState<HTMLDivElement | null>(null);
        const containerRef = useRef<HTMLDivElement>(null);
        const apiRef = useRef({ addMultipleNotes } as unknown as RelationMapApi);
        mapApiRef = apiRef;
        const paste = useMapPaste({ note: mapNote, isReadOnly, viewport, containerRef, mapApiRef: apiRef, getScale: () => 2 });
        pasteAt = paste.pasteAt;
        return (
            <div className="wrapper" onMouseMove={paste.followPointer} onMouseLeave={paste.forgetPointer}>
                <div ref={setViewport} className="relation-map-viewport" tabIndex={0}>
                    <div ref={containerRef} className="relation-map-container" />
                </div>
                <div className="editor" contentEditable />
            </div>
        );
    }

    function mount(isReadOnly = false) {
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(<Harness isReadOnly={isReadOnly} />, container as HTMLElement));
        const find = (selector: string) => {
            const element = container?.querySelector<HTMLElement>(selector);
            if (!element) throw new Error(`${selector} was not rendered`);
            return element;
        };
        const viewport = find(".relation-map-viewport");
        viewport.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 200 });
        return { wrapper: find(".wrapper"), viewport, editor: find(".editor") };
    }

    /**
     * Focuses `focused` and pastes. As in Chromium, the event goes to the editable holding the
     * selection, and otherwise to the body, whatever has the focus.
     */
    async function paste(focused: HTMLElement, clipboardData: object | null = null) {
        focused.focus();
        const target = focused.isContentEditable ? focused : document.body;
        const event = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: clipboardData });
        await act(async () => {
            target.dispatchEvent(event);
            await new Promise((resolve) => setTimeout(resolve));
        });
        return event;
    }

    const placed = (x: number, y: number) => [ [
        { noteId: "first", title: "First", x, y },
        { noteId: "second", title: "Second", x: x + 200, y }
    ] ];

    it("pastes onto the map under the pointer, or in the middle once the pointer leaves", async () => {
        const { wrapper, viewport } = mount();
        const data = { getData: () => "" };

        act(() => { viewport.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 300, clientY: 100 })); });
        const event = await paste(viewport, data);
        expect(event.defaultPrevented).toBe(true);
        expect(pasteNotes).toHaveBeenCalledWith(mapNote, data);
        expect(addMultipleNotes.mock.calls.at(-1)).toEqual(placed(70, 35));

        act(() => { wrapper.dispatchEvent(new MouseEvent("mouseleave")); });
        await paste(viewport);
        expect(addMultipleNotes.mock.calls.at(-1)).toEqual(placed(20, 35));

        await act(async () => {
            pasteAt?.({ clientX: 200, clientY: 200 });
            await new Promise((resolve) => setTimeout(resolve));
        });
        expect(addMultipleNotes.mock.calls.at(-1)).toEqual(placed(20, 85));
    });

    it("drops a paste whose map was replaced by another while the clipboard was read", async () => {
        const { viewport } = mount();
        const otherMap = vi.fn();
        let finish: (noteIds: string[]) => void = () => {};
        pasteNotes.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));

        const pasted = paste(viewport);
        mapApiRef.current = { addMultipleNotes: otherMap } as unknown as RelationMapApi;
        finish([ "first" ]);
        await pasted;

        expect([ addMultipleNotes, otherMap ].map((mock) => mock.mock.calls.length)).toEqual([ 0, 0 ]);
    });

    it("leaves a paste into the note pane to it, and pastes nothing onto a read-only map or from an empty clipboard", async () => {
        const { editor } = mount();
        const event = await paste(editor);
        expect(event.defaultPrevented).toBe(false);
        expect(pasteNotes).not.toHaveBeenCalled();

        pasteNotes.mockResolvedValue([]);
        await paste(container?.querySelector<HTMLElement>(".relation-map-viewport") ?? editor);
        expect(pasteNotes).toHaveBeenCalledTimes(1);
        expect(addMultipleNotes).not.toHaveBeenCalled();

        act(() => render(null, container as HTMLElement));
        container?.remove();
        const { viewport } = mount(true);
        await paste(viewport);
        expect(pasteNotes).toHaveBeenCalledTimes(1);
    });
});

describe("relation map placement", () => {
    let container: HTMLElement | undefined;
    let placement: ReturnType<typeof useNotePlacement> | undefined;
    let mapApiRef: { current: RelationMapApi | null } = { current: null };
    const createItem = vi.fn();
    const onCreated = vi.fn();

    beforeEach(() => {
        for (const mock of [ createItem, onCreated, createNote ]) mock.mockReset();
        container = document.createElement("div");
        document.body.appendChild(container);
        const note = buildNote({ id: "map", title: "Map" });

        function Harness() {
            const containerRef = useRef<HTMLDivElement>(null);
            const apiRef = useRef({ createItem } as unknown as RelationMapApi);
            mapApiRef = apiRef;
            placement = useNotePlacement({
                ntxId: "map", note, containerRef, getScale: () => 1, mapApiRef: apiRef, onArm: () => {}, onCreated
            });
            return <div ref={containerRef} />;
        }
        act(() => render(<Harness />, container as HTMLElement));
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** Places a note, with the map replaced by another while the note is created when `switchMap`. */
    async function place(switchMap: boolean) {
        let finish: (result: { note: { noteId: string } }) => void = () => {};
        createNote.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        await act(async () => {
            const placed = placement?.placeAt(new MouseEvent("click", { clientX: 200, clientY: 100 }));
            if (switchMap) mapApiRef.current = { createItem: vi.fn() } as unknown as RelationMapApi;
            finish({ note: { noteId: "created" } });
            await placed;
        });
    }

    it("puts the created note on the map, unless the map was replaced by another meanwhile", async () => {
        await place(false);
        expect(createItem).toHaveBeenCalledWith({ noteId: "created", x: 120, y: 85 });
        expect(onCreated).toHaveBeenCalledWith("created");

        await place(true);
        expect(createItem).toHaveBeenCalledTimes(1);
        expect(onCreated).toHaveBeenCalledTimes(1);
    });
});
