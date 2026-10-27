import {
    CaptureUpdateAction, exportToSvg, getSceneVersion, restoreElements
} from "@excalidraw/excalidraw";
import {
    ExcalidrawElement, ExcalidrawFreeDrawElement, NonDeletedExcalidrawElement
} from "@excalidraw/excalidraw/element/types";
import {
    AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState,
    ExcalidrawProps, LibraryItem
} from "@excalidraw/excalidraw/types";
import { deferred, type DeferredPromise, getDrawingPictureTitle } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import froca from "../../../services/froca";
import options from "../../../services/options";
import server from "../../../services/server";
import {
    SavedData, useEditorSpacedUpdate, useTriliumEvent, useWhenShown
} from "../../react/hooks";
import {
    type DrawingScene, getDrawingHistory, isInteracting, type SavedAppState, showDrawingScene
} from "./drawing_history";
import { type DrawingView, getBoundedView, getFittedView } from "./drawing_view";
import {
    buildNewImageAttachments, CANVAS_EXPORT_TITLE, IMAGE_ROLE, loadImageAttachments, loadImageFiles
} from "./image_attachments";
import { schedulePicture, watchPictures } from "./picture_schedule";

interface AttachmentMetadata {
    title: string;
    attachmentId: string;
}

export interface CanvasContent {
    elements: ExcalidrawElement[];
    files: BinaryFileData[];
    appState: Partial<AppState>;
}

/** Subset of the app state that should be persisted whenever they change. This explicitly excludes transient state like the current selection or zoom level. */
type ImportantAppState = Pick<AppState, "gridModeEnabled" | "viewBackgroundColor">;

/** The part of a scene that its picture shows. */
type PictureScene = Pick<DrawingScene, "elements" | "appState">;

/** A point of a pen stroke, relative to the stroke. */
type StrokePoint = ExcalidrawFreeDrawElement["points"][number];

/**
 * How long the saves of a canvas note pause before its picture is drawn, in ms. Previews in the app
 * show the picture.
 */
const NOTE_PICTURE_DELAY = 5000;
/**
 * How long the saves of a canvas drawing pause before its picture is drawn, in ms. Only shared
 * pages show the picture.
 */
const DRAWING_PICTURE_DELAY = 30000;

export default function useCanvasPersistence(note: FNote, noteContext: NoteContext | null | undefined, apiRef: RefObject<ExcalidrawImperativeAPI | null>, theme: AppState["theme"], isReadOnly: boolean): Partial<ExcalidrawProps> {
    const libraryChanged = useRef(false);

    /**
     * needed to ensure, that multipleOnChangeHandler calls do not trigger a save.
     * we compare the scene version as suggested in:
     * https://github.com/excalidraw/excalidraw/issues/3014#issuecomment-778115329
     *
     * info: sceneVersions are not incrementing. it seems to be a pseudo-random number
     */
    const currentSceneVersion = useRef(0);

    // these 2 variables are needed to compare the library state (all library items) after loading to the state when the library changed. So we can find attachments to be deleted.
    //every libraryitem is saved on its own json file in the attachments of the note.
    const libraryCache = useRef<LibraryItem[]>([]);
    const attachmentMetadata = useRef<AttachmentMetadata[]>([]);

    // fileIds of images this session owns as attachments (loaded at start + uploaded this session).
    // Drives both skip-reupload and orphan cleanup: an owned fileId no longer on the canvas marks
    // its attachment for deletion (mirrors the library-item cleanup above).
    const persistedImageFileIds = useRef<Set<string>>(new Set());

    // The note being loaded by the latest onContentChange. Async loads below capture the id they
    // started for and bail if the user switched notes before they resolved, so a stale load can't
    // inject the previous note's images or overwrite the new note's owned-fileId set.
    const activeNoteIdRef = useRef<string | null>(null);

    const appStateToCompare = useRef<Partial<ImportantAppState>>({});

    // The first content load must go through Excalidraw's `initialData` promise, not
    // `updateScene`: Excalidraw's async mount initialization RESETS the scene when it
    // completes, and it hands out the imperative API before that reset lands. Anything
    // loaded via `updateScene` in that window is wiped — and the wipe then looks like a
    // user edit and gets saved over the note (#10279). Excalidraw awaits this promise and
    // applies its value as part of that very reset, so the first load cannot be clobbered.
    const initialDataRef =
        useRef<DeferredPromise<ExcalidrawInitialDataState | null> | undefined>(undefined);
    if (!initialDataRef.current) {
        initialDataRef.current = deferred<ExcalidrawInitialDataState | null>();
    }
    const initialData = initialDataRef.current;

    // Whether `initialData` has been resolved; until then every incoming content belongs to
    // the initial load (latest one wins via the run counter below).
    const initialDataResolvedRef = useRef(false);
    const initialLoadRunRef = useRef(0);

    // False from resolving `initialData` with a non-empty scene until Excalidraw has actually
    // applied it. In that window the scene is still empty, so `onChange` must not interpret
    // it as "the user deleted everything" and schedule a save.
    const initialSceneAppliedRef = useRef(true);
    const canSavePicture = !isReadOnly && !options.is("databaseReadonly");

    async function loadInitialContent(newContent: string) {
        const runId = ++initialLoadRunRef.current;
        const loadedNoteId = note.noteId;
        activeNoteIdRef.current = loadedNoteId;

        const content = parseContent(newContent, note);
        const elements = restoreLoadedElements(content.elements);

        // Legacy notes carry inline images in `content.files` (a fileId-keyed record);
        // current notes store them as attachments. Both go into `initialData.files`.
        const files: BinaryFiles = {};
        for (const file of Object.values(content.files ?? {})) {
            files[file.id] = file;
        }

        try {
            const [ imageResult, libraryResult ] = await Promise.all([ loadImageAttachments(note), loadLibrary(note) ]);
            if (initialLoadRunRef.current !== runId) return; // superseded by a newer load

            for (const file of imageResult.files) {
                files[file.id] = file;
            }
            persistedImageFileIds.current = new Set(imageResult.metadata.map((m) => m.fileId));

            libraryCache.current = libraryResult.libraryItems;
            attachmentMetadata.current = libraryResult.metadata;

            const expectedSceneVersion = getSceneVersion(elements);
            currentSceneVersion.current = expectedSceneVersion;
            initialSceneAppliedRef.current = expectedSceneVersion === 0;
            initialDataResolvedRef.current = true;

            initialData.resolve({
                elements,
                appState: { ...content.appState, theme },
                files,
                libraryItems: libraryResult.libraryItems
            });
            if (canSavePicture) {
                void refreshNotePicture(note, { elements, appState: content.appState }, files,
                    () => currentSceneVersion.current === expectedSceneVersion);
            }
        } catch (err) {
            console.error("Failed to prepare initial canvas data", err);
            if (initialLoadRunRef.current !== runId) return;
            initialDataResolvedRef.current = true;
            initialSceneAppliedRef.current = true;
            // Resolve anyway so Excalidraw does not stay on its loading screen forever.
            initialData.resolve({
                elements,
                appState: { ...content.appState, theme },
                files
            });
        }
    }

    // Content that arrived after the initial load but before the imperative API was
    // available (defensive; replayed by the `excalidrawAPI` callback below).
    const pendingContentRef = useRef<string | null>(null);

    function loadContent(api: ExcalidrawImperativeAPI, newContent: string) {
        libraryCache.current = [];
        attachmentMetadata.current = [];
        persistedImageFileIds.current = new Set();

        // The note this load run belongs to; async results below are ignored if it's superseded.
        const loadedNoteId = note.noteId;
        activeNoteIdRef.current = loadedNoteId;

        const content = parseContent(newContent, note);

        loadData(api, content, theme);

        // Initialize tracking state after loading to prevent redundant updates from initial
        // onChange events
        currentSceneVersion.current = getSceneVersion(api.getSceneElements());
        const loadedSceneVersion = currentSceneVersion.current;

        // Images live as attachments (titled with their fileId); fetch them, rebuild their
        // data URLs and inject them so elements referencing those fileIds render. Legacy notes
        // that still carry inline images in `content.files` were already loaded by loadData().
        loadImageAttachments(note).then(({ files, metadata }) => {
            if (activeNoteIdRef.current !== loadedNoteId) return; // note switched mid-load
            if (files.length > 0) {
                api.addFiles(files);
            }
            persistedImageFileIds.current = new Set(metadata.map((m) => m.fileId));

            if (canSavePicture) {
                const allFiles: BinaryFiles = {};
                for (const file of [ ...Object.values(content.files ?? {}), ...files ]) {
                    allFiles[file.id] = file;
                }
                void refreshNotePicture(note, content, allFiles,
                    () => currentSceneVersion.current === loadedSceneVersion);
            }
        });

        // load the library state
        loadLibrary(note).then(({ libraryItems, metadata }) => {
            if (activeNoteIdRef.current !== loadedNoteId) return; // note switched mid-load
            // Update the library and save to independent variables
            api.updateLibrary({ libraryItems, merge: false });

            // save state of library to compare it to the new state later.
            libraryCache.current = libraryItems;
            attachmentMetadata.current = metadata;
        });
    }

    // Latest-render closure over `note`/`theme` for the replay: `excalidrawAPI` fires only once
    // per Excalidraw mount, so it must not load through the closure it captured back then if
    // the user switched notes before the API arrived.
    const loadContentRef = useRef(loadContent);
    loadContentRef.current = loadContent;

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "canvas",
        onContentChange(newContent) {
            // The first content belongs to Excalidraw's mount initialization and must be
            // routed through `initialData` (see above), never through `updateScene`.
            if (!initialDataResolvedRef.current) {
                void loadInitialContent(newContent); // errors handled internally
                return;
            }

            const api = apiRef.current;
            if (!api) {
                pendingContentRef.current = newContent;
                return;
            }

            pendingContentRef.current = null;
            loadContent(api, newContent);
        },
        async getData() {
            const api = apiRef.current;
            if (!api) return;
            const elements = api.getSceneElements();
            const appState = api.getAppState();
            const files = api.getFiles();
            appStateToCompare.current = getImportantAppState(appState);

            // Images are persisted as attachments (keyed by fileId), not inline, so the content
            // stays small. Elements keep their `fileId`; the bytes are reattached on load. Kept as
            // an empty object for shape compatibility with loadData() and legacy content.
            const content = buildSceneContent(elements, appState, {});
            const attachments: SavedData["attachments"] = [];

            // Persist newly inserted images as attachments. `content` carries only the fileId
            // references, so the bytes live here. Removed images are not deleted from
            // the client: the server's saveLinks/checkImageAttachments scans the saved scene JSON and
            // schedules now-unreferenced image attachments for erasure (same as the spreadsheet).
            const activeFiles = getActiveFiles(elements, files);
            for (const attachment of buildNewImageAttachments(activeFiles, persistedImageFileIds.current)) {
                attachments.push(attachment);
                persistedImageFileIds.current.add(attachment.title);
            }

            // libraryChanged is unset in dataSaved()
            if (libraryChanged.current) {
                // there's no separate method to get library items, so have to abuse this one
                const libraryItems = await api.updateLibrary({
                    libraryItems() {
                        return [];
                    },
                    merge: true
                });

                // excalidraw saves the library as a own state. the items are saved to libraryItems. then we compare the library right now with a libraryitemcache. The cache is filled when we first load the Library into the note.
                //We need the cache to delete old attachments later in the server.

                const libraryItemsMissmatch = libraryCache.current.filter((obj1) => !libraryItems.some((obj2: LibraryItem) => obj1.id === obj2.id));

                // before we saved the metadata of the attachments in a cache. the title of the attachment is a combination of libraryitem  ´s ID und it´s name.
                // we compare the library items in the libraryitemmissmatch variable (this one saves all libraryitems that are different to the state right now. E.g. you delete 1 item, this item is saved as mismatch)
                // then we combine its id and title and search the according attachmentID.

                const matchingItems = attachmentMetadata.current.filter((meta) => {
                    // Loop through the second array and check for a match
                    return libraryItemsMissmatch.some((item) => {
                        // Combine the `name` and `id` from the second array
                        const combinedTitle = `${item.id}${item.name}`;
                        return meta.title === combinedTitle;
                    });
                });

                // we save the attachment ID`s in a variable and delete every attachmentID. Now the items that the user deleted will be deleted.
                const attachmentIds = matchingItems.map((item) => item.attachmentId);

                //delete old attachments that are no longer used
                for (const item of attachmentIds) {
                    await server.remove(`attachments/${item}`);
                }

                let position = 10;

                // prepare data to save to server e.g. new library items.
                for (const libraryItem of libraryItems) {
                    attachments.push({
                        role: "canvasLibraryItem",
                        title: libraryItem.id + libraryItem.name,
                        mime: "application/json",
                        content: JSON.stringify(libraryItem),
                        position
                    });

                    position += 10;
                }
            }

            const data = { content: JSON.stringify(content), attachments };
            savedScenes.set(data, { noteId: note.noteId, scene: content, files });
            return data;
        },
        dataSaved(data) {
            libraryChanged.current = false;
            const saved = savedScenes.get(data);
            if (saved) {
                scheduleNotePicture(saved.noteId, saved.scene, saved.files);
            }
        }
    });

    return {
        initialData,
        excalidrawAPI: (api) => {
            const pendingContent = pendingContentRef.current;
            apiRef.current = api;

            // Flush content that arrived while the API was unavailable (#10279).
            if (pendingContent !== null) {
                pendingContentRef.current = null;
                loadContentRef.current(api, pendingContent);
            }
        },
        onChange: (_elements, appState) => {
            if (!apiRef.current || isReadOnly) return;
            const oldSceneVersion = currentSceneVersion.current;
            const newSceneVersion = getSceneVersion(apiRef.current.getSceneElements());

            // Excalidraw's mount initialization has not applied `initialData` yet: the scene
            // is still empty, and saving it would wipe the note. A non-zero version is the
            // signal that the initial content has landed.
            if (!initialSceneAppliedRef.current) {
                if (newSceneVersion === 0) {
                    return;
                }
                initialSceneAppliedRef.current = true;
            }

            let hasChanges = (newSceneVersion !== oldSceneVersion);

            // There are cases where the scene version does not change, but appState did.
            if (!hasChanges) {
                const importantAppState = appStateToCompare.current;
                const currentAppState = apiRef.current.getAppState();
                for (const key in importantAppState) {
                    if (importantAppState[key as keyof ImportantAppState] !== currentAppState[key as keyof ImportantAppState]) {
                        hasChanges = true;
                        break;
                    }
                }
            }

            if (hasChanges) {
                spacedUpdate.resetUpdateTimer();
                // Excalidraw reports each move of a drag: the save waits until the pointer is up.
                if (appState.cursorButton !== "down") {
                    spacedUpdate.scheduleUpdate();
                    currentSceneVersion.current = newSceneVersion;
                }
            }
        },
        onLibraryChange: (libraryItems) => {
            if (!apiRef.current || isReadOnly) return;

            // Check if library actually changed by comparing with cached state
            const hasChanges =
                libraryItems.length !== libraryCache.current.length ||
                libraryItems.some(item => {
                    const cachedItem = libraryCache.current.find(cached => cached.id === item.id);
                    return !cachedItem || cachedItem.name !== item.name;
                });

            if (hasChanges) {
                libraryChanged.current = true;
                spacedUpdate.resetUpdateTimer();
                spacedUpdate.scheduleUpdate();
            }
        }
    };
}

interface DrawingPersistenceOptions {
    /** The view to open the drawing at, instead of the saved one. */
    initialView?: DrawingView | null;
    /** Called once Excalidraw shows the loaded scene. */
    onSceneShown?: () => void;
    /**
     * The element that holds Excalidraw. The undo history of the note watches input in it, and a
     * save made elsewhere shows once it is shown.
     */
    rootRef?: RefObject<HTMLElement | null>;
}

/**
 * Loads a canvas drawing from an attachment and passes its changes to `editor`, which saves them.
 * Without `editor`, the drawing is read-only.
 */
export function useCanvasDrawingPersistence(
    attachment: FAttachment,
    editor: ContentEditor | undefined,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    theme: AppState["theme"],
    { initialView, onSceneShown, rootRef }: DrawingPersistenceOptions = {}
): Partial<ExcalidrawProps> {
    const currentSceneVersion = useRef(0);
    /** The saved part of the app state, read from the editor at the first change. */
    const appStateToCompare = useRef<ImportantAppState | null>(null);
    // Same guard as the canvas note: the scene is empty until Excalidraw applies `initialData`.
    const initialSceneAppliedRef = useRef(true);
    const referencedFileIds = useRef<ReadonlySet<string>>(new Set());
    const isFitPendingRef = useRef(false);
    /** Whether the loaded scene shows nothing, known once it loads. */
    const isLoadedSceneEmptyRef = useRef(false);
    const isSceneShownRef = useRef(false);

    const [ initialData ] = useState(async (): Promise<ExcalidrawInitialDataState> => {
        const unsavedContent = editor?.getUnsavedContent();
        const blobContent = unsavedContent === undefined
            ? (await attachment.getBlob())?.content ?? ""
            : unsavedContent;
        const content = parseContent(blobContent, attachment);
        const loaded = await loadDrawingFiles(attachment, content);
        referencedFileIds.current = loaded.referencedFileIds;

        const elements = restoreLoadedElements(content.elements);
        currentSceneVersion.current = getSceneVersion(elements);
        initialSceneAppliedRef.current = currentSceneVersion.current === 0;
        isLoadedSceneEmptyRef.current = !elements.some((element) => !element.isDeleted);
        isFitPendingRef.current = !initialView && !content.appState?.zoom
            && !isLoadedSceneEmptyRef.current;
        // With unsaved changes, their save schedules the picture.
        if (editor?.canEdit() && unsavedContent === undefined && !isLoadedSceneEmptyRef.current) {
            const loadedVersion = currentSceneVersion.current;
            void refreshDrawingPicture(attachment, blobContent, loaded.files,
                () => currentSceneVersion.current === loadedVersion);
        }

        return {
            elements,
            // A drawing shows the background of the note unless one is picked for it.
            appState: {
                viewBackgroundColor: "transparent", ...content.appState, ...initialView, theme
            },
            files: loaded.files
        };
    });
    // Created with the load above, so that a step applied while Excalidraw loads reaches it.
    const [ drawingMount ] = useState(() =>
        editor?.history && getDrawingHistory(editor.history).mount());

    // A layout cleanup runs during the unmount, before Excalidraw's `componentWillUnmount()` empties
    // the scene that `detach()` and `release()` read; a passive one runs after paint.
    useLayoutEffect(() => () => drawingMount?.detach(), [ drawingMount ]);
    useLayoutEffect(() => () => editor?.release(), [ editor ]);

    /**
     * Whether a save of the drawing waits until Excalidraw shows the loaded scene, or until the
     * user ends a change.
     */
    const isSaveWaitingRef = useRef(false);
    const showRequestRef = useRef(0);
    const whenShown = useWhenShown(rootRef);

    /** Reads the saved drawing now, and shows it once `rootRef` is shown. */
    async function loadSavedDrawing() {
        if (!apiRef.current || !isSceneShownRef.current) {
            isSaveWaitingRef.current = true;
            return;
        }
        isSaveWaitingRef.current = false;
        const request = ++showRequestRef.current;
        const blob = await attachment.getBlob();
        if (blob && request === showRequestRef.current) {
            whenShown(() => void showSavedDrawing(blob.content ?? "", request));
        }
    }

    /**
     * Shows `savedContent`, the saved drawing, in place. Does nothing while `editor` has unsaved
     * changes of the drawing: they replace the saved drawing when they save.
     */
    async function showSavedDrawing(savedContent: string, request: number) {
        const api = apiRef.current;
        const isCurrent = () => request === showRequestRef.current && apiRef.current === api
            && editor?.getUnsavedContent() === undefined;
        if (!api || !isCurrent()) return;
        // The save waits until the user ends the change in progress.
        const isUserChanging = () => {
            if (!isInteracting(api.getAppState())) return false;
            isSaveWaitingRef.current = true;
            return true;
        };
        if (isUserChanging()) return;

        const content = parseContent(savedContent, attachment);
        const elements = restoreLoadedElements(content.elements);
        const appState: ImportantAppState = {
            gridModeEnabled: content.appState?.gridModeEnabled ?? false,
            viewBackgroundColor: content.appState?.viewBackgroundColor ?? "transparent"
        };
        const shownAppState = getImportantAppState(api.getAppState());
        // A restore deletes an empty text element, so the shown elements are restored as well.
        if (isSameScene(restoreLoadedElements(api.getSceneElements()), elements)
            && appState.gridModeEnabled === shownAppState.gridModeEnabled
            && appState.viewBackgroundColor === shownAppState.viewBackgroundColor) {
            return;
        }

        const shownFiles = api.getFiles();
        const loaded = await loadDrawingFiles(attachment, {
            ...content,
            elements: elements.filter((element) =>
                "fileId" in element && element.fileId && !shownFiles[element.fileId])
        });
        if (!isCurrent() || isUserChanging()) return;

        referencedFileIds.current = new Set([
            ...referencedFileIds.current, ...loaded.referencedFileIds
        ]);
        const scene = { elements, appState, files: loaded.files };
        if (!drawingMount?.show(scene)) {
            showDrawingScene(api, scene);
        }
        // Excalidraw replaces the elements at once and renders the app state later.
        currentSceneVersion.current = getSceneVersion(api.getSceneElements());
        appStateToCompare.current = appState;
    }

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        // While no other Excalidraw of the text note shows the drawing, the saves of `editor` come
        // from this one, which shows them already.
        const isOnlyDrawing = !drawingMount || drawingMount.isOnlyDrawing();
        const rows = loadResults.getAttachmentRows(isOnlyDrawing ? editor?.componentId : undefined);
        const isSaved = rows.some((row) =>
            row.attachmentId === attachment.attachmentId && !row.isDeleted);
        if (isSaved) {
            void loadSavedDrawing();
        }
    });

    return {
        initialData,
        excalidrawAPI: (api) => {
            apiRef.current = api;
        },
        onChange: (elements, state) => {
            const api = apiRef.current;
            // Excalidraw reports its size only once the drawing is laid out in the note.
            const fitted = isFitPendingRef.current
                && getFittedView(elements, state.width, state.height);
            if (fitted) isFitPendingRef.current = false;
            const view = fitted || getBoundedView(elements, state);
            if (api && view) api.updateScene({ appState: view });
            if (!api) return;

            const sceneVersion = getSceneVersion(api.getSceneElements());
            if (!isSceneShownRef.current && (isLoadedSceneEmptyRef.current || sceneVersion)) {
                isSceneShownRef.current = true;
                drawingMount?.attach(api, rootRef?.current ?? null, {
                    read: () => readDrawing(attachment, editor),
                    write: (scene) => editor?.scheduleSave(
                        () => serializeDrawing(scene, referencedFileIds.current),
                        (content) => scheduleDrawingPicture(attachment, content, scene.files)
                    )
                });
                onSceneShown?.();
            }
            if (isSaveWaitingRef.current && isSceneShownRef.current
                && !isInteracting(api.getAppState())) {
                void loadSavedDrawing();
            }
            if (!editor) return;

            if (!initialSceneAppliedRef.current) {
                if (sceneVersion === 0) return;
                initialSceneAppliedRef.current = true;
            }
            drawingMount?.record();

            // Each change postpones the save, as in a canvas note. Excalidraw reports each move of
            // a drag, so the save waits until the pointer is up.
            if (state.cursorButton === "down") {
                if (sceneVersion !== currentSceneVersion.current) editor.postponeSave?.();
                return;
            }

            const appState = getImportantAppState(api.getAppState());
            const previousAppState = appStateToCompare.current;
            appStateToCompare.current = appState;
            const isAppStateChanged = !!previousAppState
                && (previousAppState.gridModeEnabled !== appState.gridModeEnabled
                    || previousAppState.viewBackgroundColor !== appState.viewBackgroundColor);
            if (sceneVersion === currentSceneVersion.current && !isAppStateChanged) return;

            currentSceneVersion.current = sceneVersion;
            editor.postponeSave?.();
            editor.scheduleSave(
                () => serializeDrawing({
                    elements: api.getSceneElements(),
                    appState: api.getAppState(),
                    files: api.getFiles()
                }, referencedFileIds.current),
                (content) => scheduleDrawingPicture(attachment, content, api.getFiles())
            );
        }
    };
}

/**
 * The images of the canvas drawing in `content`: the ones it keeps inline, and the ones it refers
 * to by file ID, which the note that owns `entity` keeps as image attachments titled with that ID.
 * `referencedFileIds` lists the latter.
 */
export async function loadDrawingFiles(
    entity: FNote | Pick<FAttachment, "ownerId">,
    content: CanvasContent
) {
    const files: BinaryFiles = {};
    for (const file of Object.values(content.files ?? {})) {
        files[file.id] = file;
    }

    const referencedFileIds = new Set<string>();
    for (const element of content.elements ?? []) {
        if ("fileId" in element && element.fileId && !files[element.fileId]) {
            referencedFileIds.add(element.fileId);
        }
    }

    if (referencedFileIds.size) {
        const owner = entity instanceof FNote ? entity : await froca.getNote(entity.ownerId);
        const images = (await owner?.getAttachmentsByRole(IMAGE_ROLE) ?? [])
            .filter((attachment) => referencedFileIds.has(attachment.title));
        for (const file of (await loadImageFiles(images)).files) {
            files[file.id] = file;
        }
    }

    return { files, referencedFileIds };
}

/**
 * The picture of the canvas drawing `scene` with the images `files`, as the list of attachments and
 * shared pages show it, or `null` for an empty drawing.
 */
export async function exportDrawingPicture(
    scene: PictureScene,
    files: BinaryFiles,
    isDark: boolean
) {
    const elements = (scene.elements ?? []).filter((element) => !element.isDeleted);
    if (!elements.length) {
        return null;
    }

    return exportToSvg({
        elements,
        appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: isDark },
        files,
        exportPadding: 5
    });
}

/** The saved content that the latest picture of each canvas drawing comes from, by its ID. */
const drawnPictureContents = new Map<string, string>();
/** The last picture write of each canvas drawing, which the next write waits for, by its ID. */
const pictureWrites = new Map<string, Promise<void>>();

/** The picture of an empty canvas drawing. */
const EMPTY_PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>`;

/** The filter that Excalidraw draws a drawing in dark colors with. */
export const DRAWING_DARK_FILTER = "invert(93%) hue-rotate(180deg)";
/** The filter that keeps the colors of a picture in a drawing drawn with `DRAWING_DARK_FILTER`. */
export const IMAGE_DARK_FILTER = "invert(100%) hue-rotate(180deg) saturate(1.25)";

/** The class of a saved picture, which scopes its own style. */
const SAVED_PICTURE_CLASS = "trilium-drawing-picture";
/** The class of a `<use>` element that places a bitmap in a saved picture. */
const BITMAP_CLASS = "trilium-drawing-bitmap";

/**
 * Draws a saved picture in the dark colors of Excalidraw while the page that shows it has a dark
 * color scheme, with the filters of Excalidraw's dark export: the root inverted, the bitmaps in it
 * inverted back. The filter of a bitmap is on its `<use>` element, as Excalidraw sets it: a filter
 * on the `<image>` in the `<symbol>` does not apply.
 */
const SAVED_PICTURE_STYLE = `@media (prefers-color-scheme: dark) {
    svg.${SAVED_PICTURE_CLASS} {
        filter: ${DRAWING_DARK_FILTER};
    }
    svg.${SAVED_PICTURE_CLASS} use.${BITMAP_CLASS} {
        filter: ${IMAGE_DARK_FILTER};
    }
}`;

/**
 * Saves the picture of the canvas drawing in `drawing`, drawn from its saved `content`, as the
 * image attachment that shared pages show in place of the drawing. The picture follows the light
 * or dark color scheme of the page. `files` are the images of the drawing already loaded; the
 * others load from the note.
 */
export async function saveDrawingPicture(
    drawing: Pick<FAttachment, "attachmentId" | "ownerId">,
    content: string,
    files: BinaryFiles = {}
) {
    const { attachmentId, ownerId } = drawing;
    drawnPictureContents.set(attachmentId, content);
    try {
        const scene = JSON.parse(content) as CanvasContent;
        const isLoaded = (scene.elements ?? []).every((element) =>
            !("fileId" in element) || !element.fileId || files[element.fileId]);
        const picture = await exportDrawingPicture(
            scene,
            isLoaded ? files : (await loadDrawingFiles(drawing, scene)).files,
            false
        );
        if (picture) {
            const style = picture.ownerDocument.createElementNS(picture.namespaceURI, "style");
            style.textContent = SAVED_PICTURE_STYLE;
            picture.classList.add(SAVED_PICTURE_CLASS);
            picture.prepend(style);
            markBitmaps(picture);
        }

        await queuePictureWrite(attachmentId, async () => {
            // A newer save draws a picture of its own.
            if (drawnPictureContents.get(attachmentId) !== content) return;

            await server.post(`notes/${ownerId}/attachments?matchBy=title`, {
                role: IMAGE_ROLE,
                mime: "image/svg+xml",
                title: getDrawingPictureTitle(attachmentId),
                content: picture?.outerHTML ?? EMPTY_PICTURE
            });
        });
    } catch (e) {
        console.error(`Could not save the picture of the canvas drawing '${attachmentId}'`, e);
    } finally {
        if (drawnPictureContents.get(attachmentId) === content) {
            drawnPictureContents.delete(attachmentId);
        }
    }
}

/** Runs `write` once the previous picture write of the drawing `attachmentId` is done. */
async function queuePictureWrite(attachmentId: string, write: () => Promise<void>) {
    const queued = (pictureWrites.get(attachmentId) ?? Promise.resolve()).then(write);
    const settled = queued.catch(() => {});
    pictureWrites.set(attachmentId, settled);
    try {
        await queued;
    } finally {
        if (pictureWrites.get(attachmentId) === settled) {
            pictureWrites.delete(attachmentId);
        }
    }
}

/**
 * Adds `BITMAP_CLASS` to the `<use>` elements of `picture` that place a bitmap. Excalidraw puts each
 * image in a `<symbol>`; an SVG image keeps its colors in the dark export.
 */
function markBitmaps(picture: SVGSVGElement) {
    const bitmapHrefs = new Set<string>();
    for (const image of picture.querySelectorAll("symbol > image")) {
        const symbol = image.parentElement;
        if (symbol && !image.getAttribute("href")?.startsWith("data:image/svg+xml")) {
            bitmapHrefs.add(`#${symbol.id}`);
        }
    }
    for (const use of picture.querySelectorAll("use")) {
        if (bitmapHrefs.has(use.getAttribute("href") ?? "")) {
            use.classList.add(BITMAP_CLASS);
        }
    }
}

/** The drawing that `attachment` saves, with the changes that `editor` has yet to save. */
async function readDrawing(
    attachment: FAttachment,
    editor: ContentEditor | undefined
): Promise<DrawingScene> {
    const content = parseContent(
        editor?.getUnsavedContent() ?? (await attachment.getBlob())?.content ?? "", attachment);
    const { files } = await loadDrawingFiles(attachment, content);
    return { elements: content.elements ?? [], appState: content.appState ?? {}, files };
}

/**
 * The content of a canvas drawing. Unlike a canvas note, a drawing keeps its images inline, except
 * the ones it refers to by file ID.
 */
function serializeDrawing(scene: DrawingScene, referencedFileIds: ReadonlySet<string>) {
    const elements = scene.elements.filter(
        (element): element is NonDeletedExcalidrawElement => !element.isDeleted);
    const files = getActiveFiles(elements, scene.files);
    for (const fileId of referencedFileIds) {
        delete files[fileId];
    }
    return JSON.stringify(buildSceneContent(elements, scene.appState, files));
}

/**
 * Loaded `elements` as Excalidraw restores them when it loads a scene: a text element without text
 * is deleted, with a new version, and elements without a size are dropped. A second restore
 * changes nothing, so the scene that Excalidraw shows has the version of the result.
 */
function restoreLoadedElements(elements: readonly ExcalidrawElement[] | undefined) {
    return restoreElements(elements ?? [], null, { repairBindings: true });
}

/** Whether `shown` and `saved` hold the same elements, deleted ones aside, at the same versions. */
function isSameScene(shown: readonly ExcalidrawElement[], saved: readonly ExcalidrawElement[]) {
    const getVersion = (element: ExcalidrawElement) => `${element.version}:${element.versionNonce}`;
    const shownVersions = new Map(shown
        .filter((element) => !element.isDeleted)
        .map((element) => [ element.id, getVersion(element) ]));
    const savedElements = saved.filter((element) => !element.isDeleted);
    return savedElements.length === shownVersions.size
        && savedElements.every((element) => shownVersions.get(element.id) === getVersion(element));
}

export function parseContent(newContent: string, entity: FNote | FAttachment): CanvasContent {
    let content: CanvasContent = {
        elements: [],
        files: [],
        appState: {}
    };
    if (newContent) {
        try {
            content = JSON.parse(newContent) as CanvasContent;
        } catch (err) {
            console.error(
                "Error parsing content. Probably note.type changed. Starting with empty canvas",
                entity,
                err
            );
        }
    }
    return content;
}

/** The scene that each save of a canvas note sends, which its picture is drawn from. */
const savedScenes = new WeakMap<
    SavedData, { noteId: string; scene: PictureScene; files: BinaryFiles }
>();

/** Schedules the picture of the canvas note `noteId`, drawn from `scene`, for a pause in saves. */
function scheduleNotePicture(noteId: string, scene: PictureScene, files: BinaryFiles) {
    schedulePicture(noteId, () => saveNotePicture(noteId, scene, files), NOTE_PICTURE_DELAY);
}

/** Saves the picture of the canvas note `noteId`, which previews and shared pages show. */
async function saveNotePicture(noteId: string, scene: PictureScene, files: BinaryFiles) {
    try {
        const picture = await exportDrawingPicture(scene, files, false);
        await server.post(`notes/${noteId}/attachments?matchBy=title`, {
            role: IMAGE_ROLE,
            mime: "image/svg+xml",
            title: CANVAS_EXPORT_TITLE,
            content: picture?.outerHTML ?? EMPTY_PICTURE
        });
    } catch (e) {
        console.error(`Could not save the picture of the canvas note '${noteId}'`, e);
    }
}

/**
 * Schedules a picture of `scene`, loaded from `note`, when the saved one is missing or older. None
 * is scheduled once a change replaced the scene, as `isCurrent()` tells, or once a save scheduled a
 * picture of its own.
 */
async function refreshNotePicture(
    note: FNote,
    scene: PictureScene,
    files: BinaryFiles,
    isCurrent: () => boolean
) {
    if (!(scene.elements ?? []).some((element) => !element.isDeleted)) return;
    const isUnscheduled = watchPictures(note.noteId);
    try {
        const picture = await getPicture(note, CANVAS_EXPORT_TITLE);
        const isOutdated = !picture
            || picture.utcDateModified < (await note.getMetadata()).utcDateModified;
        if (isOutdated && isCurrent() && isUnscheduled()) {
            scheduleNotePicture(note.noteId, scene, files);
        }
    } catch (e) {
        console.error(`Could not check the picture of the canvas note '${note.noteId}'`, e);
    }
}

/** Schedules the picture of `drawing`, drawn from its saved `content`, for when its saves pause. */
function scheduleDrawingPicture(drawing: FAttachment, content: string, files: BinaryFiles) {
    schedulePicture(
        drawing.attachmentId,
        () => saveDrawingPicture(drawing, content, files),
        DRAWING_PICTURE_DELAY
    );
}

/**
 * Schedules a picture of `drawing`, saved as `content`, when the saved one is missing or older.
 * None is scheduled once a change replaced the content, as `isCurrent()` tells, or once a save from
 * any view of the drawing scheduled a picture of its own.
 */
async function refreshDrawingPicture(
    drawing: FAttachment,
    content: string,
    files: BinaryFiles,
    isCurrent: () => boolean
) {
    const isUnscheduled = watchPictures(drawing.attachmentId);
    try {
        const owner = await froca.getNote(drawing.ownerId);
        if (!owner) return;
        const picture = await getPicture(owner, getDrawingPictureTitle(drawing.attachmentId));
        const isOutdated = !picture || picture.utcDateModified < drawing.utcDateModified;
        if (isOutdated && isCurrent() && isUnscheduled()) {
            scheduleDrawingPicture(drawing, content, files);
        }
    } catch (e) {
        const { attachmentId } = drawing;
        console.error(`Could not check the picture of the canvas drawing '${attachmentId}'`, e);
    }
}

/** The image attachment `title` of `owner`, the picture of a drawing, or `undefined`. */
async function getPicture(owner: FNote, title: string) {
    return (await owner.getAttachmentsByRole(IMAGE_ROLE))
        .find((attachment) => attachment.title === title);
}

/** The scene as the content of a canvas note or of a canvas drawing stores it. */
function buildSceneContent(
    elements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<SavedAppState>,
    files: Record<string, BinaryFileData>
) {
    return {
        type: "excalidraw",
        version: 2,
        elements: elements.map(roundStroke),
        files,
        appState: {
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
            zoom: appState.zoom,
            gridModeEnabled: appState.gridModeEnabled,
            viewBackgroundColor: appState.viewBackgroundColor
        }
    };
}

/** The saved copy of each pen stroke, with the version of the stroke that it copies. */
const roundedStrokes = new WeakMap<ExcalidrawElement, {
    version: number;
    versionNonce: number;
    stroke: ExcalidrawFreeDrawElement;
}>();

/**
 * `element`, with the coordinates and the pressures of a pen stroke rounded to thousandths.
 * Excalidraw keeps the full precision of the pointer events, which adds about half to the size of
 * a handwritten scene. Excalidraw changes an element in place, so the copy is kept by version.
 */
export function roundStroke(element: ExcalidrawElement): ExcalidrawElement {
    if (element.type !== "freedraw") return element;
    const rounded = roundedStrokes.get(element);
    if (rounded?.version === element.version && rounded.versionNonce === element.versionNonce) {
        return rounded.stroke;
    }

    const round = (value: number) => Math.round(value * 1000) / 1000;
    const stroke: ExcalidrawFreeDrawElement = {
        ...element,
        x: round(element.x),
        y: round(element.y),
        width: round(element.width),
        height: round(element.height),
        points: element.points.map(([ x, y ]) => [ round(x), round(y) ] as StrokePoint),
        pressures: element.pressures.map(round),
        // Excalidraw clears it when it loads a scene.
        lastCommittedPoint: null
    };
    roundedStrokes.set(element, {
        version: element.version, versionNonce: element.versionNonce, stroke
    });
    return stroke;
}

/** The files that an element of the scene uses. */
function getActiveFiles(elements: readonly NonDeletedExcalidrawElement[], files: BinaryFiles) {
    const activeFiles: Record<string, BinaryFileData> = {};
    for (const element of elements) {
        if ("fileId" in element && element.fileId) {
            activeFiles[element.fileId] = files[element.fileId];
        }
    }
    return activeFiles;
}

function getImportantAppState(appState: ImportantAppState): ImportantAppState {
    return {
        gridModeEnabled: appState.gridModeEnabled,
        viewBackgroundColor: appState.viewBackgroundColor
    };
}

function loadData(api: ExcalidrawImperativeAPI, content: CanvasContent, theme: AppState["theme"]) {
    const { elements, files } = content;
    const appState: Partial<AppState> = content.appState ?? {};
    appState.theme = theme;

    // files are expected in an array when loading. they are stored as a key-index object
    // see example for loading here:
    // https://github.com/excalidraw/excalidraw/blob/c5a7723185f6ca05e0ceb0b0d45c4e3fbcb81b2a/src/packages/excalidraw/example/App.js#L68
    // Only legacy notes still carry inline images here; new saves persist images as attachments
    // (loaded separately via loadImageAttachments) and leave `content.files` empty.
    const fileArray: BinaryFileData[] = [];
    for (const fileId in files) {
        fileArray.push(files[fileId]);
    }

    // Update the scene
    // TODO: Fix type of sceneData
    api.updateScene({
        elements,
        appState: appState as AppState,
        // Scene initialization must be excluded from the undo store. The default (EVENTUALLY)
        // folds this load into the user's next captured action, so undoing their first stroke
        // would restore the previously displayed note's scene (#7148).
        captureUpdate: CaptureUpdateAction.NEVER
    });
    api.addFiles(fileArray);
    api.history.clear();
}

async function loadLibrary(note: FNote) {
    return Promise.all(
        (await note.getAttachmentsByRole("canvasLibraryItem")).map(async (attachment) => {
            const blob = await attachment.getBlob();
            return {
                blob, // Save the blob for libraryItems
                metadata: {
                    // metadata to use in the cache variables for comparing old library state and new one. We delete unnecessary items later, calling the server directly
                    attachmentId: attachment.attachmentId,
                    title: attachment.title
                }
            };
        })
    ).then((results) => {
        // Extract libraryItems from the blobs
        const libraryItems = results.map((result) => result?.blob?.getJsonContentSafely()).filter((item) => !!item) as LibraryItem[];

        // Extract metadata for each attachment
        const metadata = results.map((result) => result.metadata);

        return { libraryItems, metadata };
    });
}
