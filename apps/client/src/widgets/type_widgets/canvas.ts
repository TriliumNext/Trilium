import TypeWidget from "./type_widget.js";
import server from "../../services/server.js";
import type FNote from "../../entities/fnote.js";
import options from "../../services/options.js";
import type { LibraryItem } from "@excalidraw/excalidraw/types";
import type { Theme } from "@excalidraw/excalidraw/element/types";
import type Canvas from "./canvas_el.js";
import { CanvasContent } from "./canvas_el.js";
import { renderReactWidget } from "../react/react_utils.jsx";

const TPL = /*html*/`
    <div class="canvas-widget note-detail-canvas note-detail-printable note-detail">
        <style>
        .excalidraw .App-menu_top .buttonList {
            display: flex;
        }

        /* Conflict between excalidraw and bootstrap classes keeps the menu hidden */
        /* https://github.com/zadam/trilium/issues/3780 */
        /* https://github.com/excalidraw/excalidraw/issues/6567 */
        .excalidraw .dropdown-menu {
            display: block;
        }

        .excalidraw-wrapper {
            height: 100%;
        }

        :root[dir="ltr"]
        .excalidraw
        .layer-ui__wrapper
        .zen-mode-transition.App-menu_bottom--transition-left {
            transform: none;
        }

        /* collaboration not possible so hide the button */
        .CollabButton {
            display: none !important;
        }

        .library-button {
            display: none !important; /* library won't work without extra support which isn't currently implemented */
        }

        </style>
        <!-- height here necessary. otherwise excalidraw not shown -->
        <div class="canvas-render" style="height: 100%"></div>
    </div>
`;



interface AttachmentMetadata {
    title: string;
    attachmentId: string;
}

/**
 * # Canvas note with excalidraw
 * @author thfrei 2022-05-11
 *
 * Background:
 * excalidraw gives great support for hand-drawn notes. It also allows including images and support
 * for sketching. Excalidraw has a vibrant and active community.
 *
 * Functionality:
 * We store the excalidraw assets (elements and files) in the note. In addition to that, we
 * export the SVG from the canvas on every update and store it in the note's attachment. It is used when
 * calling api/images and makes referencing very easy.
 *
 * Paths not taken.
 *  - excalidraw-to-svg (node.js) could be used to avoid storing the svg in the backend.
 *    We could render the SVG on the fly. However, as of now, it does not render any hand drawn
 *    (freedraw) paths. There is an issue with Path2D object not present in the node-canvas library
 *    used by jsdom. (See Trilium PR for samples and other issues in the respective library.
 *    Link will be added later). Related links:
 *     - https://github.com/Automattic/node-canvas/pull/2013
 *     - https://github.com/google/canvas-5-polyfill
 *     - https://github.com/Automattic/node-canvas/issues/1116
 *     - https://www.npmjs.com/package/path2d-polyfill
 *  - excalidraw-to-svg (node.js) takes quite some time to load an image (1-2s)
 *  - excalidraw-utils (browser) does render freedraw, however NOT freedraw with a background. It is not
 *    used, since it is a big dependency, and has the same functionality as react + excalidraw.
 *  - infinite-drawing-canvas with fabric.js. This library lacked a lot of features, excalidraw already
 *    has.
 *
 * Known issues:
 *  - the 3 excalidraw fonts should be included in the share and everywhere, so that it is shown
 *    when requiring svg.
 *
 * Discussion of storing svg in the note attachment:
 *  - Pro: we will combat bit-rot. Showing the SVG will be very fast and easy, since it is already there.
 *  - Con: The note will get bigger (~40-50%?), we will generate more bandwidth. However, using trilium
 *         desktop instance mitigates that issue.
 *
 * Roadmap:
 *  - Support image-notes as reference in excalidraw
 *  - Support canvas note as reference (svg) in other canvas notes.
 *  - Make it easy to include a canvas note inside a text note
 */
export default class ExcalidrawTypeWidget extends TypeWidget {

    private currentNoteId: string;

    private libraryChanged: boolean;
    private librarycache: LibraryItem[];
    private attachmentMetadata: AttachmentMetadata[];
    private themeStyle!: Theme;

    private $render!: JQuery<HTMLElement>;
    private reactHandlers!: JQuery<HTMLElement>;
    private canvasInstance!: Canvas;

    constructor() {
        super();

        // temporary vars
        this.currentNoteId = "";

        // will be overwritten
        this.$render;
        this.$widget;
        this.reactHandlers; // used to control react state

        this.libraryChanged = false;

        // these 2 variables are needed to compare the library state (all library items) after loading to the state when the library changed. So we can find attachments to be deleted.
        //every libraryitem is saved on its own json file in the attachments of the note.
        this.librarycache = [];
        this.attachmentMetadata = [];
    }

    static getType() {
        return "canvas";
    }

    doRender() {
        this.$widget = $(TPL);
        this.$widget.bind("mousewheel DOMMouseScroll", (event) => {
            if (event.ctrlKey) {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        });

        this.$widget.toggleClass("full-height", true);
        this.$render = this.$widget.find(".canvas-render");
        const documentStyle = window.getComputedStyle(document.documentElement);
        this.themeStyle = documentStyle.getPropertyValue("--theme-style")?.trim() as Theme;

        this.#init();

        return this.$widget;
    }

    async #init() {
        const renderElement = this.$render.get(0);
        if (!renderElement) {
            throw new Error("Unable to find element to render.");
        }

        const Canvas = (await import("./canvas_el.js")).default;
        this.canvasInstance = new Canvas({
            // this makes sure that 1) manual theme switch button is hidden 2) theme stays as it should after opening menu
            theme: this.themeStyle,
            onChange: () => this.onChangeHandler(),
            viewModeEnabled: options.is("databaseReadonly"),
            zenModeEnabled: false,
            isCollaborating: false,
            detectScroll: false,
            handleKeyboardGlobally: false,
            autoFocus: false,
            UIOptions: {
                canvasActions: {
                    saveToActiveFile: false,
                    export: false
                }
            },
            onLibraryChange: () => {
                this.libraryChanged = true;

                this.saveData();
            },
        });

        await setupFonts();
        const canvasEl = renderReactWidget(this, this.canvasInstance.createCanvasElement())[0];
        renderElement.replaceChildren(canvasEl);
    }

    /**
     * called to populate the widget container with the note content
     */
    async doRefresh(note: FNote) {
        if (!this.canvasInstance) {
            await this.#init();
        }

        // see if the note changed, since we do not get a new class for a new note
        const noteChanged = this.currentNoteId !== note.noteId;
        if (noteChanged) {
            // reset the scene to omit unnecessary onchange handler
            this.canvasInstance.resetSceneVersion();
        }
        this.currentNoteId = note.noteId;

        // get note from backend and put into canvas
        const blob = await note.getBlob();

        // before we load content into excalidraw, make sure excalidraw has loaded
        await this.canvasInstance.waitForApiToBecomeAvailable();

        /**
         * new and empty note - make sure that canvas is empty.
         * If we do not set it manually, we occasionally get some "bleeding" from another
         * note into this fresh note. Probably due to that this note-instance does not get
         * newly instantiated?
         */
        if (!blob?.content?.trim()) {
            this.canvasInstance.resetScene(this.themeStyle);
        } else if (blob.content) {
            let content: CanvasContent;

            // load saved content into excalidraw canvas
            try {
                content = blob.getJsonContent() as CanvasContent;
            } catch (err) {
                console.error("Error parsing content. Probably note.type changed. Starting with empty canvas", note, blob, err);

                content = {
                    elements: [],
                    files: [],
                    appState: {}
                };
            }

            this.canvasInstance.loadData(content, this.themeStyle);

            Promise.all(
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
                if (note.noteId !== this.currentNoteId) {
                    // current note changed in the course of the async operation
                    return;
                }

                // Extract libraryItems from the blobs
                const libraryItems = results.map((result) => result?.blob?.getJsonContentSafely()).filter((item) => !!item) as LibraryItem[];

                // Extract metadata for each attachment
                const metadata = results.map((result) => result.metadata);

                // Update the library and save to independent variables
                this.canvasInstance.updateLibrary(libraryItems);

                // save state of library to compare it to the new state later.
                this.librarycache = libraryItems;
                this.attachmentMetadata = metadata;
            });


        }

        // set initial scene version
        if (this.canvasInstance.isInitialScene()) {
            this.canvasInstance.updateSceneVersion();
        }
    }

    /**
     * gets data from widget container that will be sent via spacedUpdate.scheduleUpdate();
     * this is automatically called after this.saveData();
     */
    async getData() {
        const { content, svg } = await this.canvasInstance.getData();
        const attachments = [{ role: "image", title: "canvas-export.svg", mime: "image/svg+xml", content: svg, position: 0 }];

        if (this.libraryChanged) {
            // this.libraryChanged is unset in dataSaved()

            // there's no separate method to get library items, so have to abuse this one
            const libraryItems = await this.canvasInstance.getLibraryItems();

            // excalidraw saves the library as a own state. the items are saved to libraryItems. then we compare the library right now with a libraryitemcache. The cache is filled when we first load the Library into the note.
            //We need the cache to delete old attachments later in the server.

            const libraryItemsMissmatch = this.librarycache.filter((obj1) => !libraryItems.some((obj2: LibraryItem) => obj1.id === obj2.id));

            // before we saved the metadata of the attachments in a cache. the title of the attachment is a combination of libraryitem  ´s ID und it´s name.
            // we compare the library items in the libraryitemmissmatch variable (this one saves all libraryitems that are different to the state right now. E.g. you delete 1 item, this item is saved as mismatch)
            // then we combine its id and title and search the according attachmentID.

            const matchingItems = this.attachmentMetadata.filter((meta) => {
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
                    position: position
                });

                position += 10;
            }
        }

        return {
            content: JSON.stringify(content),
            attachments
        };
    }

    /**
     * save content to backend
     */
    saveData() {
        // Since Excalidraw sends an enormous amount of events, wait for them to stop before actually saving.
        this.spacedUpdate.resetUpdateTimer();
        this.spacedUpdate.scheduleUpdate();
    }

    dataSaved() {
        this.libraryChanged = false;
    }

    onChangeHandler() {
        if (options.is("databaseReadonly")) {
            return;
        }
        // changeHandler is called upon any tiny change in excalidraw. button clicked, hover, etc.
        // make sure only when a new element is added, we actually save something.
        const isNewSceneVersion = this.canvasInstance.isNewSceneVersion();
        /**
         * FIXME: however, we might want to make an exception, if viewport changed, since viewport
         *        is desired to save? (add) and appState background, and some things
         */

        // upon updateScene, onchange is called, even though "nothing really changed" that is worth saving
        const isNotInitialScene = !this.canvasInstance.isInitialScene();
        const shouldSave = isNewSceneVersion && isNotInitialScene;

        if (shouldSave) {
            this.canvasInstance.updateSceneVersion();
            this.saveData();
        }
    }

}

async function setupFonts() {
    if (window.EXCALIDRAW_ASSET_PATH) {
        return;
    }

    // currently required by excalidraw, in order to allows self-hosting fonts locally.
    // this avoids making excalidraw load the fonts from an external CDN.
    let path: string;
    if (!glob.isDev) {
        path = `${window.location.pathname}/node_modules/@excalidraw/excalidraw/dist/prod`;
    } else {
        path = (await import("../../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2?url")).default;
        let pathComponents = path.split("/");
        path = pathComponents.slice(0, pathComponents.length - 2).join("/");
    }

    window.EXCALIDRAW_ASSET_PATH = path;
}
