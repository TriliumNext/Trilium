import { exportToSvg, getSceneVersion } from "@excalidraw/excalidraw";
import { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { AppState, BinaryFileData, ExcalidrawImperativeAPI, ExcalidrawProps, LibraryItem } from "@excalidraw/excalidraw/types";
import { RefObject } from "preact";
import { useRef } from "preact/hooks";

import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { SavedData, useEditorSpacedUpdate } from "../../react/hooks";

interface AttachmentMetadata {
    title: string;
    attachmentId: string;
}

export interface CanvasContent {
    elements: ExcalidrawElement[];
    files: BinaryFileData[];
    appState: Partial<AppState>;
}

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

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "canvas",
        onContentChange(newContent) {
            const api = apiRef.current;
            if (!api) return;

            libraryCache.current = [];
            attachmentMetadata.current = [];
            currentSceneVersion.current = -1;

            // load saved content into excalidraw canvas
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

            loadData(api, content, theme);

            // load the library state
            loadLibrary(note).then(({ libraryItems, metadata }) => {
                // Update the library and save to independent variables
                api.updateLibrary({ libraryItems, merge: false });

                // save state of library to compare it to the new state later.
                libraryCache.current = libraryItems;
                attachmentMetadata.current = metadata;
            });
        },
        async getData() {
            const api = apiRef.current;
            if (!api) return;
            const { content, svg } = await getData(api);
            const attachments: SavedData["attachments"] = [{ role: "image", title: "canvas-export.svg", mime: "image/svg+xml", content: svg, position: 0 }];

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
        onChange: () => {
            if (!apiRef.current || isReadOnly) return;
            const oldSceneVersion = currentSceneVersion.current;
            const newSceneVersion = getSceneVersion(apiRef.current.getSceneElements());

            if (newSceneVersion !== oldSceneVersion) {
                spacedUpdate.resetUpdateTimer();
                spacedUpdate.scheduleUpdate();
                currentSceneVersion.current = newSceneVersion;
            }
        },
        onLibraryChange: () => {
            libraryChanged.current = true;
            spacedUpdate.resetUpdateTimer();
            spacedUpdate.scheduleUpdate();
        }
    };
}

async function getData(api: ExcalidrawImperativeAPI) {
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

    const content = {
        type: "excalidraw",
        version: 2,
        elements,
        files: activeFiles,
        appState: {
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
            zoom: appState.zoom,
            gridModeEnabled: appState.gridModeEnabled
        }
    };

    return {
        content,
        svg: svgString
    };
}

function loadData(api: ExcalidrawImperativeAPI, content: CanvasContent, theme: AppState["theme"]) {
    const { elements, files } = content;
    const appState: Partial<AppState> = content.appState ?? {};
    appState.theme = theme;

    // files are expected in an array when loading. they are stored as a key-index object
    // see example for loading here:
    // https://github.com/excalidraw/excalidraw/blob/c5a7723185f6ca05e0ceb0b0d45c4e3fbcb81b2a/src/packages/excalidraw/example/App.js#L68
    const fileArray: BinaryFileData[] = [];
    for (const fileId in files) {
        const file = files[fileId];
        // TODO: dataURL is replaceable with a trilium image url
        //       maybe we can save normal images (pasted) with base64 data url, and trilium images
        //       with their respective url! nice
        // file.dataURL = "http://localhost:8080/api/images/ltjOiU8nwoZx/start.png";
        fileArray.push(file);
    }

    // Update the scene
    // TODO: Fix type of sceneData
    api.updateScene({
        elements,
        appState: appState as AppState
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
