import type { Action } from "@excalidraw/excalidraw/actions/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
    AppState, BinaryFileData, ExcalidrawImperativeAPI
} from "@excalidraw/excalidraw/types";
import type { HostHistoryStep } from "@triliumnext/codemirror";
import { type FunctionComponent, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmbedHostHistory, HistoryCommand } from "../text/embed_history";
import DrawingHistory, {
    applyChanges, type DrawingScene, type DrawingStore, type ElementChange, getChangedKeys
} from "./drawing_history";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { NEVER: "NEVER" },
    newElementWith: (element: ExcalidrawElement, updates: object) =>
        ({ ...element, ...updates, version: element.version + 1 }),
    useI18n: () => ({ t: (key: string) => key, langCode: "en" })
}));

const RECTANGLE = element({ id: "r1", type: "rectangle", x: 0, index: "a0" });
const ELLIPSE = element({ id: "e1", type: "ellipse", x: 50, index: "a1" });
const IMAGE = element({ id: "i1", type: "image", width: 100, fileId: "f1", index: "a2" });
const IMAGE_FILE = { id: "f1", dataURL: "data:image/png;base64,AA==" } as BinaryFileData;

describe("DrawingHistory", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it("keeps each change that the user ends as a step of the note, to undo and redo", async () => {
        const { host, steps } = createHost();
        const drawing = createDrawing([ RECTANGLE ]);
        const mount = new DrawingHistory(host).mount();
        mount.attach(drawing.api, drawing.root, createStore([]));
        expect([ ...drawing.actions.keys() ]).toEqual([ "undo", "redo" ]);

        // A drag ends once the pointer is up.
        drawing.input("pointerdown");
        drawing.appState.cursorButton = "down";
        drawing.setElements([ { ...RECTANGLE, x: 10, version: 2 } ]);
        mount.record();
        expect(steps).toHaveLength(0);
        drawing.appState.cursorButton = "up";
        mount.record();
        mount.record();
        expect(steps).toHaveLength(1);
        expect(drawing.api.history.clear).toHaveBeenCalled();

        drawing.input("keydown");
        drawing.setElements([ ...drawing.getElements(), ELLIPSE ]);
        drawing.appState.viewBackgroundColor = "#ffc9c9";
        mount.record();
        expect(steps).toHaveLength(2);

        expect(steps[1].undo()).toBe(true);
        expect(drawing.getElements().map(({ id, isDeleted }) => [ id, isDeleted ]))
            .toEqual([ [ "r1", false ], [ "e1", true ] ]);
        expect(drawing.appState.viewBackgroundColor).toBe("transparent");
        await Promise.resolve();
        expect(document.activeElement).toBe(drawing.container);
        // What a step changes is no step of its own.
        mount.record();
        expect(steps).toHaveLength(2);

        expect(steps[0].undo()).toBe(true);
        expect(drawing.getElements()[0]).toMatchObject({ x: 0, version: 3 });
        expect(steps[0].redo()).toBe(true);
        expect(steps[1].redo()).toBe(true);
        expect(drawing.getElements()).toMatchObject([
            { id: "r1", x: 10, version: 4 }, { id: "e1", isDeleted: false }
        ]);
        expect(drawing.appState.viewBackgroundColor).toBe("#ffc9c9");
    });

    it("compares the elements only to record a change, not to attach or show a saved scene", () => {
        const { host, steps } = createHost();
        const drawing = createDrawing([ RECTANGLE, ELLIPSE ]);
        const mount = new DrawingHistory(host).mount();
        // `getChangedKeys()` compares each property as JSON.
        const stringify = vi.spyOn(JSON, "stringify");
        try {
            mount.attach(drawing.api, drawing.root, createStore([]));
            mount.show({
                elements: [ { ...RECTANGLE, x: 30, version: 5 }, ELLIPSE ], appState: {}, files: {}
            });
            expect(stringify).not.toHaveBeenCalled();

            drawing.input("pointerdown");
            drawing.setElements([ { ...RECTANGLE, x: 40, version: 6 }, ELLIPSE ]);
            mount.record();
            expect(stringify).toHaveBeenCalled();
        } finally {
            stringify.mockRestore();
        }
        expect(steps).toHaveLength(1);
        expect(steps[0].undo()).toBe(true);
        expect(drawing.getElements()[0]).toMatchObject({ x: 30 });
    });

    it("joins a change that the user did not make to the last step, while it is the last", () => {
        const { host, steps, setLatest } = createHost();
        const drawing = createDrawing([]);
        drawing.files.f1 = IMAGE_FILE;
        const mount = new DrawingHistory(host).mount();
        mount.attach(drawing.api, drawing.root, createStore([]));

        drawing.input("drop");
        drawing.setElements([ IMAGE ]);
        mount.record();
        // The image loads and takes its own size.
        drawing.setElements([ { ...IMAGE, width: 300, version: 2 } ]);
        mount.record();
        expect(steps).toHaveLength(1);

        steps[0].undo();
        expect(drawing.getElements()[0]).toMatchObject({ isDeleted: true });
        steps[0].redo();
        expect(drawing.getElements()[0]).toMatchObject({ isDeleted: false, width: 300 });

        setLatest(false);
        const [ image ] = drawing.getElements();
        drawing.setElements([ { ...image, width: 400, version: image.version + 1 } ]);
        mount.record();
        expect(steps).toHaveLength(2);
    });

    it("changes the drawing as saved while no Excalidraw shows it, and shows that in the next one",
        async () => {
            const { host, steps } = createHost();
            const history = new DrawingHistory(host);
            const moved = { ...RECTANGLE, x: 10, version: 2 };
            const store = createStore([ RECTANGLE ]);
            const first = createDrawing([ RECTANGLE ]);
            const firstMount = history.mount();
            firstMount.attach(first.api, first.root, store);
            first.input("pointerdown");
            first.setElements([ moved ]);
            firstMount.record();
            firstMount.detach();
            expect(steps).toHaveLength(1);

            // Saved elsewhere once Excalidraw went away, and loaded by the next one.
            store.setElements([ moved, ELLIPSE ]);
            const nextMount = history.mount();
            expect(steps[0].undo()).toBe(true);
            await vi.waitFor(() => expect(store.write).toHaveBeenCalledOnce());
            expect(store.getElements()).toMatchObject([ { id: "r1", x: 0 }, { id: "e1" } ]);

            const next = createDrawing([ moved, ELLIPSE ]);
            nextMount.attach(next.api, next.root, store);
            await vi.waitFor(() => expect(next.getElements())
                .toMatchObject([ { id: "r1", x: 0 }, { id: "e1" } ]));

            const later = createDrawing([ { ...RECTANGLE, version: 3 }, ELLIPSE ]);
            history.mount().attach(later.api, later.root, store);
            expect(later.api.updateScene).not.toHaveBeenCalled();
            // A step applies to every Excalidraw that shows the drawing.
            steps[0].redo();
            expect(next.getElements()[0]).toMatchObject({ x: 10 });
            expect(later.getElements()[0]).toMatchObject({ x: 10 });
            expect(store.write).toHaveBeenCalledOnce();
        });

    it("shows a step that saves while an Excalidraw loads in that Excalidraw", async () => {
        const { host, steps } = createHost();
        const history = new DrawingHistory(host);
        const moved = { ...RECTANGLE, x: 10, version: 2 };
        const store = createStore([ RECTANGLE ]);
        const first = createDrawing([ RECTANGLE ]);
        const firstMount = history.mount();
        firstMount.attach(first.api, first.root, store);
        first.input("pointerdown");
        first.setElements([ moved ]);
        firstMount.record();
        firstMount.detach();
        store.setElements([ moved ]);

        // Attached while the step reads the drawing.
        const read = deferScene();
        store.read.mockImplementationOnce(() => read.promise);
        steps[0].undo();
        const nextMount = history.mount();
        const next = createDrawing([ moved ]);
        nextMount.attach(next.api, next.root, store);
        // The user goes on in the text before the step applies.
        const text = document.createElement("input");
        document.body.append(text);
        text.focus();
        text.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        read.resolve({ elements: [ moved ], appState: {}, files: {} });
        await vi.waitFor(() => expect(next.getElements()).toMatchObject([ { x: 0 } ]));
        expect(store.getElements()).toMatchObject([ { x: 0 } ]);
        await new Promise((resolve) => setTimeout(resolve));
        expect(document.activeElement).toBe(text);
        nextMount.detach();

        // Loaded while the step reads the drawing, attached once it saved.
        const nextRead = deferScene();
        store.read.mockImplementationOnce(() => nextRead.promise);
        steps[0].redo();
        const laterMount = history.mount();
        nextRead.resolve({ elements: next.getElements(), appState: {}, files: {} });
        await vi.waitFor(() => expect(store.write).toHaveBeenCalledTimes(2));
        const later = createDrawing(next.getElements());
        laterMount.attach(later.api, later.root, store);
        await vi.waitFor(() => expect(later.getElements()).toMatchObject([ { x: 10 } ]));
    });

    it("shows the steps saved since an Excalidraw loaded, also while another one saves", async () => {
        const { host, steps } = createHost();
        const history = new DrawingHistory(host);
        const shape = { ...RECTANGLE, y: 0 };
        const store = createStore([ shape ]);
        const first = createDrawing([ shape ]);
        const firstMount = history.mount();
        firstMount.attach(first.api, first.root, store);
        first.input("pointerdown");
        first.setElements([ { ...shape, x: 10, version: 2 } ]);
        firstMount.record();
        first.input("pointerdown");
        first.setElements([ { ...shape, x: 10, y: 5, version: 3 } ]);
        firstMount.record();
        firstMount.detach();
        store.setElements(first.getElements());

        const nextMount = history.mount();
        steps[1].undo();
        await vi.waitFor(() => expect(store.write).toHaveBeenCalledOnce());
        const read = deferScene();
        store.read.mockImplementationOnce(() => read.promise);
        steps[0].undo();
        const next = createDrawing(first.getElements());
        nextMount.attach(next.api, next.root, store);
        read.resolve({ elements: store.getElements(), appState: {}, files: {} });
        await vi.waitFor(() => expect(next.getElements()).toMatchObject([ { x: 0, y: 0 } ]));
    });

    it("applies the steps in order while one waits for the saved drawing", async () => {
        const { host, steps } = createHost();
        const history = new DrawingHistory(host);
        const moved = { ...RECTANGLE, x: 10, version: 2 };
        const store = createStore([ RECTANGLE ]);
        const first = createDrawing([ RECTANGLE ]);
        const firstMount = history.mount();
        firstMount.attach(first.api, first.root, store);
        first.input("pointerdown");
        first.setElements([ moved ]);
        firstMount.record();
        firstMount.detach();
        store.setElements([ moved ]);

        const read = deferScene();
        store.read.mockImplementationOnce(() => read.promise);
        steps[0].undo();
        const nextMount = history.mount();
        const next = createDrawing([ moved ]);
        nextMount.attach(next.api, next.root, store);
        steps[0].redo();
        read.resolve({ elements: [ moved ], appState: {}, files: {} });
        await vi.waitFor(() => expect(store.write).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(next.api.updateScene).toHaveBeenCalledTimes(2));
        expect(next.getElements()).toMatchObject([ { x: 10 } ]);
        await vi.waitFor(() => expect(document.activeElement).toBe(next.container));
    });

    it("undoes and redoes the note with the keys and the buttons of Excalidraw", () => {
        const { host, setEnabled } = createHost();
        const drawing = createDrawing([]);
        new DrawingHistory(host).mount().attach(drawing.api, drawing.root, createStore([]));
        const undo = drawing.actions.get("undo");
        const redo = drawing.actions.get("redo");
        expect(undo && redo).toBeTruthy();

        const keyTest = (action: Action | undefined, init: KeyboardEventInit) =>
            action?.keyTest?.(new KeyboardEvent("keydown", init), drawing.appState, [], never());
        expect(keyTest(undo, { key: "z", code: "KeyZ", ctrlKey: true })).toBe(true);
        expect(keyTest(undo, { key: "я", code: "KeyZ", ctrlKey: true })).toBe(true);
        expect(keyTest(undo, { key: "z", ctrlKey: true, shiftKey: true })).toBe(false);
        expect(keyTest(undo, { key: "z" })).toBe(false);
        expect(keyTest(redo, { key: "Z", ctrlKey: true, shiftKey: true })).toBe(true);
        expect(keyTest(redo, { key: "y", ctrlKey: true })).toBe(true);
        expect(keyTest(redo, { key: "z", ctrlKey: true })).toBe(false);

        expect(undo?.perform([], drawing.appState, null, never())).toBe(false);
        expect(host.undo).toHaveBeenCalledOnce();
        drawing.appState.newElement = ELLIPSE as AppState["newElement"];
        redo?.perform([], drawing.appState, null, never());
        expect(host.redo).not.toHaveBeenCalled();

        const Panel = undo?.PanelComponent as unknown as FunctionComponent<{
            updateData: () => void;
        }>;
        const updateData = vi.fn();
        act(() => render(<Panel updateData={updateData} />, drawing.container));
        const button = drawing.container.querySelector<HTMLButtonElement>(
            "[data-testid=button-undo]");
        expect(button?.disabled).toBe(true);
        act(() => setEnabled("undo", true));
        expect(button?.disabled).toBe(false);
        button?.click();
        expect(updateData).toHaveBeenCalledOnce();
        act(() => render(null, drawing.container));
    });
});

describe("applyChanges", () => {
    const deleteEllipse = new Map<string, ElementChange>([ [ "e1", {
        before: ELLIPSE,
        after: { ...ELLIPSE, isDeleted: true, version: 2 },
        keys: [ "isDeleted" ]
    } ] ]);

    it("brings back an element that the drawing dropped, in its place in the z-order", () => {
        const elements = [ RECTANGLE, IMAGE ];
        expect(applyChanges(elements, deleteEllipse, true).map(({ id }) => id))
            .toEqual([ "r1", "e1", "i1" ]);
        expect(applyChanges(elements, deleteEllipse, false)).toEqual(elements);
    });

    it("puts back the z-order of the elements that a change moved", () => {
        const sendToBack = new Map<string, ElementChange>([ [ "e1", {
            before: ELLIPSE,
            after: { ...ELLIPSE, index: "Zz", version: 2 } as ExcalidrawElement,
            keys: [ "index" ]
        } ] ]);
        const sentToBack = [ { ...ELLIPSE, index: "Zz" } as ExcalidrawElement, RECTANGLE, IMAGE ];
        expect(applyChanges(sentToBack, sendToBack, true).map(({ id }) => id))
            .toEqual([ "r1", "e1", "i1" ]);
        expect(applyChanges([ RECTANGLE, ELLIPSE, IMAGE ], sendToBack, false).map(({ id }) => id))
            .toEqual([ "e1", "r1", "i1" ]);
    });
});

describe("getChangedKeys", () => {
    it("records the properties that the user changes, not those that Excalidraw sets", () => {
        expect(getChangedKeys(RECTANGLE, {
            ...RECTANGLE, x: 5, version: 9, versionNonce: 1, updated: 2
        } as ExcalidrawElement)).toEqual([ "x" ]);
        expect(getChangedKeys(IMAGE, { ...IMAGE, status: "saved" } as ExcalidrawElement))
            .toEqual([]);
        const deleted = { ...ELLIPSE, isDeleted: true };
        expect(getChangedKeys(undefined, deleted)).toEqual([]);
        expect(getChangedKeys(deleted, { ...deleted, x: 1 })).toEqual([]);
        expect(getChangedKeys(undefined, ELLIPSE))
            .toEqual([ "isDeleted", "id", "type", "x", "index" ]);
    });
});

function element(properties: Record<string, unknown>) {
    return { version: 1, isDeleted: false, ...properties } as unknown as ExcalidrawElement;
}

function never() {
    return undefined as never;
}

/** The undo stack of a text note, whose steps run when the spec calls them. */
function createHost() {
    const steps: HostHistoryStep[] = [];
    const enabled: Record<HistoryCommand, boolean> = { undo: false, redo: false };
    const listeners = new Set<() => void>();
    let isLatest = true;
    const host = {
        push: vi.fn((step: HostHistoryStep) => {
            steps.push(step);
            const count = steps.length;
            return { isLatest: () => isLatest && steps.length === count };
        }),
        undo: vi.fn(),
        redo: vi.fn(),
        isEnabled: (name: HistoryCommand) => enabled[name],
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    } satisfies EmbedHostHistory;

    return {
        host,
        steps,
        setLatest: (value: boolean) => {
            isLatest = value;
        },
        setEnabled: (name: HistoryCommand, value: boolean) => {
            enabled[name] = value;
            for (const listener of listeners) listener();
        }
    };
}

/** A read of the saved drawing, which the spec resolves. */
function deferScene() {
    let resolve: (scene: DrawingScene) => void = () => {};
    const promise = new Promise<DrawingScene>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

/** The saved drawing, which shows `elements`. */
function createStore(elements: ExcalidrawElement[]) {
    let saved: DrawingScene = { elements, appState: {}, files: {} };
    const store = {
        read: vi.fn(async () => saved),
        write: vi.fn((scene: DrawingScene) => {
            saved = scene;
        })
    } satisfies DrawingStore;
    return {
        ...store,
        getElements: () => saved.elements,
        setElements: (next: ExcalidrawElement[]) => {
            saved = { ...saved, elements: next };
        }
    };
}

/** An Excalidraw that shows `elements`, in a root with its focusable container. */
function createDrawing(elements: ExcalidrawElement[]) {
    let scene = elements;
    const appState = {
        cursorButton: "up", viewBackgroundColor: "transparent", scrollX: 0, scrollY: 0,
        zoom: { value: 1 }, gridModeEnabled: false
    } as AppState;
    const files: Record<string, BinaryFileData> = {};
    const actions = new Map<string, Action>();
    const root = document.createElement("div");
    const container = document.createElement("div");
    container.className = "excalidraw-container";
    container.tabIndex = 0;
    root.append(container);
    document.body.append(root);

    const api = {
        getSceneElementsIncludingDeleted: () => scene,
        getAppState: () => appState,
        getFiles: () => files,
        addFiles: vi.fn((added: BinaryFileData[]) => {
            for (const file of added) files[file.id] = file;
        }),
        updateScene: vi.fn((data: { elements?: ExcalidrawElement[]; appState?: object }) => {
            scene = data.elements ?? scene;
            Object.assign(appState, data.appState);
        }),
        history: { clear: vi.fn() },
        registerAction: (action: Action) => actions.set(action.name, action)
    };

    return {
        api: api as unknown as ExcalidrawImperativeAPI & typeof api,
        appState,
        files,
        actions,
        root,
        container,
        getElements: () => scene,
        setElements: (next: ExcalidrawElement[]) => {
            scene = next;
        },
        input: (type: string) => container.dispatchEvent(new Event(type, { bubbles: true }))
    };
}
