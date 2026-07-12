import { CaptureUpdateAction, exportToSvg, getSceneVersion } from "@excalidraw/excalidraw";
import { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { AppState, BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState, ExcalidrawProps, LibraryItem } from "@excalidraw/excalidraw/types";
import { deferred, type DeferredPromise } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useRef } from "preact/hooks";

import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { SavedData, useEditorSpacedUpdate } from "../../react/hooks";
import { buildNewImageAttachments, CANVAS_EXPORT_TITLE, IMAGE_ROLE, loadImageAttachments } from "./image_attachments";

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

export default function useCanvasPersistence(note: FNote, noteContext: NoteContext | null | undefined, apiRef: RefObject<ExcalidrawImperativeAPI>, theme: AppState["theme"], isReadOnly: boolean): Partial<ExcalidrawProps> {
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
    const initialDataRef = useRef<DeferredPromise<ExcalidrawInitialDataState | null>>();
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

    async function loadInitialContent(newContent: string) {
        const runId = ++initialLoadRunRef.current;
        const loadedNoteId = note.noteId;
        activeNoteIdRef.current = loadedNoteId;

        const content = parseContent(newContent, note);

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

            const expectedSceneVersion = getSceneVersion(content.elements ?? []);
            currentSceneVersion.current = expectedSceneVersion;
            initialSceneAppliedRef.current = expectedSceneVersion === 0;
            initialDataResolvedRef.current = true;

            initialData.resolve({
                elements: content.elements ?? [],
                appState: { ...content.appState, theme },
                files,
                libraryItems: libraryResult.libraryItems
            });
        } catch (err) {
            console.error("Failed to prepare initial canvas data", err);
            if (initialLoadRunRef.current !== runId) return;
            initialDataResolvedRef.current = true;
            initialSceneAppliedRef.current = true;
            // Resolve anyway so Excalidraw does not stay on its loading screen forever.
            initialData.resolve({
                elements: content.elements ?? [],
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

        // Images live as attachments (titled with their fileId); fetch them, rebuild their
        // data URLs and inject them so elements referencing those fileIds render. Legacy notes
        // that still carry inline images in `content.files` were already loaded by loadData().
        loadImageAttachments(note).then(({ files, metadata }) => {
            if (activeNoteIdRef.current !== loadedNoteId) return; // note switched mid-load
            if (files.length > 0) {
                api.addFiles(files);
            }
            persistedImageFileIds.current = new Set(metadata.map((m) => m.fileId));
        });

        // Initialize tracking state after loading to prevent redundant updates from initial onChange events
        currentSceneVersion.current = getSceneVersion(api.getSceneElements());

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
            const { content, svg, activeFiles } = await getData(api, appStateToCompare);
            const attachments: SavedData["attachments"] = [{ role: IMAGE_ROLE, title: CANVAS_EXPORT_TITLE, mime: "image/svg+xml", content: svg, position: 0 }];

            // Persist newly inserted images as attachments. `content` carries only the fileId
            // references (see getData), so the bytes live here. Removed images are not deleted from
            // the client: the server's saveLinks/checkImageAttachments scans the saved scene JSON and
            // schedules now-unreferenced image attachments for erasure (same as the spreadsheet).
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

            return {
                content: JSON.stringify(content),
                attachments
            };
        },
        dataSaved() {
            libraryChanged.current = false;
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
        onChange: () => {
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
                spacedUpdate.scheduleUpdate();
                currentSceneVersion.current = newSceneVersion;
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

function parseContent(newContent: string, note: FNote): CanvasContent {
    let content: CanvasContent = {
        elements: [],
        files: [],
        appState: {}
    };
    if (newContent) {
        try {
            content = JSON.parse(newContent) as CanvasContent;
        } catch (err) {
            console.error("Error parsing content. Probably note.type changed. Starting with empty canvas", note, err);
        }
    }
    return content;
}

async function getData(api: ExcalidrawImperativeAPI, appStateToCompare: RefObject<Partial<ImportantAppState>>) {
    const elements = api.getSceneElements();
    const appState = api.getAppState();

    /**
     * A file is not deleted, even though removed from canvas. Therefore, we only keep
     * files that are referenced by an element. Maybe this will change with a new excalidraw version?
     */
    const files = api.getFiles();
    // parallel svg export to combat bitrot and enable rendering image for note inclusion, preview, and share
    const svg = await exportToSvg({
        elements,
        appState,
        exportPadding: 5, // 5 px padding
        files
    });
    const svgString = svg.outerHTML;

    const activeFiles: Record<string, BinaryFileData> = {};
    elements.forEach((element: NonDeletedExcalidrawElement) => {
        if ("fileId" in element && element.fileId) {
            activeFiles[element.fileId] = files[element.fileId];
        }
    });

    const importantAppState: ImportantAppState = {
        gridModeEnabled: appState.gridModeEnabled,
        viewBackgroundColor: appState.viewBackgroundColor
    };
    appStateToCompare.current = importantAppState;

    const content = {
        type: "excalidraw",
        version: 2,
        elements,
        // Images are persisted as attachments (keyed by fileId), not inline, so the content stays
        // small. Elements keep their `fileId`; the bytes are reattached on load. Kept as an empty
        // object for shape compatibility with loadData() and legacy content.
        files: {} as Record<string, BinaryFileData>,
        appState: {
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
            zoom: appState.zoom,
            ...importantAppState
        }
    };

    return {
        content,
        svg: svgString,
        activeFiles
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
