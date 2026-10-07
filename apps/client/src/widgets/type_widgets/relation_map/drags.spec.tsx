import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import toast from "../../../services/toast";
import type RelationMapApi from "./api";
import { useBoxDragging, useRelationDrawing } from "./drags";
import type { RelationNameAnchor } from "./RelationNamePopover";
import { noteIdToId } from "./utils";

describe("relation map pointer drags", () => {
    let container: HTMLElement | undefined;
    const moveNote = vi.fn();
    const connect = vi.fn(async () => true);
    const askRelationName = vi.fn<(anchor: RelationNameAnchor) => Promise<string | null>>();
    let state: { dragged: unknown; pending: unknown } = { dragged: null, pending: null };
    let startDrag: ReturnType<typeof useBoxDragging>["startDrag"] | undefined;
    let startDrawing: ReturnType<typeof useRelationDrawing>["startDrawing"] | undefined;

    beforeEach(() => {
        for (const mock of [ moveNote, connect, askRelationName ]) mock.mockClear();
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(<Harness />, container as HTMLElement));
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        vi.restoreAllMocks();
    });

    function Harness() {
        const canvasRef = useRef<HTMLDivElement>(null);
        const mapApiRef = useRef({ moveNote, connect } as unknown as RelationMapApi);
        const dragging = useBoxDragging({ containerRef: canvasRef, mapApiRef, getScale });
        const drawing = useRelationDrawing({ containerRef: canvasRef, mapApiRef, getScale, askRelationName });
        state = { dragged: dragging.dragged, pending: drawing.pending };
        startDrag = dragging.startDrag;
        startDrawing = drawing.startDrawing;

        return (
            <div ref={canvasRef} className="canvas">
                <div id={noteIdToId("target")} className="note-box" />
            </div>
        );
    }

    /** The map is zoomed to 2x. */
    const getScale = () => 2;

    function pointer(type: string, clientX: number, clientY: number) {
        return new PointerEvent(type, { clientX, clientY, button: 0, isPrimary: true });
    }

    /** Releases the pointer, and waits for the name to be asked and the relation created. */
    async function release(clientX: number, clientY: number) {
        await act(async () => {
            window.dispatchEvent(pointer("pointerup", clientX, clientY));
            await new Promise((resolve) => setTimeout(resolve));
        });
    }

    function dispatch(type: string, clientX: number, clientY: number) {
        act(() => { window.dispatchEvent(pointer(type, clientX, clientY)); });
    }

    it("moves a box once the pointer leaves the click tolerance, and saves it on release", () => {
        act(() => startDrag?.(pointer("pointerdown", 100, 100), { noteId: "box", x: 10, y: 20 }));

        dispatch("pointermove", 102, 101);
        expect(state.dragged).toBeNull();

        dispatch("pointermove", 140, 160);
        expect(state.dragged).toEqual({ noteId: "box", x: 30, y: 50 });

        dispatch("pointerup", 140, 160);
        expect(moveNote).toHaveBeenCalledWith("box", 30, 50);
        expect(state.dragged).toBeNull();
    });

    it("puts a box back when the drag is canceled", () => {
        act(() => startDrag?.(pointer("pointerdown", 100, 100), { noteId: "box", x: 10, y: 20 }));
        dispatch("pointermove", 140, 160);
        dispatch("pointercancel", 140, 160);

        expect(moveNote).not.toHaveBeenCalled();
        expect(state.dragged).toBeNull();
    });

    it("draws a relation onto the box under the pointer and creates it with the name asked for", async () => {
        const target = container?.querySelector(".note-box") ?? null;
        vi.spyOn(document, "elementFromPoint").mockImplementation((x) => (x > 200 ? target : null));
        askRelationName.mockResolvedValue("author");

        act(() => startDrawing?.(pointer("pointerdown", 100, 100), "source"));
        dispatch("pointermove", 150, 100);
        expect(state.pending).toEqual({ sourceNoteId: "source", targetNoteId: undefined, pointer: { x: 75, y: 50 } });

        dispatch("pointermove", 250, 100);
        expect(state.pending).toMatchObject({ targetNoteId: "target" });

        await release(250, 100);
        expect(askRelationName).toHaveBeenCalledTimes(1);
        expect(connect).toHaveBeenCalledWith("author", "source", "target");
        expect(state.pending).toBeNull();
    });

    it("creates nothing on a click, off a box, when the name is dismissed or when the relation exists", async () => {
        const target = container?.querySelector(".note-box") ?? null;
        const elementFromPoint = vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});

        act(() => startDrawing?.(pointer("pointerdown", 100, 100), "source"));
        await release(250, 100);
        expect(askRelationName).not.toHaveBeenCalled();
        expect(state.pending).toBeNull();

        elementFromPoint.mockReturnValue(target);
        act(() => startDrawing?.(pointer("pointerdown", 100, 100), "source"));
        await release(101, 101);
        expect(askRelationName).not.toHaveBeenCalled();

        askRelationName.mockResolvedValue(null);
        act(() => startDrawing?.(pointer("pointerdown", 100, 100), "source"));
        await release(250, 100);
        expect(connect).not.toHaveBeenCalled();

        askRelationName.mockResolvedValue("author");
        connect.mockResolvedValueOnce(false);
        act(() => startDrawing?.(pointer("pointerdown", 100, 100), "source"));
        await release(250, 100);
        expect(showError).toHaveBeenCalledTimes(1);
    });
});
