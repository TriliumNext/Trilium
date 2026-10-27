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
import { exportToSvg, restoreElements } from "@excalidraw/excalidraw";
import { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { HostHistoryStep } from "@triliumnext/codemirror";
import { type RefObject, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import LoadResults from "../../../services/load_results";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import type { SavedData } from "../../react/hooks";
import type { EmbedHostHistory } from "../text/embed_history";
import { CANVAS_EXPORT_TITLE } from "./image_attachments";
import useCanvasPersistence, {
    saveDrawingPicture, useCanvasDrawingPersistence
} from "./persistence";

interface FakeElement {
    id: string;
    type: string;
    version: number;
    text?: string;
    isDeleted?: boolean;
}

interface PlacedElement {
    x: number;
    y: number;
    width: number;
    height: number;
    isDeleted?: boolean;
}

vi.mock("@excalidraw/excalidraw", () => ({
    // Mirrors the real behavior closely enough for change tracking: the version of a scene
    // is derived from its elements, and an empty scene is always version 0.
    getSceneVersion: (elements: FakeElement[]) => elements.reduce((sum, el) => sum + (el.version ?? 0), 0),
    // As Excalidraw restores a loaded scene: it deletes a text element without text, which bumps
    // its version.
    restoreElements: (elements: FakeElement[]) => elements.map((element) =>
        element.type === "text" && !element.text && !element.isDeleted
            ? { ...element, isDeleted: true, version: element.version + 1 }
            : element),
    exportToSvg: vi.fn(async () => ({ outerHTML: "<svg/>" })),
    getCommonBounds: (elements: PlacedElement[]) => [
        Math.min(...elements.map(({ x }) => x)),
        Math.min(...elements.map(({ y }) => y)),
        Math.max(...elements.map(({ x, width }) => x + width)),
        Math.max(...elements.map(({ y, height }) => y + height))
    ],
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER", EVENTUALLY: "EVENTUALLY" },
    newElementWith: (element: FakeElement, updates: object) =>
        ({ ...element, ...updates, version: element.version + 1 })
}));

vi.stubGlobal("logError", vi.fn());
vi.stubGlobal("logInfo", vi.fn());

type PersistenceProps = ReturnType<typeof useCanvasPersistence>;

let props: PersistenceProps | undefined;

function Probe({ note, apiRef, isReadOnly = false }: {
    note: FNote;
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    isReadOnly?: boolean;
}) {
    props = useCanvasPersistence(note, null, apiRef, "light", isReadOnly);
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
        act(() => render(null, container));
        container.remove();
        vi.useRealTimers();
    });

    async function mount(note: FNote, apiRef: RefObject<ExcalidrawImperativeAPI | null>) {
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
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI | null>;

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
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI | null>;

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

    it("saves nothing for the content as Excalidraw restores it", async () => {
        const note = buildNote({
            title: "Canvas",
            type: "canvas",
            content: JSON.stringify({
                type: "excalidraw", version: 2, files: {}, appState: {},
                elements: [
                    { id: "a1", type: "rectangle", version: 10 },
                    { id: "t1", type: "text", version: 2, text: "" }
                ]
            })
        });
        note.getAttachmentsByRole = async () => [];
        let sceneElements: FakeElement[] = [];
        const { api } = buildApi(() => sceneElements);
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI | null>;

        await mount(note, apiRef);
        const initialData = await resolvedInitialData();
        // Excalidraw restores what `initialData` holds once more as it shows it.
        sceneElements =
            restoreElements(initialData?.elements ?? [], null) as unknown as FakeElement[];
        props?.onChange?.([], {} as never, {} as never);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(puts).toEqual([]);
    });

    it("loads a subsequent note via updateScene once initialData is consumed", async () => {
        const { note: noteA } = buildCanvasNote([ "a1" ]);
        const { note: noteB } = buildCanvasNote([ "b1" ]);
        const { api, updateScene } = buildApi(() => []);
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI | null>;

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
        const apiRef = { current: null } as RefObject<ExcalidrawImperativeAPI | null>;

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

describe("useCanvasPersistence saves", () => {
    const PICTURE_TIME = "2026-10-27 10:00:00.000Z";
    let container: HTMLElement;
    let puts: { url: string; data: SavedData }[];
    let post: ReturnType<typeof vi.spyOn>;
    let sceneElements: FakeElement[];

    beforeEach(() => {
        vi.useFakeTimers();
        props = undefined;
        puts = [];
        sceneElements = [];
        server.put = vi.fn(async (url: string, data: SavedData) => {
            puts.push({ url, data });
            return {};
        }) as typeof server.put;
        post = vi.spyOn(server, "post").mockResolvedValue(undefined);
        vi.mocked(exportToSvg).mockClear();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        post.mockRestore();
        vi.useRealTimers();
    });

    /** A canvas note modified at `modified`, whose picture was saved at `pictureTime`, if any. */
    function buildNoteWithPicture(modified: string, pictureTime?: string) {
        const { note, elements } = buildCanvasNote([ "a1" ]);
        note.getMetadata = (async () => ({ utcDateModified: modified })) as never;
        note.getAttachmentsByRole = (async (role: string) => role === "image" && pictureTime
            ? [ { title: CANVAS_EXPORT_TITLE, utcDateModified: pictureTime } ]
            : []) as never;
        return { note, elements };
    }

    async function mount(note: FNote, isReadOnly = false) {
        const { api } = buildApi(() => sceneElements);
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI | null>;
        await act(async () => {
            render(<Probe note={note} apiRef={apiRef} isReadOnly={isReadOnly} />, container);
        });
        await act(async () => {});
        await resolvedInitialData();
    }

    async function waitFor(ms: number) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    }

    function change(appState: object = {}) {
        props?.onChange?.([], appState as never, {} as never);
    }

    it("saves the scene alone, and its picture once the saves pause", async () => {
        const { note, elements } = buildNoteWithPicture(PICTURE_TIME, PICTURE_TIME);
        await mount(note);
        sceneElements = elements;
        change();

        sceneElements = [ { ...elements[0], version: 99 } ];
        change();
        await waitFor(1500);
        expect(puts).toHaveLength(1);
        expect(puts[0].data.attachments).toEqual([]);
        expect(exportToSvg).not.toHaveBeenCalled();

        await waitFor(5000);
        expect(vi.mocked(exportToSvg).mock.calls.map(([ { elements } ]) => elements))
            .toEqual([ sceneElements ]);
        expect(post).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/attachments?matchBy=title`,
            { role: "image", mime: "image/svg+xml", title: CANVAS_EXPORT_TITLE, content: "<svg/>" }
        );
    });

    it("holds the save while the pointer is down, also a save that waits", async () => {
        const { note, elements } = buildNoteWithPicture(PICTURE_TIME, PICTURE_TIME);
        await mount(note);
        sceneElements = elements;
        change();

        // A change that waits for its save, then a drag.
        sceneElements = [ { ...elements[0], version: 99 } ];
        change();
        await waitFor(500);
        for (const version of [ 100, 101, 102, 103, 104, 105 ]) {
            sceneElements = [ { ...elements[0], version } ];
            change({ cursorButton: "down" });
            await waitFor(300);
        }
        expect(puts).toEqual([]);

        change({ cursorButton: "up" });
        await waitFor(1500);
        expect(puts).toHaveLength(1);
        expect(JSON.parse(puts[0].data.content).elements).toMatchObject([ { version: 105 } ]);
    });

    it("keeps the picture of a save made while it checks the loaded picture", async () => {
        const { note, elements } = buildNoteWithPicture(PICTURE_TIME, PICTURE_TIME);
        let finishCheck = () => {};
        const metadata = new Promise((resolve) => {
            finishCheck = () => resolve({ utcDateModified: "2026-10-27 11:00:00.000Z" });
        });
        note.getMetadata = (() => metadata) as never;
        await mount(note);
        sceneElements = elements;
        change();

        sceneElements = [ { ...elements[0], version: 99 } ];
        change();
        await waitFor(1500);
        finishCheck();
        await waitFor(5000);
        expect(vi.mocked(exportToSvg).mock.calls.map(([ { elements } ]) => elements))
            .toEqual([ sceneElements ]);
    });

    it("draws a missing or older picture once the note loads, unless read-only", async () => {
        const postedNoteIds = () => post.mock.calls.map(([ url ]) => String(url).split("/")[1]);
        const stale = buildNoteWithPicture("2026-10-27 11:00:00.000Z", PICTURE_TIME).note;
        await mount(stale);
        await waitFor(5000);
        expect(postedNoteIds()).toEqual([ stale.noteId ]);
        expect(vi.mocked(exportToSvg).mock.calls[0]?.[0].elements)
            .toMatchObject([ { id: "a1" } ]);

        // The notes that the canvas loads next.
        await mount(buildNoteWithPicture(PICTURE_TIME, PICTURE_TIME).note);
        await mount(buildNoteWithPicture("2026-10-27 11:00:00.000Z", PICTURE_TIME).note, true);
        await waitFor(5000);
        expect(postedNoteIds()).toEqual([ stale.noteId ]);

        const unpictured = buildNoteWithPicture(PICTURE_TIME).note;
        await mount(unpictured);
        await waitFor(5000);
        expect(postedNoteIds()).toEqual([ stale.noteId, unpictured.noteId ]);
    });
});

describe("useCanvasDrawingPersistence", () => {
    const IMAGE = { id: "f1", dataURL: "data:image/png;base64,AA==", mimeType: "image/png" };
    const UNUSED_IMAGE = { ...IMAGE, id: "f2" };
    let container: HTMLElement;
    let drawingProps: ReturnType<typeof useCanvasDrawingPersistence> | undefined;
    let sceneElements: FakeElement[];
    let sceneFiles: Record<string, unknown>;
    let appState: Record<string, unknown>;
    let updateScene: ReturnType<typeof vi.fn>;
    let parent: Component;
    /** The note that owns the drawings, with a picture saved after them. */
    let owner: FNote;

    function DrawingProbe({ attachment, editor, apiRef, options }: {
        attachment: FAttachment;
        editor: ContentEditor | undefined;
        apiRef: RefObject<ExcalidrawImperativeAPI | null>;
        options?: Parameters<typeof useCanvasDrawingPersistence>[4];
    }) {
        drawingProps = useCanvasDrawingPersistence(attachment, editor, apiRef, "light", options);
        return null;
    }

    beforeEach(() => {
        drawingProps = undefined;
        sceneElements = [];
        sceneFiles = { f1: IMAGE, f2: UNUSED_IMAGE };
        updateScene = vi.fn();
        parent = new Component();
        owner = buildNote({ title: "Owner" });
        owner.getAttachmentsByRole = (async () => [
            { title: "a1.svg", utcDateModified: "2026-01-02 00:00:00.000Z" }
        ]) as never;
        appState = {
            scrollX: 1, scrollY: 2, zoom: { value: 1 }, gridModeEnabled: false,
            viewBackgroundColor: "transparent", theme: "light"
        };
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    function buildAttachment(content: object) {
        const getBlob = vi.fn(async () => ({ content: JSON.stringify(content) }));
        const attachment = {
            attachmentId: "a1", ownerId: owner.noteId, utcDateModified: "2026-01-01 00:00:00.000Z",
            getBlob
        } as unknown as FAttachment;
        return { attachment, getBlob };
    }

    function buildEditor(unsavedContent?: string) {
        return {
            canEdit: () => true,
            getUnsavedContent: vi.fn(() => unsavedContent),
            scheduleSave: vi.fn(),
            release: vi.fn()
        } satisfies ContentEditor;
    }

    async function mount(
        attachment: FAttachment,
        editor: ContentEditor | undefined,
        options?: Parameters<typeof useCanvasDrawingPersistence>[4],
        target = container
    ) {
        const api = {
            getSceneElements: () => sceneElements,
            getSceneElementsIncludingDeleted: () => sceneElements,
            getAppState: () => appState,
            getFiles: () => sceneFiles,
            updateScene,
            addFiles: vi.fn(),
            history: { clear: vi.fn() },
            registerAction: vi.fn()
        } as unknown as ExcalidrawImperativeAPI;
        const apiRef = { current: api } as RefObject<ExcalidrawImperativeAPI | null>;
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <DrawingProbe
                        attachment={attachment}
                        editor={editor}
                        apiRef={apiRef}
                        options={options}
                    />
                </ParentComponent.Provider>,
                target
            );
        });
        return await (drawingProps?.initialData as Promise<ExcalidrawInitialDataState>);
    }

    function change() {
        drawingProps?.onChange?.([], appState as never, {});
    }

    /** Reports a save of the attachment `a1` made by `componentId`, and waits until it shows. */
    async function reportSave(row: object = { attachmentId: "a1" }, componentId = "other") {
        const loadResults = new LoadResults([]);
        loadResults.addAttachmentRow(row as never, componentId);
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults });
            await new Promise((resolve) => setTimeout(resolve));
        });
    }

    /** Has the mocked Excalidraw show the elements that `updateScene()` replaces. */
    function showUpdatedElements() {
        updateScene.mockImplementation((data: { elements?: FakeElement[] }) => {
            if (data.elements) sceneElements = data.elements;
        });
    }

    it("loads the drawing with its images, over the note unless it has a background", async () => {
        const elements = [ { id: "r1", type: "rectangle", version: 3 } ];
        const { attachment } = buildAttachment({ elements, files: { f1: IMAGE }, appState: {} });
        expect(await mount(attachment, buildEditor())).toEqual({
            elements,
            appState: { viewBackgroundColor: "transparent", theme: "light" },
            files: { f1: IMAGE }
        });

        act(() => render(null, container));
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
        const [ getContent, onSaved ] = editor.scheduleSave.mock.calls[0];
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

        // Once the saves pause, the drawing saves its picture, drawn with the images loaded in
        // Excalidraw.
        const post = vi.spyOn(server, "post").mockResolvedValue(undefined);
        vi.mocked(exportToSvg).mockClear().mockResolvedValueOnce(svgOf("picture"));
        vi.useFakeTimers();
        await act(async () => onSaved(getContent()));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(29000);
        });
        expect(exportToSvg).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        vi.useRealTimers();
        await vi.waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith(
            `notes/${owner.noteId}/attachments?matchBy=title`,
            expect.objectContaining({ title: "a1.svg" })
        ));
        expect(vi.mocked(exportToSvg).mock.calls[0]?.[0].files).toBe(sceneFiles);
        post.mockRestore();

        appState = { ...appState, viewBackgroundColor: "#ffc9c9" };
        change();
        change();
        expect(editor.scheduleSave).toHaveBeenCalledTimes(2);

        act(() => render(null, container));
        expect(editor.release).toHaveBeenCalledOnce();
    });

    it("holds the save while the pointer is down", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3 } ];
        const { attachment } = buildAttachment({ elements: loaded });
        const editor = buildEditor();
        await mount(attachment, editor);
        change();
        sceneElements = loaded;
        change();

        appState = { ...appState, cursorButton: "down" };
        sceneElements = [ { ...loaded[0], version: 4 } ];
        change();
        sceneElements = [ { ...loaded[0], version: 5 } ];
        change();
        expect(editor.scheduleSave).not.toHaveBeenCalled();

        appState = { ...appState, cursorButton: "up" };
        change();
        expect(editor.scheduleSave).toHaveBeenCalledOnce();
    });

    it("loads the saves of other components only, not those of its own editor", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3 } ];
        const { attachment, getBlob } = buildAttachment({ elements: loaded });
        await mount(attachment, { ...buildEditor(), componentId: "textNote" });
        change();
        sceneElements = loaded;
        change();
        getBlob.mockClear();

        await reportSave({ attachmentId: "a1" }, "textNote");
        expect(getBlob).not.toHaveBeenCalled();
        await reportSave();
        expect(getBlob).toHaveBeenCalledOnce();
    });

    it("loads the saves of its own editor while another embed shows the drawing", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3 } ];
        const { attachment, getBlob } = buildAttachment({ elements: loaded });
        const host: EmbedHostHistory = {
            push: () => ({ isLatest: () => true }),
            undo: vi.fn(),
            redo: vi.fn(),
            isEnabled: () => false,
            subscribe: () => () => {}
        };
        const editor = {
            ...buildEditor(), componentId: "textNote", history: { host, write: vi.fn() }
        };
        const show = async (target?: HTMLElement) => {
            sceneElements = [];
            await mount(attachment, editor, undefined, target);
            change();
            sceneElements = loaded;
            change();
            getBlob.mockClear();
        };
        await show();
        await reportSave({ attachmentId: "a1" }, "textNote");
        expect(getBlob).not.toHaveBeenCalled();

        // Another embed of the drawing in the same text note.
        const other = document.createElement("div");
        await show(other);
        await reportSave({ attachmentId: "a1" }, "textNote");
        expect(getBlob).toHaveBeenCalledTimes(2);
        act(() => render(null, other));
    });

    it("keeps the picture of a save made while it checks the loaded picture", async () => {
        vi.useFakeTimers();
        const post = vi.spyOn(server, "post").mockResolvedValue(undefined);
        let finishCheck = () => {};
        const pictures = new Promise((resolve) => {
            finishCheck = () => resolve([
                { title: "a1.svg", utcDateModified: "2025-12-31 00:00:00.000Z" }
            ]);
        });
        owner.getAttachmentsByRole = (() => pictures) as never;
        const loaded = [ { id: "r1", type: "rectangle", version: 3 } ];
        const { attachment } = buildAttachment({ elements: loaded });
        const editor = buildEditor();
        await mount(attachment, editor);
        change();
        sceneElements = loaded;
        change();

        sceneElements = [ { ...loaded[0], version: 4 } ];
        change();
        const [ getContent, onSaved ] = editor.scheduleSave.mock.calls[0];
        const saved = getContent();
        vi.mocked(exportToSvg).mockResolvedValueOnce(svgOf("picture"));
        await act(async () => {
            onSaved(saved);
            finishCheck();
            await vi.advanceTimersByTimeAsync(30000);
        });
        expect(vi.mocked(exportToSvg).mock.calls.map(([ { elements } ]) => elements))
            .toEqual([ sceneElements ]);
        expect(post).toHaveBeenCalledOnce();
        post.mockRestore();
    });

    it("draws a picture older than the drawing once it loads, if it can save one", async () => {
        vi.useFakeTimers();
        const post = vi.spyOn(server, "post").mockResolvedValue(undefined);
        const loaded = { elements: [ { id: "r1", type: "rectangle", version: 3 } ] };
        async function load(content: object, editor: ContentEditor | undefined) {
            act(() => render(null, container));
            await mount(buildAttachment(content).attachment, editor);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(30000);
            });
        }

        // None for a current picture. For an older one, none without an editor, for an empty
        // drawing, or while the editor has changes to save.
        await load(loaded, buildEditor());
        owner.getAttachmentsByRole = (async () => [
            { title: "a1.svg", utcDateModified: "2025-12-31 00:00:00.000Z" }
        ]) as never;
        await load(loaded, undefined);
        await load({ elements: [] }, buildEditor());
        await load(loaded, buildEditor(JSON.stringify(loaded)));
        expect(post).not.toHaveBeenCalled();

        vi.mocked(exportToSvg).mockResolvedValueOnce(svgOf("picture"));
        await load(loaded, buildEditor());
        expect(post).toHaveBeenCalledExactlyOnceWith(
            `notes/${owner.noteId}/attachments?matchBy=title`,
            expect.objectContaining({ title: "a1.svg" })
        );
        post.mockRestore();
    });

    it("saves nothing for the content as Excalidraw restores it, only the edits", async () => {
        // A text element placed with nothing typed into it yet, as another view saved it.
        const saved = [
            { id: "r1", type: "rectangle", version: 3 },
            { id: "t1", type: "text", version: 2, text: "" }
        ];
        const { attachment } = buildAttachment({ elements: saved });
        const editor = buildEditor();
        const initialData = await mount(attachment, editor);

        // Excalidraw restores what `initialData` holds once more as it shows it.
        change();
        sceneElements =
            restoreElements(initialData.elements ?? [], null) as unknown as FakeElement[];
        change();
        expect(editor.scheduleSave).not.toHaveBeenCalled();
        expect(initialData.elements).toMatchObject([ { id: "r1" }, { id: "t1", isDeleted: true } ]);

        sceneElements = [ { ...saved[0], version: 4 }, sceneElements[1] ];
        change();
        expect(editor.scheduleSave).toHaveBeenCalledOnce();
    });

    it("keeps its changes on the undo stack of the note, also once Excalidraw is gone", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3, x: 0 } ];
        const { attachment, getBlob } = buildAttachment({ elements: loaded });
        const steps: HostHistoryStep[] = [];
        const host: EmbedHostHistory = {
            push: (step) => {
                steps.push(step);
                return { isLatest: () => true };
            },
            undo: vi.fn(),
            redo: vi.fn(),
            isEnabled: () => false,
            subscribe: () => () => {}
        };
        const editor = { ...buildEditor(), history: { host, write: vi.fn() } };
        const root = document.createElement("div");
        await mount(attachment, editor, { rootRef: { current: root } });

        change();
        sceneElements = loaded;
        change();
        root.dispatchEvent(new Event("pointerdown"));
        const moved = { ...loaded[0], x: 10, version: 4 };
        sceneElements = [ moved ];
        change();
        expect(steps).toHaveLength(1);

        act(() => render(null, container));
        editor.scheduleSave.mockClear();
        // Saved elsewhere since Excalidraw went away.
        const added = { id: "e1", type: "ellipse", version: 1 };
        getBlob.mockResolvedValue({ content: JSON.stringify({ elements: [ moved, added ] }) });
        expect(steps[0].undo()).toBe(true);
        await vi.waitFor(() => expect(editor.scheduleSave).toHaveBeenCalledOnce());
        const [ getContent ] = editor.scheduleSave.mock.calls[0];
        expect(JSON.parse(getContent()).elements)
            .toMatchObject([ { id: "r1", x: 0 }, { id: "e1" } ]);
    });

    it("shows a save made elsewhere in place, which it neither saves nor undoes", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3, versionNonce: 1 } ];
        const { attachment, getBlob } = buildAttachment({ elements: loaded });
        const steps: HostHistoryStep[] = [];
        const host: EmbedHostHistory = {
            push: (step) => {
                steps.push(step);
                return { isLatest: () => true };
            },
            undo: vi.fn(),
            redo: vi.fn(),
            isEnabled: () => false,
            subscribe: () => () => {}
        };
        const editor = { ...buildEditor(), history: { host, write: vi.fn() } };
        showUpdatedElements();
        await mount(attachment, editor, { rootRef: { current: document.createElement("div") } });
        change();
        sceneElements = loaded;
        change();

        const saved = [
            { ...loaded[0], version: 4, versionNonce: 2 },
            { id: "e1", type: "ellipse", version: 1, versionNonce: 3 }
        ];
        getBlob.mockResolvedValue({ content: JSON.stringify({
            elements: saved, appState: { viewBackgroundColor: "#ffc9c9", zoom: { value: 3 } }
        }) });
        await reportSave();
        expect(updateScene).toHaveBeenCalledExactlyOnceWith({
            elements: saved,
            appState: { viewBackgroundColor: "#ffc9c9", gridModeEnabled: false },
            captureUpdate: "NEVER"
        });
        appState = { ...appState, viewBackgroundColor: "#ffc9c9" };
        change();
        expect(editor.scheduleSave).not.toHaveBeenCalled();
        expect(steps).toEqual([]);

        // The scene that shows already stays, through a deletion too, and so do the changes that
        // wait for a save here.
        updateScene.mockClear();
        await reportSave();
        getBlob.mockResolvedValue({ content: JSON.stringify({ elements: [] }) });
        await reportSave({ attachmentId: "a1", isDeleted: true });
        editor.getUnsavedContent.mockReturnValue(JSON.stringify({ elements: loaded }));
        await reportSave();
        expect(updateScene).not.toHaveBeenCalled();
    });

    it("shows a save made elsewhere once it shows, as in a tab in the background", async () => {
        const resizeCallbacks: (() => void)[] = [];
        const { ResizeObserver } = globalThis;
        globalThis.ResizeObserver = class {
            constructor(callback: () => void) {
                resizeCallbacks.push(callback);
            }
            observe() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
        try {
            const loaded = [ { id: "r1", type: "rectangle", version: 3, versionNonce: 1 } ];
            const { attachment, getBlob } = buildAttachment({ elements: loaded });
            const root = container.appendChild(document.createElement("div"));
            showUpdatedElements();
            await mount(attachment, buildEditor(), { rootRef: { current: root } });
            change();
            sceneElements = loaded;
            change();

            container.style.display = "none";
            const saved = [ { ...loaded[0], version: 4, versionNonce: 2 } ];
            getBlob.mockResolvedValue({ content: JSON.stringify({ elements: saved }) });
            await reportSave();
            expect(getBlob).toHaveBeenCalledTimes(2);
            expect(updateScene).not.toHaveBeenCalled();

            container.style.display = "";
            await act(async () => {
                for (const callback of resizeCallbacks) callback();
                await new Promise((resolve) => setTimeout(resolve));
            });
            expect(updateScene).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                elements: saved
            }));
        } finally {
            globalThis.ResizeObserver = ResizeObserver;
        }
    });

    it("keeps the text that the user types, and shows a save made meanwhile after", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3, versionNonce: 1 } ];
        const { attachment, getBlob } = buildAttachment({ elements: loaded });
        showUpdatedElements();
        await mount(attachment, buildEditor());
        change();
        sceneElements = loaded;
        change();

        // Its own save of a text element with nothing typed into it yet.
        const text = { id: "t1", type: "text", version: 1, versionNonce: 5, text: "" };
        sceneElements = [ ...loaded, text ];
        getBlob.mockResolvedValue({ content: JSON.stringify({ elements: sceneElements }) });
        await reportSave();
        expect(updateScene).not.toHaveBeenCalled();

        appState = { ...appState, editingTextElement: text };
        const saved = [ { ...loaded[0], version: 4, versionNonce: 2 } ];
        getBlob.mockResolvedValue({ content: JSON.stringify({ elements: saved }) });
        await reportSave();
        expect(updateScene).not.toHaveBeenCalled();

        appState = { ...appState, editingTextElement: null };
        await act(async () => {
            change();
            await new Promise((resolve) => setTimeout(resolve));
        });
        expect(updateScene).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            elements: saved
        }));
    });

    it("waits for an action that the user starts while the images of a save load", async () => {
        const owner = buildNote({ title: "Owner" });
        owner.getAttachmentsByRole = vi.fn(async () => [
            { attachmentId: "img9", title: "f9.png" }
        ]) as never;
        let loadImage = () => {};
        const isImageLoaded = new Promise<void>((resolve) => {
            loadImage = resolve;
        });
        vi.stubGlobal("fetch", vi.fn(async () => {
            await isImageLoaded;
            return { ok: true, blob: async () => new Blob([ "ABC" ], { type: "image/png" }) };
        }));
        const loaded = [ { id: "r1", type: "rectangle", version: 3, versionNonce: 1 } ];
        const { attachment, getBlob } = buildAttachment({ elements: loaded });
        const drawing = { ...attachment, ownerId: owner.noteId } as unknown as FAttachment;
        sceneFiles = {};
        showUpdatedElements();
        await mount(drawing, buildEditor());
        change();
        sceneElements = loaded;
        change();

        const image = { id: "i9", type: "image", version: 1, versionNonce: 2, fileId: "f9.png" };
        const saved = [ loaded[0], image ];
        getBlob.mockResolvedValue({ content: JSON.stringify({ elements: saved }) });
        await reportSave();
        appState = { ...appState, editingTextElement: { id: "t1" } };
        await act(async () => {
            loadImage();
            // `FileReader` reads the image over several turns.
            for (let turn = 0; turn < 5; turn++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        });
        expect(updateScene).not.toHaveBeenCalled();

        appState = { ...appState, editingTextElement: null };
        await act(async () => {
            change();
        });
        await vi.waitFor(() => expect(updateScene).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ elements: saved })));
    });

    it("shows a save that lands while the drawing loads once Excalidraw shows it", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3, versionNonce: 1 } ];
        const { attachment, getBlob } = buildAttachment({ elements: loaded });
        showUpdatedElements();
        await mount(attachment, undefined);

        const saved = [ { ...loaded[0], version: 4, versionNonce: 2 } ];
        getBlob.mockResolvedValue({ content: JSON.stringify({ elements: saved }) });
        await reportSave();
        expect(updateScene).not.toHaveBeenCalled();

        sceneElements = loaded;
        await act(async () => {
            change();
            await new Promise((resolve) => setTimeout(resolve));
        });
        expect(updateScene).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            elements: saved
        }));
    });

    it("loads the images it refers to from its note and saves them by reference", async () => {
        const owner = buildNote({ title: "Owner" });
        const getAttachmentsByRole = vi.fn(async () => [
            { attachmentId: "img1", title: "f9.png" },
            { attachmentId: "img2", title: "other.png" },
            { attachmentId: "pic1", title: "a1.svg", utcDateModified: "2026-01-02 00:00:00.000Z" }
        ]);
        owner.getAttachmentsByRole = getAttachmentsByRole as never;
        const fetchImage = vi.fn(async () => ({
            ok: true,
            blob: async () => new Blob([ "ABC" ], { type: "image/png" })
        }));
        vi.stubGlobal("fetch", fetchImage);
        const loaded = [
            { id: "i1", type: "image", version: 1, fileId: "f1" },
            { id: "i9", type: "image", version: 1, fileId: "f9.png" }
        ];
        const { attachment } = buildAttachment({ elements: loaded, files: { f1: IMAGE } });
        const drawing = { ...attachment, ownerId: owner.noteId } as unknown as FAttachment;
        const editor = buildEditor();

        const initialData = await mount(drawing, editor);
        expect(getAttachmentsByRole).toHaveBeenCalledWith("image");
        expect(fetchImage).toHaveBeenCalledExactlyOnceWith("api/attachments/img1/image/f9.png");
        expect(initialData.files).toEqual({
            f1: IMAGE,
            "f9.png": {
                id: "f9.png", dataURL: "data:image/png;base64,QUJD", mimeType: "image/png",
                created: expect.any(Number)
            }
        });

        sceneElements = loaded;
        change();
        sceneElements = [ { ...loaded[0], version: 2 }, loaded[1] ];
        sceneFiles = initialData.files ?? {};
        change();
        const [ getContent ] = editor.scheduleSave.mock.calls[0];
        expect(JSON.parse(getContent()).files).toEqual({ f1: IMAGE });
    });

    it("fits a drawing without a saved view in the size that Excalidraw reports", async () => {
        const TALL = { x: -400, y: -400, width: 800, height: 800 };
        const LATER = { x: 150, y: 60, width: 10, height: 10 };
        async function getFits(loaded: PlacedElement[], savedAppState: object = {}) {
            act(() => render(null, container));
            updateScene.mockClear();
            const { attachment } = buildAttachment({ elements: loaded, appState: savedAppState });
            await mount(attachment, undefined);
            // The empty scene, then the loaded one before the drawing is laid out, then more.
            for (const [ elements, width, height ] of [
                [ [], 1000, 400 ], [ loaded, 0, 0 ], [ [ ...loaded, LATER ], 1000, 400 ],
                [ [ ...loaded, LATER ], 1000, 400 ]
            ] as const) {
                drawingProps?.onChange?.(elements as never, { width, height } as never, {});
            }
            return updateScene.mock.calls.map(([ { appState } ]) => appState);
        }

        expect(await getFits([ TALL ]))
            .toEqual([ { zoom: { value: 0.5 }, scrollX: 1000, scrollY: 400 } ]);
        expect(await getFits([ { x: 100, y: 50, width: 800, height: 200 } ]))
            .toEqual([ { zoom: { value: 1.25 }, scrollX: -100, scrollY: 10 } ]);
        expect((await getFits([ { x: 0, y: 0, width: 100_000, height: 100 } ]))[0]?.zoom)
            .toEqual({ value: 0.1 });

        expect(await getFits([ TALL ], { zoom: { value: 2 }, scrollX: 5, scrollY: 6 })).toEqual([]);
        expect(await getFits([])).toEqual([]);
        expect(await getFits([ { ...TALL, isDeleted: true } ])).toEqual([]);
    });

    it("keeps the view of a drawing over a locked image inside the image", async () => {
        const image = {
            id: "i1", type: "image", version: 1, locked: true, x: 0, y: 0, width: 1000, height: 1000
        };
        const saved = { elements: [ image ], appState: { zoom: { value: 1 } } };
        const { attachment } = buildAttachment(saved);
        await mount(attachment, undefined);

        const view = { width: 1000, height: 500, zoom: { value: 0.25 }, scrollX: 0, scrollY: 0 };
        drawingProps?.onChange?.([ image ] as never, view as never, {});
        expect(updateScene).toHaveBeenCalledExactlyOnceWith({
            appState: { zoom: { value: 0.5 }, scrollX: 500, scrollY: 0 }
        });
    });

    it("opens at the view it is given, which needs no fit, and tells once it shows", async () => {
        const loaded = [ { id: "r1", type: "rectangle", version: 3 } ];
        const placed = [ { ...loaded[0], x: 0, y: 0, width: 100, height: 100 } ];
        const view = { zoom: { value: 2 }, scrollX: 5, scrollY: 6 };
        const onSceneShown = vi.fn();
        const { attachment } = buildAttachment({ elements: placed, appState: { zoom: 1 } });

        const initialData = await mount(attachment, buildEditor(), {
            initialView: view as never,
            onSceneShown
        });
        expect(initialData.appState).toEqual(expect.objectContaining(view));

        // Excalidraw reports its empty scene, then the loaded one, twice.
        change();
        expect(onSceneShown).not.toHaveBeenCalled();
        sceneElements = loaded;
        const sized = { ...appState, width: 1000, height: 500 };
        drawingProps?.onChange?.(placed as never, sized as never, {});
        change();
        expect(onSceneShown).toHaveBeenCalledOnce();
        expect(updateScene).not.toHaveBeenCalled();

        act(() => render(null, container));
        sceneElements = [];
        const empty = vi.fn();
        const { attachment: emptyDrawing } = buildAttachment({ elements: [] });
        await mount(emptyDrawing, undefined, { onSceneShown: empty });
        change();
        expect(empty).toHaveBeenCalledOnce();
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

describe("saveDrawingPicture", () => {
    const drawing = { attachmentId: "d1", ownerId: "n1" };
    const IMAGE = { id: "f1", dataURL: "data:image/png;base64,AA==", mimeType: "image/png" };
    const image = { id: "i1", type: "image", fileId: "f1" };

    /** The saved pictures that `post` sent, with their whitespace collapsed. */
    function getSavedPictures(post: { mock: { calls: unknown[][] } }) {
        return post.mock.calls.map(([ , data ]) =>
            (data as { content: string }).content.replace(/\s+/g, " "));
    }

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.mocked(exportToSvg).mockReset();
    });

    it("saves the picture of a drawing, titled after it, in the colors of its page", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue(undefined);
        const exported = pictureWithImages();
        vi.mocked(exportToSvg).mockResolvedValueOnce(exported);
        const files = { f1: IMAGE };
        const content = JSON.stringify({
            elements: [ image, { id: "gone", type: "line", isDeleted: true } ],
            appState: { viewBackgroundColor: "#ffc9c9" }
        });

        await saveDrawingPicture(drawing, content, files as never);
        expect(exportToSvg).toHaveBeenCalledExactlyOnceWith({
            elements: [ image ],
            appState: {
                viewBackgroundColor: "#ffc9c9", exportBackground: true, exportWithDarkMode: false
            },
            files,
            exportPadding: 5
        });
        expect(post).toHaveBeenCalledExactlyOnceWith("notes/n1/attachments?matchBy=title", {
            role: "image", mime: "image/svg+xml", title: "d1.svg", content: expect.any(String)
        });
        // Dark while its page is dark, as Excalidraw's dark export: bitmaps in it keep their colors.
        const [ picture ] = getSavedPictures(post);
        expect(picture).toMatch(/^<svg id="picture" class="trilium-drawing-picture"><style>/);
        expect(picture).toContain("@media (prefers-color-scheme: dark) { "
            + "svg.trilium-drawing-picture { filter: invert(93%) hue-rotate(180deg); } "
            + "svg.trilium-drawing-picture use.trilium-drawing-bitmap { "
            + "filter: invert(100%) hue-rotate(180deg) saturate(1.25); } }</style>");
        expect([ ...exported.querySelectorAll("use") ].map((use) => use.getAttribute("class")))
            .toEqual([ "trilium-drawing-bitmap", null, "trilium-drawing-bitmap" ]);

        // An empty drawing shows nothing.
        await saveDrawingPicture(drawing, JSON.stringify({ elements: [] }));
        expect(post.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            content: `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>`
        }));
    });

    it("saves only the picture of the latest content, and none of a malformed one", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue(undefined);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        let drawFirst: (svg: SVGSVGElement) => void = () => {};
        vi.mocked(exportToSvg)
            .mockImplementationOnce(() => new Promise((resolve) => { drawFirst = resolve; }))
            .mockResolvedValueOnce(svgOf("second"));

        const first = saveDrawingPicture(drawing, JSON.stringify({ elements: [ image ] }), {
            f1: IMAGE
        } as never);
        const second = JSON.stringify({ elements: [ image, { ...image, id: "i2" } ] });
        await saveDrawingPicture(drawing, second, { f1: IMAGE } as never);
        drawFirst(svgOf("first"));
        await first;
        expect(getSavedPictures(post)).toEqual([ expect.stringMatching(/^<svg id="second"/) ]);

        await saveDrawingPicture(drawing, "{");
        expect(post).toHaveBeenCalledOnce();
        expect(error).toHaveBeenCalledOnce();
    });

    it("writes the pictures of a drawing in order, skipping one replaced as it waits", async () => {
        let finishFirst: () => void = () => {};
        const post = vi.spyOn(server, "post")
            .mockImplementationOnce(() => new Promise((resolve) => {
                finishFirst = () => resolve(undefined);
            }))
            .mockResolvedValue(undefined);
        vi.mocked(exportToSvg)
            .mockResolvedValueOnce(svgOf("first"))
            .mockResolvedValueOnce(svgOf("second"))
            .mockResolvedValueOnce(svgOf("third"));
        const save = (count: number) => saveDrawingPicture(drawing, JSON.stringify({
            elements: Array.from({ length: count }, (_, index) => ({ ...image, id: `i${index}` }))
        }), { f1: IMAGE } as never);

        const first = save(1);
        await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
        const second = save(2);
        await vi.waitFor(() => expect(exportToSvg).toHaveBeenCalledTimes(2));
        await new Promise((resolve) => setTimeout(resolve));
        expect(post).toHaveBeenCalledOnce();

        const third = save(3);
        finishFirst();
        await Promise.all([ first, second, third ]);
        expect(getSavedPictures(post)).toEqual([
            expect.stringMatching(/^<svg id="first"/), expect.stringMatching(/^<svg id="third"/)
        ]);
    });

    it("loads from the note the images that are not loaded yet", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue(undefined);
        vi.mocked(exportToSvg).mockResolvedValueOnce(svgOf("picture"));
        const owner = buildNote({ title: "Owner" });
        owner.getAttachmentsByRole = (async () => [
            { attachmentId: "img1", title: "f1" }
        ]) as never;
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            blob: async () => new Blob([ "ABC" ], { type: "image/png" })
        })));

        await saveDrawingPicture(
            { attachmentId: "d1", ownerId: owner.noteId },
            JSON.stringify({ elements: [ image ] })
        );
        expect(vi.mocked(exportToSvg).mock.calls[0]?.[0].files).toEqual({
            f1: expect.objectContaining({ dataURL: "data:image/png;base64,QUJD" })
        });
        expect(post).toHaveBeenCalledOnce();
    });
});

/** An empty SVG element for `exportToSvg()` to draw. */
function svgOf(id: string) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = id;
    return svg;
}

/**
 * A picture as `exportToSvg()` draws images: each in a `<symbol>`, placed by `<use>`. The first
 * image is a bitmap, used twice, and the second an SVG image.
 */
function pictureWithImages() {
    const svg = svgOf("picture");
    const create = (name: string, attributes: Record<string, string>) => {
        const element = document.createElementNS("http://www.w3.org/2000/svg", name);
        for (const [ key, value ] of Object.entries(attributes)) {
            element.setAttribute(key, value);
        }
        return element;
    };
    const symbols = [
        [ "image-f1", "data:image/png;base64,AA==" ],
        [ "image-f2", "data:image/svg+xml;base64,AA==" ]
    ];
    for (const [ id, href ] of symbols) {
        const symbol = create("symbol", { id });
        symbol.append(create("image", { href }));
        svg.append(symbol);
    }
    for (const id of [ "image-f1", "image-f2", "image-f1" ]) {
        svg.append(create("use", { href: `#${id}` }));
    }
    return svg;
}
