import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

const announceClosing = vi.hoisted(() => vi.fn(async () => {}));
const drawPicture = vi.hoisted(() => vi.fn());
vi.mock("../../type_widgets/canvas/picture_schedule", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../type_widgets/canvas/picture_schedule")>(),
    drawPicture
}));
vi.mock("../../EmbeddedNotePane", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../EmbeddedNotePane")>(),
    announceEmbeddedNoteClosing: announceClosing
}));
// Excalidraw does not run under happy-dom.
interface Box { x: number; y: number; width: number; height: number }
vi.mock("@excalidraw/excalidraw", () => ({
    getCommonBounds: (elements: Box[]) => [
        Math.min(...elements.map(({ x }) => x)),
        Math.min(...elements.map(({ y }) => y)),
        Math.max(...elements.map(({ x, width }) => x + width)),
        Math.max(...elements.map(({ y, height }) => y + height))
    ]
}));
const editorProps = vi.hoisted(() => ({ initialData: undefined as unknown }));
vi.mock("../../type_widgets/canvas/Canvas", async () => {
    const { useNoteContext } = await import("../../react/hooks");
    return {
        CanvasEditor: ({ persistence }: { persistence: { initialData: unknown } }) => {
            editorProps.initialData = persistence.initialData;
            return <div className="mock-canvas">{useNoteContext().note?.noteId}</div>;
        }
    };
});
vi.mock("../../type_widgets/canvas/CanvasDrawingMenu", () => ({ CanvasNoteMenu: () => null }));
// A rectangle centered on (200, 100).
vi.mock("../../type_widgets/canvas/persistence", () => ({
    default: () => ({
        initialData: Promise.resolve({
            elements: [ { id: "r", type: "rectangle", x: 100, y: 50, width: 200, height: 100, isDeleted: false } ],
            appState: { gridModeEnabled: true }
        })
    })
}));

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import SlideCanvasEditor from "./slide_canvas_editor";

describe("SlideCanvasEditor", () => {
    it("edits the canvas through the slide's slot, keeps its keys, and saves what is left as it goes", async () => {
        // `tabManager` is only built when the app starts, and the editor's note context registers with it.
        (appContext as unknown as { tabManager: unknown }).tabManager = {
            getActiveContext: () => undefined,
            registerDetachedContext: () => undefined,
            unregisterDetachedContext: () => undefined
        };
        buildNote({ id: "root", title: "root", children: [ { id: "drawing", title: "Drawing", type: "canvas" } ] });
        const note = froca.notes["drawing"];
        const onFinish = vi.fn();
        const container = document.createElement("div");
        document.body.append(container);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
        const presentationKeys = vi.fn();
        container.addEventListener("keydown", presentationKeys);

        act(() => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <SlideCanvasEditor note={note} scale={0.5} onFinish={onFinish} />
                </ParentComponent.Provider>,
                container
            );
        });
        const editor = container.querySelector<HTMLElement>(".presentation-canvas-slide");
        expect(editor?.getAttribute("slot")).toBe("canvas-editor-drawing");
        await vi.waitFor(() => expect(editor?.querySelector(".mock-canvas")?.textContent).toBe("drawing"));

        // It opens on the drawing at the scale of the slides, centered in the editor as on the slide.
        await expect(editorProps.initialData).resolves.toMatchObject({
            appState: { gridModeEnabled: true, zoom: { value: 0.5 }, scrollX: 800, scrollY: 500 }
        });

        const canvas = editor?.querySelector(".mock-canvas");
        canvas?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(presentationKeys).not.toHaveBeenCalled();
        expect(onFinish).not.toHaveBeenCalled();

        // Excalidraw keeps an Escape that it uses, such as one that ends a selection.
        const handledEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        handledEscape.preventDefault();
        canvas?.dispatchEvent(handledEscape);
        expect(onFinish).not.toHaveBeenCalled();
        canvas?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        expect(onFinish).toHaveBeenCalledOnce();

        expect(announceClosing).not.toHaveBeenCalled();
        act(() => render(null, container));
        expect(announceClosing).toHaveBeenCalledOnce();
        // The slide shows the picture of the canvas, which is drawn at once rather than once the user idles.
        await vi.waitFor(() => expect(drawPicture).toHaveBeenCalledWith("drawing"));
        container.remove();
        (appContext as unknown as { tabManager: unknown }).tabManager = undefined;
    });
});

