import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { type RefObject, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useCanvasNoteDrop from "./useCanvasNoteDrop";

const restoreElements = vi.fn((elements: unknown[]) => elements.map((el, i) => ({ ...(el as object), id: `el${i}` })));
const viewportCoordsToSceneCoords = vi.fn(() => ({ x: 100, y: 200 }));

vi.mock("@excalidraw/excalidraw", () => ({
    restoreElements: (...args: unknown[]) => restoreElements(...(args as [unknown[]])),
    viewportCoordsToSceneCoords: () => viewportCoordsToSceneCoords(),
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER", EVENTUALLY: "EVENTUALLY" }
}));

type Handlers = ReturnType<typeof useCanvasNoteDrop>;

let handlers: Handlers | undefined;

function Probe({ apiRef, isReadOnly }: { apiRef: RefObject<ExcalidrawImperativeAPI>; isReadOnly: boolean }) {
    handlers = useCanvasNoteDrop(apiRef, isReadOnly);
    return null;
}

describe("useCanvasNoteDrop", () => {
    let container: HTMLElement;
    let sceneElements: unknown[];
    let api: ExcalidrawImperativeAPI;
    let updateScene: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        restoreElements.mockClear();
        viewportCoordsToSceneCoords.mockClear();
        sceneElements = [{ id: "existing" }];
        updateScene = vi.fn();
        api = {
            getAppState: vi.fn(() => ({})),
            getSceneElements: vi.fn(() => sceneElements),
            updateScene
        } as unknown as ExcalidrawImperativeAPI;
        handlers = undefined;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mountHook(isReadOnly: boolean, apiRef?: RefObject<ExcalidrawImperativeAPI>) {
        const ref = apiRef ?? ({ current: api } as RefObject<ExcalidrawImperativeAPI>);
        await act(async () => {
            render(<Probe apiRef={ref} isReadOnly={isReadOnly} />, container);
        });
    }

    function dragEvent(overrides: Partial<{ types: string[]; payload: string | undefined }> = {}) {
        const { types = ["text/plain"], payload } = overrides;
        return {
            clientX: 10,
            clientY: 20,
            dataTransfer: {
                types,
                getData: vi.fn(() => payload)
            },
            preventDefault: vi.fn(),
            stopPropagation: vi.fn()
        };
    }

    describe("onDragOverCapture", () => {
        it("accepts the drop (preventDefault + stopPropagation) when a text/plain drag is editable", async () => {
            await mountHook(false);
            const e = dragEvent();
            handlers?.onDragOverCapture(e as never);
            expect(e.preventDefault).toHaveBeenCalled();
            expect(e.stopPropagation).toHaveBeenCalled();
        });

        it("ignores the drag when read-only", async () => {
            await mountHook(true);
            const e = dragEvent();
            handlers?.onDragOverCapture(e as never);
            expect(e.preventDefault).not.toHaveBeenCalled();
        });

        it("ignores a drag that does not carry text/plain", async () => {
            await mountHook(false);
            const e = dragEvent({ types: ["Files"] });
            handlers?.onDragOverCapture(e as never);
            expect(e.preventDefault).not.toHaveBeenCalled();
        });
    });

    describe("onDropCapture", () => {
        it("inserts an embeddable per dropped note, stacked, appended to the existing scene", async () => {
            await mountHook(false);
            const e = dragEvent({ payload: JSON.stringify([{ noteId: "aaa" }, { noteId: "bbb" }]) });
            handlers?.onDropCapture(e as never);

            expect(e.preventDefault).toHaveBeenCalled();
            expect(e.stopPropagation).toHaveBeenCalled();
            expect(viewportCoordsToSceneCoords).toHaveBeenCalled();

            const partials = restoreElements.mock.calls[0][0] as Array<Record<string, unknown>>;
            expect(partials).toHaveLength(2);
            expect(partials[0]).toMatchObject({ type: "embeddable", x: 100, y: 200, link: "root/aaa" });
            // The second note is offset by STACK_OFFSET (24) from the first on both axes.
            expect(partials[1]).toMatchObject({ x: 124, y: 224, link: "root/bbb" });

            const { elements, captureUpdate } = updateScene.mock.calls[0][0];
            expect(elements).toHaveLength(3); // 1 existing + 2 new
            expect(elements[0]).toEqual({ id: "existing" });
            // The drop must be its own undo step (#7148).
            expect(captureUpdate).toBe("IMMEDIATELY");
        });

        it("does nothing when read-only", async () => {
            await mountHook(true);
            const e = dragEvent({ payload: JSON.stringify([{ noteId: "aaa" }]) });
            handlers?.onDropCapture(e as never);
            expect(e.preventDefault).not.toHaveBeenCalled();
            expect(updateScene).not.toHaveBeenCalled();
        });

        it("does nothing when the Excalidraw API is not ready", async () => {
            await mountHook(false, { current: null } as RefObject<ExcalidrawImperativeAPI>);
            const e = dragEvent({ payload: JSON.stringify([{ noteId: "aaa" }]) });
            handlers?.onDropCapture(e as never);
            expect(e.preventDefault).not.toHaveBeenCalled();
        });

        it("ignores a drop whose payload contains no usable note IDs", async () => {
            await mountHook(false);
            const e = dragEvent({ payload: JSON.stringify([{ notANoteId: true }]) });
            handlers?.onDropCapture(e as never);
            expect(e.preventDefault).not.toHaveBeenCalled();
            expect(updateScene).not.toHaveBeenCalled();
        });
    });

    describe("dropped-payload parsing", () => {
        // Drives parseDroppedNoteIds through onDropCapture: a payload is "usable" only if it parses
        // to an array whose entries carry a string noteId. updateScene firing is the proxy for that.
        const cases: Array<{ name: string; payload: string | undefined; usable: boolean }> = [
            { name: "missing payload", payload: undefined, usable: false },
            { name: "non-array JSON", payload: JSON.stringify({ noteId: "aaa" }), usable: false },
            { name: "entries without a string noteId", payload: JSON.stringify([{ noteId: 5 }, null]), usable: false },
            { name: "invalid JSON", payload: "{not json", usable: false },
            { name: "valid note entries", payload: JSON.stringify([{ noteId: "aaa" }]), usable: true }
        ];

        for (const { name, payload, usable } of cases) {
            it(`${usable ? "accepts" : "rejects"} ${name}`, async () => {
                await mountHook(false);
                const e = dragEvent({ payload });
                handlers?.onDropCapture(e as never);
                expect(updateScene.mock.calls.length).toBe(usable ? 1 : 0);
            });
        }
    });
});
