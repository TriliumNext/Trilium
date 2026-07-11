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

import type FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import useCanvasPersistence from "./persistence";

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
