/**
 * Regression tests for https://github.com/TriliumNext/Trilium/issues/10279
 * ("Canvas view empty (history view works)").
 *
 * Excalidraw's async mount initialization resets the scene when it completes, and it hands
 * out its imperative API *before* that reset lands. Content loaded via `updateScene` in that
 * window is wiped — and the wipe then looks like a user edit (scene version change) and gets
 * saved over the note, corrupting it. The first content must therefore be routed through the
 * `initialData` promise (applied *by* the init reset), and `onChange` must never treat the
 * still-empty initializing scene as a change worth saving. Only subsequent loads (note
 * switches on an already-initialized instance) may use `updateScene`.
 */
import { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { type RefObject, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor } from "../../../services/content_renderer";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import useCanvasPersistence, { useCanvasDrawingPersistence } from "./persistence";

interface FakeElement {
    id: string;
    type: string;
    version: number;
}

vi.mock("@excalidraw/excalidraw", () => ({
    // Mirrors the real behavior closely enough for change tracking: the version of a scene
    // is derived from its elements, and an empty scene is always version 0.
    getSceneVersion: (elements: FakeElement[]) => elements.reduce((sum, el) => sum + (el.version ?? 0), 0),
    exportToSvg: vi.fn(async () => ({ outerHTML: "<svg/>" })),
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER", EVENTUALLY: "EVENTUALLY" }
}));

vi.stubGlobal("logError", vi.fn());
vi.stubGlobal("logInfo", vi.fn());

type PersistenceProps = ReturnType<typeof useCanvasPersistence>;

let props: PersistenceProps | undefined;

function Probe({ note, apiRef }: { note: FNote; apiRef: RefObject<ExcalidrawImperativeAPI> }) {
    props = useCanvasPersistence(note, null, apiRef, "light", false);
    return null;
}

function buildCanvasNote(elementIds: string[]) {
    const elements = elementIds.map((id, i) => ({ id, type: "rectangle", version: 10 + i }));
    const note = buildNote({
        title: "Canvas",
        type: "canvas",
        content: JSON.stringify({ type: "excalidraw", version: 2, elements, files: {}, appState: {} })
    });
    note.getAttachmentsByRole = async () => [];
    return { note, elements };
}

function buildApi(sceneElements: () => FakeElement[]) {
    const updateScene = vi.fn();
    const api = {
        updateScene,
        addFiles: vi.fn(),
        history: { clear: vi.fn() },
        getSceneElements: vi.fn(sceneElements),
        getAppState: vi.fn(() => ({})),
        getFiles: vi.fn(() => ({})),
        updateLibrary: vi.fn(async () => [])
    } as unknown as ExcalidrawImperativeAPI;
    return { api, updateScene };
}

async function resolvedInitialData() {
    return await (props?.initialData as Promise<ExcalidrawInitialDataState | null>);
}

function loadedElementIds(updateScene: ReturnType<typeof vi.fn>, callIndex = 0) {
    const { elements } = updateScene.mock.calls[callIndex][0] as { elements: FakeElement[] };
    return elements.map((el) => el.id);
}

describe("useCanvasPersistence content loading (#10279)", () => {
    let container: HTMLElement;
    let puts: { url: string; content: string }[];

    beforeEach(() => {
        vi.useFakeTimers();
        props = undefined;
        puts = [];
        server.put = vi.fn(async (url: string, data: { content: string }) => {
            puts.push({ url, content: data.content });
            return {};
        }) as typeof server.put;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.useRealTimers();
    });

    async function mount(note: FNote, apiRef: RefObject<ExcalidrawImperativeAPI>) {
        await act(async () => {
            render(<Probe note={note} apiRef={apiRef} />, container);
        });
        // The blob resolves on a microtask after the first effect flush; a second act
        // cycle lets useNoteBlob's state update land and deliver the content.
        await act(async () => {});
    }

    it("routes the first content through initialData, never through updateScene", async () => {
        const { note } = buildCanvasNote([ "a1", "a2" ]);
        const { api, updateScene } = buildApi(() => []);
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI>;

        await mount(note, apiRef);

        const initialData = await resolvedInitialData();
        expect(initialData?.elements?.map((el) => el.id)).toEqual([ "a1", "a2" ]);
        // Loading via updateScene in the pre-initialization window is what got wiped.
        expect(updateScene).not.toHaveBeenCalled();
    });

    it("does not save the still-empty scene before the initial content is applied (the corruption path)", async () => {
        const { note, elements } = buildCanvasNote([ "a1", "a2" ]);
        let sceneElements: FakeElement[] = [];
        const { api } = buildApi(() => sceneElements);
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI>;

        await mount(note, apiRef);
        await resolvedInitialData();

        // Excalidraw fires onChange during initialization while the scene is still empty
        // (this is the 25 -> 0 wipe observed in the field). It must not schedule a save.
        props?.onChange?.([], {} as never, {} as never);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(puts).toEqual([]);

        // Initialization completes: the initial content lands in the scene. Still no save —
        // this is a load, not a user edit.
        sceneElements = elements;
        props?.onChange?.([], {} as never, {} as never);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(puts).toEqual([]);

        // A real user edit afterwards is saved normally, with the full scene.
        sceneElements = [ { ...elements[0], version: 99 }, elements[1] ];
        props?.onChange?.([], {} as never, {} as never);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(puts).toHaveLength(1);
        expect(puts[0].url).toBe(`notes/${note.noteId}/data`);
        const saved = JSON.parse(puts[0].content) as { elements: FakeElement[] };
        expect(saved.elements.map((el) => el.id)).toEqual([ "a1", "a2" ]);
    });

    it("loads a subsequent note via updateScene once initialData is consumed", async () => {
        const { note: noteA } = buildCanvasNote([ "a1" ]);
        const { note: noteB } = buildCanvasNote([ "b1" ]);
        const { api, updateScene } = buildApi(() => []);
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI>;

        await mount(noteA, apiRef);
        await resolvedInitialData();

        await mount(noteB, apiRef);

        expect(updateScene).toHaveBeenCalledTimes(1);
        expect(loadedElementIds(updateScene)).toEqual([ "b1" ]);
        // A note-switch load is scene initialization: it must never enter the undo store,
        // or undoing the first stroke would restore the previous note's scene (#7148).
        expect(updateScene.mock.calls[0][0]).toMatchObject({ captureUpdate: "NEVER" });
    });

    it("stashes a subsequent note's content while the API is unavailable and replays it on arrival", async () => {
        const { note: noteA } = buildCanvasNote([ "a1" ]);
        const { note: noteB } = buildCanvasNote([ "b1" ]);
        const { api, updateScene } = buildApi(() => []);
        const apiRef = { current: null } as RefObject<ExcalidrawImperativeAPI>;

        await mount(noteA, apiRef);
        await resolvedInitialData();

        // The user switches notes at a moment the imperative API is (still) unavailable.
        await mount(noteB, apiRef);
        expect(updateScene).not.toHaveBeenCalled();

        await act(async () => {
            props?.excalidrawAPI?.(api);
        });

        expect(updateScene).toHaveBeenCalledTimes(1);
        expect(loadedElementIds(updateScene)).toEqual([ "b1" ]);
    });
});

describe("useCanvasDrawingPersistence", () => {
    const IMAGE = { id: "f1", dataURL: "data:image/png;base64,AA==", mimeType: "image/png" };
    const UNUSED_IMAGE = { ...IMAGE, id: "f2" };
    let container: HTMLElement;
    let drawingProps: ReturnType<typeof useCanvasDrawingPersistence> | undefined;
    let sceneElements: FakeElement[];
    let appState: Record<string, unknown>;

    function DrawingProbe({ attachment, editor, apiRef }: {
        attachment: FAttachment;
        editor: AttachmentEditor | undefined;
        apiRef: RefObject<ExcalidrawImperativeAPI>;
    }) {
        drawingProps = useCanvasDrawingPersistence(attachment, editor, apiRef, "light");
        return null;
    }

    beforeEach(() => {
        drawingProps = undefined;
        sceneElements = [];
        appState = {
            scrollX: 1, scrollY: 2, zoom: { value: 1 }, gridModeEnabled: false,
            viewBackgroundColor: "transparent", theme: "light"
        };
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function buildAttachment(content: object) {
        const getBlob = vi.fn(async () => ({ content: JSON.stringify(content) }));
        return { attachment: { attachmentId: "a1", getBlob } as unknown as FAttachment, getBlob };
    }

    function buildEditor(unsavedContent?: string) {
        return {
            canEdit: () => true,
            getUnsavedContent: vi.fn(() => unsavedContent),
            scheduleSave: vi.fn(),
            release: vi.fn()
        } satisfies AttachmentEditor;
    }

    async function mount(attachment: FAttachment, editor: AttachmentEditor | undefined) {
        const api = {
            getSceneElements: () => sceneElements,
            getAppState: () => appState,
            getFiles: () => ({ f1: IMAGE, f2: UNUSED_IMAGE })
        } as unknown as ExcalidrawImperativeAPI;
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI>;
        await act(async () => {
            render(
                <DrawingProbe attachment={attachment} editor={editor} apiRef={apiRef} />,
                container
            );
        });
        return await (drawingProps?.initialData as Promise<ExcalidrawInitialDataState>);
    }

    function change() {
        drawingProps?.onChange?.([], appState as never, {});
    }

    it("loads the drawing with its images, over the note unless it has a background", async () => {
        const elements = [ { id: "r1", type: "rectangle", version: 3 } ];
        const { attachment } = buildAttachment({ elements, files: { f1: IMAGE }, appState: {} });
        expect(await mount(attachment, buildEditor())).toEqual({
            elements,
            appState: { viewBackgroundColor: "transparent", theme: "light" },
            files: { f1: IMAGE }
        });

        render(null, container);
        const colored = buildAttachment({ elements, appState: { viewBackgroundColor: "#ffc9c9" } });
        expect((await mount(colored.attachment, buildEditor())).appState)
            .toEqual({ viewBackgroundColor: "#ffc9c9", theme: "light" });
    });

    it("loads the content that the note has not saved yet over the saved one", async () => {
        const { attachment, getBlob } = buildAttachment({ elements: [] });
        const unsaved = JSON.stringify({ elements: [ { id: "u1", type: "line", version: 1 } ] });

        const initialData = await mount(attachment, buildEditor(unsaved));
        expect(initialData.elements?.map((element) => element.id)).toEqual([ "u1" ]);
        expect(getBlob).not.toHaveBeenCalled();
    });

    it("saves a change to the scene or to its background, with the images it uses", async () => {
        const loaded = [
            { id: "r1", type: "rectangle", version: 3 },
            { id: "i1", type: "image", version: 1, fileId: "f1" }
        ];
        const { attachment } = buildAttachment({ elements: loaded, files: { f1: IMAGE } });
        const editor = buildEditor();
        await mount(attachment, editor);

        // Excalidraw reports its empty scene, then the loaded one, before any edit.
        change();
        sceneElements = loaded;
        change();
        expect(editor.scheduleSave).not.toHaveBeenCalled();

        sceneElements = [ { ...loaded[0], version: 4 }, loaded[1] ];
        change();
        expect(editor.scheduleSave).toHaveBeenCalledTimes(1);
        const [ savedAttachment, getContent ] = editor.scheduleSave.mock.calls[0];
        expect(savedAttachment).toBe(attachment);
        expect(JSON.parse(getContent())).toEqual({
            type: "excalidraw",
            version: 2,
            elements: sceneElements,
            files: { f1: IMAGE },
            appState: {
                scrollX: 1, scrollY: 2, zoom: { value: 1 }, gridModeEnabled: false,
                viewBackgroundColor: "transparent"
            }
        });

        appState = { ...appState, viewBackgroundColor: "#ffc9c9" };
        change();
        change();
        expect(editor.scheduleSave).toHaveBeenCalledTimes(2);

        render(null, container);
        expect(editor.release).toHaveBeenCalledWith("a1");
    });

    it("saves nothing without an editor", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3 } ];
        const { attachment } = buildAttachment({ elements: loaded });
        const initialData = await mount(attachment, undefined);
        expect(initialData.elements).toEqual(loaded);

        sceneElements = [ { ...loaded[0], version: 9 } ];
        expect(() => change()).not.toThrow();
    });
});
