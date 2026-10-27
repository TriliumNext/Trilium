import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { Action, PanelComponentProps } from "@excalidraw/excalidraw/actions/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import clsx from "clsx";
import { useSyncExternalStore } from "preact/compat";

import { isMac } from "../../../services/utils";
import type { ContentHistory, EmbedHostHistory, HistoryCommand } from "../text/embed_history";
import { useExcalidrawTranslation } from "./CanvasEmbedTools";

/** The view and the settings that the content of a drawing keeps. */
export type SavedAppState = Pick<
    AppState, "scrollX" | "scrollY" | "zoom" | "gridModeEnabled" | "viewBackgroundColor"
>;

/** A drawing as Excalidraw holds it, deleted elements included, or as its content saves it. */
export interface DrawingScene {
    elements: readonly ExcalidrawElement[];
    appState: Partial<SavedAppState>;
    files: BinaryFiles;
}

/** Reads and saves the drawing while no Excalidraw shows it. */
export interface DrawingStore {
    /** The drawing as saved, with the changes that wait for a save. */
    read(): Promise<DrawingScene>;
    write(scene: DrawingScene): void;
}

/** An Excalidraw that shows the drawing, from the moment it starts to load the drawing. */
export interface DrawingMount {
    /**
     * Records the changes of `api` from now on, once it shows the loaded drawing. Input inside
     * `root` marks the changes that the user makes. `store` reads and saves the drawing once no
     * Excalidraw shows it.
     */
    attach(api: ExcalidrawImperativeAPI, root: HTMLElement | null, store: DrawingStore): void;
    /** Records the change of the drawing that Excalidraw ended, if any. */
    record(): void;
    /** Whether this Excalidraw shows the drawing and no other one in the text note does. */
    isOnlyDrawing(): boolean;
    /**
     * Shows `scene`, saved elsewhere, outside the undo history. Before `attach()`, it shows nothing
     * and returns `false`.
     */
    show(scene: DrawingScene): boolean;
    /** Stops recording, before Excalidraw unmounts. */
    detach(): void;
}

/** A change of one element of a drawing. */
export interface ElementChange {
    /** The element before the change, or `undefined` for one that the change created. */
    before: ExcalidrawElement | undefined;
    after: ExcalidrawElement;
    /** The properties that the change sets. */
    keys: string[];
}

/** A change of a drawing, kept as a step of the undo stack of the text note. */
interface DrawingStep {
    changes: Map<string, ElementChange>;
    /** The background before and after the change, when the change sets it. */
    background?: [ string, string ];
    /** The images of the changed elements, for an Excalidraw that has not loaded them. */
    files: BinaryFiles;
}

interface RecordedStep extends DrawingStep {
    entry: { isLatest(): boolean };
}

interface AttachedDrawing {
    api: ExcalidrawImperativeAPI;
    root: HTMLElement | null;
    /** The elements as last recorded, by ID, cloned as Excalidraw changes elements in place. */
    committed: Map<string, ExcalidrawElement>;
    background: string;
    /** Whether the user acted on the drawing since its last recorded change. */
    hasInput: boolean;
    stopListening(): void;
}

/** The properties that Excalidraw sets on its own, which no step records. */
const UNRECORDED_KEYS = new Set([ "version", "versionNonce", "updated", "status" ]);
/** The events with which the user changes a drawing. */
const INPUT_EVENTS = [ "pointerdown", "keydown", "paste", "drop" ] as const;
/** The events with which the user moves on while a step waits, which keep the focus in place. */
const WATCHED_INPUT_EVENTS = [ "keydown", "pointerdown" ] as const;
/** The paths of Excalidraw's icons of undo and redo. */
export const HISTORY_ICON_PATHS: Record<HistoryCommand, string> = {
    undo: "M7.5 10.833 4.167 7.5 7.5 4.167M4.167 7.5h9.166a3.333 3.333 0 0 1 0 6.667H12.5",
    redo: "M12.5 10.833 15.833 7.5 12.5 4.167M15.833 7.5H6.667a3.333 3.333 0 1 0 0 6.667H7.5"
};

/**
 * The undo history of a canvas drawing, kept on the undo stack of the text note that embeds it.
 * Each Excalidraw that shows the drawing records a step once the user ends a change, and its Undo
 * and Redo act on the last change of the note. A step changes every Excalidraw that shows the
 * drawing, or the drawing as saved, through the last `DrawingStore`, while none does.
 */
export default class DrawingHistory {
    /**
     * Counts the steps applied, as they reach the drawing, so that an Excalidraw that loaded
     * before one shows it.
     */
    private revision = 0;
    private readonly drawings = new Set<AttachedDrawing>();
    private store: DrawingStore | undefined;
    /** The steps applied through `store`, which read the drawing one after another. */
    private storeUpdates = Promise.resolve();
    private pendingStoreUpdates = 0;
    private lastStep: RecordedStep | undefined;

    constructor(private readonly host: EmbedHostHistory) {}

    /** A mount for an Excalidraw that loads the drawing now. */
    mount(): DrawingMount {
        const revision = this.revision;
        let drawing: AttachedDrawing | undefined;
        return {
            attach: (api, root, store) => {
                drawing = this.attach(api, root, store, revision);
            },
            record: () => {
                if (drawing) this.record(drawing);
            },
            isOnlyDrawing: () => !!drawing && this.drawings.size === 1,
            show: (scene) => {
                if (!drawing) return false;
                showScene(drawing, scene);
                return true;
            },
            detach: () => {
                if (drawing) this.detach(drawing);
                drawing = undefined;
            }
        };
    }

    private attach(
        api: ExcalidrawImperativeAPI,
        root: HTMLElement | null,
        store: DrawingStore,
        revision: number
    ) {
        const [ other ] = this.drawings;
        const drawing: AttachedDrawing = {
            api,
            root,
            committed: new Map(),
            background: api.getAppState().viewBackgroundColor,
            hasInput: false,
            stopListening: () => {}
        };
        commitElements(drawing);
        api.history.clear();
        api.registerAction(createHistoryAction("undo", this.host));
        api.registerAction(createHistoryAction("redo", this.host));

        if (root) {
            const onInput = () => {
                drawing.hasInput = true;
            };
            for (const type of INPUT_EVENTS) {
                root.addEventListener(type, onInput, { capture: true });
            }
            drawing.stopListening = () => {
                for (const type of INPUT_EVENTS) {
                    root.removeEventListener(type, onInput, { capture: true });
                }
            };
        }

        this.drawings.add(drawing);
        this.store = store;
        // Excalidraw loaded the drawing before a step changed it.
        if (revision !== this.revision) {
            if (other) {
                showScene(drawing, getDrawingScene(other.api));
            } else {
                this.showStoredScene(drawing, store);
            }
        }
        return drawing;
    }

    private detach(drawing: AttachedDrawing) {
        drawing.stopListening();
        this.drawings.delete(drawing);
    }

    /** Shows the drawing of `store` in `drawing` once the steps applied through it saved. */
    private showStoredScene(drawing: AttachedDrawing, store: DrawingStore) {
        this.queueStoreUpdate(async () => {
            const revision = this.revision;
            const scene = await store.read();
            if (revision === this.revision && this.drawings.has(drawing)) {
                showScene(drawing, scene);
            }
        });
    }

    private queueStoreUpdate(update: () => Promise<void>) {
        this.pendingStoreUpdates++;
        this.storeUpdates = this.storeUpdates.then(update).catch((error: unknown) => {
            console.error("Unable to update the canvas drawing", error);
        }).finally(() => {
            this.pendingStoreUpdates--;
        });
    }

    /**
     * Records the changes of `drawing` since its last record, unless the user is still making them.
     * A change that the user did not make, such as an image that finished loading, joins the last
     * step while nothing entered the undo stack after it.
     */
    private record(drawing: AttachedDrawing) {
        const { api } = drawing;
        const appState = api.getAppState();
        if (isInteracting(appState)) return;

        const changes = takeChanges(drawing);
        const step: DrawingStep = { changes, files: getChangedFiles(api, changes) };
        if (appState.viewBackgroundColor !== drawing.background) {
            step.background = [ drawing.background, appState.viewBackgroundColor ];
            drawing.background = appState.viewBackgroundColor;
        }
        if (!changes.size && !step.background) return;

        const isUserChange = drawing.hasInput;
        drawing.hasInput = false;
        // Excalidraw's own history goes unused while the note keeps the steps.
        api.history.clear();
        if (!isUserChange && this.lastStep?.entry.isLatest()) {
            joinStep(this.lastStep, step);
            return;
        }

        const recorded: RecordedStep = { ...step, entry: { isLatest: () => false } };
        recorded.entry = this.host.push({
            undo: () => this.apply(recorded, true),
            redo: () => this.apply(recorded, false)
        });
        this.lastStep = recorded;
    }

    private apply(step: DrawingStep, isUndo: boolean) {
        const [ first ] = this.drawings;
        if (!first && !this.store) {
            return false;
        }

        if (first && !this.pendingStoreUpdates) {
            this.applyToDrawings(step, isUndo);
        } else {
            // Waits for the steps before it, which read the drawing.
            const isShown = !!first;
            const stopWatchingInput = watchInput();
            this.queueStoreUpdate(async () => {
                try {
                    const { store } = this;
                    if (store && (!isShown || !this.drawings.size)) {
                        // Applies to the drawing as saved, which can have changed elsewhere since.
                        store.write(applyToScene(await store.read(), step, isUndo));
                    }
                    // An Excalidraw that attached meanwhile loaded the drawing before the step.
                    // Focus stays where the user went meanwhile.
                    this.applyToDrawings(step, isUndo, !stopWatchingInput());
                } finally {
                    stopWatchingInput();
                }
            });
        }
        return true;
    }

    /**
     * Applies `step` to every Excalidraw that shows the drawing, and focuses the first unless
     * `isFocusing` is false.
     */
    private applyToDrawings(step: DrawingStep, isUndo: boolean, isFocusing = true) {
        for (const drawing of this.drawings) {
            applyToDrawing(drawing, step, isUndo);
        }
        this.revision++;

        const [ first ] = this.drawings;
        if (first && isFocusing) {
            // Deferred until after the Undo button of the toolbar focuses the text editor.
            queueMicrotask(() => {
                first.root?.querySelector<HTMLElement>(".excalidraw-container")?.focus();
            });
        }
    }
}

/** The history of the drawing of `history`, which the first call creates. */
export function getDrawingHistory(history: ContentHistory) {
    history.drawing ??= new DrawingHistory(history.host);
    return history.drawing;
}

/**
 * `elements` with the changes undone, or made again, in the order of their fractional indices. An
 * element that `elements` lacks, as one that was deleted before the drawing saved, comes back from
 * the change.
 */
export function applyChanges(
    elements: readonly ExcalidrawElement[],
    changes: ReadonlyMap<string, ElementChange>,
    isUndo: boolean
) {
    const missing = new Map(changes);
    const result: ExcalidrawElement[] = [];
    for (const element of elements) {
        const change = missing.get(element.id);
        missing.delete(element.id);
        result.push(change ? applyChange(element, change, isUndo) : element);
    }

    for (const change of missing.values()) {
        const target = isUndo ? change.before : change.after;
        if (target && !target.isDeleted) {
            insertByIndex(result, newElementWith(structuredClone(target), {}, true));
        }
    }
    if ([ ...changes.values() ].some(({ keys }) => keys.includes("index"))) {
        sortByIndex(result);
    }
    return result;
}

/**
 * The properties that differ between `before` and `after`, those that Excalidraw sets on its own
 * left out. None for an element that is deleted on both sides.
 */
export function getChangedKeys(before: ExcalidrawElement | undefined, after: ExcalidrawElement) {
    if (after.isDeleted && (!before || before.isDeleted)) {
        return [];
    }

    const beforeValues: Record<string, unknown> = before ?? {};
    const afterValues: Record<string, unknown> = after;
    const keys = new Set([ ...Object.keys(beforeValues), ...Object.keys(afterValues) ]);
    return [ ...keys ].filter((key) => !UNRECORDED_KEYS.has(key)
        && JSON.stringify(beforeValues[key]) !== JSON.stringify(afterValues[key]));
}

/** Whether the user is in the middle of a change, which Excalidraw has yet to end. */
export function isInteracting(appState: AppState) {
    return appState.cursorButton === "down"
        || appState.isResizing
        || appState.isRotating
        || appState.selectedElementsAreBeingDragged
        || !!(appState.newElement || appState.multiElement || appState.resizingElement
            || appState.selectionElement || appState.editingTextElement
            || appState.pendingImageElementId);
}

/** Takes the elements that changed since the last call as recorded, and returns their changes. */
function takeChanges(drawing: AttachedDrawing) {
    const changes = new Map<string, ElementChange>();
    for (const [ before, after ] of commitElements(drawing)) {
        const keys = getChangedKeys(before, after);
        if (keys.length) {
            changes.set(after.id, { before, after, keys });
        }
    }
    return changes;
}

/**
 * Takes the elements that changed since the last call as recorded, and returns each with the
 * element that it replaces, if any.
 */
function commitElements(drawing: AttachedDrawing) {
    const committed: [ ExcalidrawElement | undefined, ExcalidrawElement ][] = [];
    for (const element of drawing.api.getSceneElementsIncludingDeleted()) {
        const before = drawing.committed.get(element.id);
        if (before?.version === element.version) continue;

        const after = structuredClone(element);
        drawing.committed.set(element.id, after);
        committed.push([ before, after ]);
    }
    return committed;
}

/** Adds the changes of `next`, which follow those of `step`, to `step`. */
function joinStep(step: DrawingStep, next: DrawingStep) {
    for (const [ id, change ] of next.changes) {
        const joined = step.changes.get(id);
        if (joined) {
            joined.after = change.after;
            joined.keys = getChangedKeys(joined.before, change.after);
        } else {
            step.changes.set(id, change);
        }
    }
    if (next.background) {
        step.background = [ step.background?.[0] ?? next.background[0], next.background[1] ];
    }
    Object.assign(step.files, next.files);
}

function applyToDrawing(drawing: AttachedDrawing, step: DrawingStep, isUndo: boolean) {
    const { api } = drawing;
    const background = step.background?.[isUndo ? 0 : 1];
    addMissingFiles(api, step.files);
    api.updateScene({
        elements: applyChanges(api.getSceneElementsIncludingDeleted(), step.changes, isUndo),
        ...(background !== undefined && { appState: { viewBackgroundColor: background } }),
        captureUpdate: CaptureUpdateAction.NEVER
    });
    // Excalidraw renders the new app state later, but replaces the elements at once.
    commitElements(drawing);
    drawing.background = background ?? drawing.background;
    drawing.hasInput = false;
}

/**
 * Watches for keys and pointers pressed anywhere in the page, until the returned call, which tells
 * whether the user pressed any.
 */
function watchInput() {
    let hasInput = false;
    const onInput = () => {
        hasInput = true;
    };
    for (const type of WATCHED_INPUT_EVENTS) {
        document.addEventListener(type, onInput, { capture: true });
    }
    return () => {
        for (const type of WATCHED_INPUT_EVENTS) {
            document.removeEventListener(type, onInput, { capture: true });
        }
        return hasInput;
    };
}

/** Shows `scene` in `drawing`, outside the undo history. */
function showScene(drawing: AttachedDrawing, scene: DrawingScene) {
    const background = scene.appState.viewBackgroundColor ?? drawing.background;
    showDrawingScene(drawing.api, {
        ...scene,
        appState: { ...scene.appState, viewBackgroundColor: background }
    });
    commitElements(drawing);
    drawing.background = background;
}

/**
 * Shows `scene` in `api`, outside Excalidraw's undo history, with the background and the grid that
 * the scene sets, if any. The view stays where it is.
 */
export function showDrawingScene(api: ExcalidrawImperativeAPI, scene: DrawingScene) {
    const shown = api.getAppState();
    addMissingFiles(api, scene.files);
    api.updateScene({
        elements: scene.elements,
        appState: {
            viewBackgroundColor: scene.appState.viewBackgroundColor ?? shown.viewBackgroundColor,
            gridModeEnabled: scene.appState.gridModeEnabled ?? shown.gridModeEnabled
        },
        captureUpdate: CaptureUpdateAction.NEVER
    });
}

function applyToScene(scene: DrawingScene, step: DrawingStep, isUndo: boolean): DrawingScene {
    const background = step.background?.[isUndo ? 0 : 1];
    return {
        elements: applyChanges(scene.elements, step.changes, isUndo),
        appState: background === undefined
            ? scene.appState
            : { ...scene.appState, viewBackgroundColor: background },
        files: { ...step.files, ...scene.files }
    };
}

/** `element` with the properties that `change` sets, from before or after it. */
function applyChange(element: ExcalidrawElement, change: ElementChange, isUndo: boolean) {
    const target: Record<string, unknown> | undefined = isUndo ? change.before : change.after;
    if (!target) {
        return newElementWith(element, { isDeleted: true });
    }

    const updates: Record<string, unknown> = {};
    for (const key of change.keys) {
        // A copy, as Excalidraw can change the arrays of an element in place.
        updates[key] = structuredClone(target[key]);
    }
    return newElementWith(element, updates);
}

/** Inserts `element` into `elements` before the first one above it, by the fractional index. */
function insertByIndex(elements: ExcalidrawElement[], element: ExcalidrawElement) {
    const { index } = element;
    const position = index === null
        ? -1
        : elements.findIndex((other) => other.index !== null && other.index > index);
    if (position < 0) {
        elements.push(element);
    } else {
        elements.splice(position, 0, element);
    }
}

/**
 * Orders `elements` by their fractional indices, as Excalidraw stacks them, unless one has none.
 * Excalidraw would otherwise give the elements new indices in the order of the array.
 */
function sortByIndex(elements: ExcalidrawElement[]) {
    if (elements.some(({ index }) => index === null)) return;

    elements.sort((first, second) => {
        const [ a, b ] = [ first.index ?? "", second.index ?? "" ];
        return a < b ? -1 : a > b ? 1 : 0;
    });
}

/** The images of the elements in `changes` that `api` has loaded. */
function getChangedFiles(api: ExcalidrawImperativeAPI, changes: Map<string, ElementChange>) {
    const loaded = api.getFiles();
    const files: BinaryFiles = {};
    for (const { after } of changes.values()) {
        const fileId = "fileId" in after ? after.fileId : null;
        if (fileId && loaded[fileId]) {
            files[fileId] = loaded[fileId];
        }
    }
    return files;
}

function addMissingFiles(api: ExcalidrawImperativeAPI, files: BinaryFiles) {
    const loaded = api.getFiles();
    const missing = Object.values(files).filter((file) => !loaded[file.id]);
    if (missing.length) {
        api.addFiles(missing);
    }
}

/** The drawing that `api` shows. */
function getDrawingScene(api: ExcalidrawImperativeAPI): DrawingScene {
    const { scrollX, scrollY, zoom, gridModeEnabled, viewBackgroundColor } = api.getAppState();
    return {
        elements: api.getSceneElementsIncludingDeleted(),
        appState: { scrollX, scrollY, zoom, gridModeEnabled, viewBackgroundColor },
        files: api.getFiles()
    };
}

/**
 * Excalidraw's undo or redo, as its keys and its button run it, which undoes or redoes the last
 * change of the text note instead.
 */
function createHistoryAction(name: HistoryCommand, host: EmbedHostHistory): Action {
    return {
        name,
        label: `buttons.${name}`,
        trackEvent: false,
        perform: (_elements, appState) => {
            if (!isInteracting(appState)) {
                host[name]();
            }
            return false;
        },
        keyTest: name === "undo" ? isUndoKey : isRedoKey,
        // Excalidraw types its components with React's types, which Preact's do not satisfy.
        PanelComponent: (({ updateData, data }: PanelComponentProps) => (
            <HistoryButton
                name={name}
                host={host}
                size={data?.size ?? "medium"}
                onClick={() => updateData()}
            />
        )) as unknown as Action["PanelComponent"]
    };
}

interface HistoryButtonProps {
    name: HistoryCommand;
    host: EmbedHostHistory;
    /** The size of Excalidraw's `ToolButton`, such as `medium`. */
    size: string;
    onClick: () => void;
}

/** Excalidraw's undo or redo button, enabled while the text note can undo or redo. */
function HistoryButton({ name, host, size, onClick }: HistoryButtonProps) {
    const { t } = useExcalidrawTranslation();
    const isEnabled = useSyncExternalStore(host.subscribe, () => host.isEnabled(name));

    return (
        <button
            type="button"
            className={clsx(
                "ToolIcon_type_button", `ToolIcon_size_${size}`, "ToolIcon_type_button--show",
                "ToolIcon"
            )}
            aria-label={t(`buttons.${name}`)}
            data-testid={`button-${name}`}
            disabled={!isEnabled}
            onClick={onClick}
        >
            <div className="ToolIcon__icon" aria-hidden="true" aria-disabled={!isEnabled}>
                <svg
                    aria-hidden="true"
                    focusable="false"
                    role="img"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d={HISTORY_ICON_PATHS[name]} stroke-width="1.25" />
                </svg>
            </div>
        </button>
    );
}

interface KeyEvent {
    key: string;
    code: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
}

/** Ctrl+Z, or ⌘Z on macOS. */
function isUndoKey(event: KeyEvent) {
    return hasCommandKey(event) && !event.shiftKey && matchesKey(event, "z");
}

/** Ctrl+Y or Ctrl+Shift+Z, or ⌘Y or ⌘⇧Z on macOS, as in the text note. */
function isRedoKey(event: KeyEvent) {
    return hasCommandKey(event) && matchesKey(event, event.shiftKey ? "z" : "y");
}

function hasCommandKey(event: KeyEvent) {
    return isMac() ? event.metaKey : event.ctrlKey;
}

/**
 * Whether `event` presses the Latin letter `key`, or the key in its place on the keyboard of a
 * layout without Latin letters, as Excalidraw matches its shortcuts.
 */
function matchesKey(event: KeyEvent, key: string) {
    return event.key.toLowerCase() === key
        || (!/^[a-z]$/i.test(event.key) && event.code === `Key${key.toUpperCase()}`);
}
