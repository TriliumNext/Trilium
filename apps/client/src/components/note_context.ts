import type { CKTextEditor } from "@triliumnext/ckeditor5";
import type CodeMirror from "@triliumnext/codemirror";

import type FNote from "../entities/fnote.js";
import { closeActiveDialog } from "../services/dialog.js";
import froca from "../services/froca.js";
import hoistedNoteService from "../services/hoisted_note.js";
import type { ViewScope } from "../services/link.js";
import options from "../services/options.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import server from "../services/server.js";
import treeService from "../services/tree.js";
import utils from "../services/utils.js";
import { ReactWrappedWidget } from "../widgets/basic_widget.js";
import type { HeadingContext } from "../widgets/sidebar/TableOfContents.js";
import appContext, { type EventData, type EventListener } from "./app_context.js";
import Component from "./component.js";

export interface SetNoteOpts {
    triggerSwitchEvent?: unknown;
    viewScope?: ViewScope;
}

export type GetTextEditorCallback = (editor: CKTextEditor) => void;

export interface NoteContextDataMap {
    toc: HeadingContext;
    pdfPages: {
        totalPages: number;
        currentPage: number;
        scrollToPage(page: number): void;
        requestThumbnail(page: number): void;
    };
    pdfAttachments: {
        attachments: Array<{ filename: string; size: number }>;
        downloadAttachment(filename: string): void;
    };
    pdfLayers: {
        layers: Array<{ id: string; name: string; visible: boolean }>;
        toggleLayer(layerId: string, visible: boolean): void;
    };
}

type ContextDataKey = keyof NoteContextDataMap;

class NoteContext extends Component implements EventListener<"entitiesReloaded"> {
    ntxId: string | null;
    hoistedNoteId: string;
    mainNtxId: string | null;

    notePath?: string | null;
    noteId?: string | null;
    parentNoteId?: string | null;
    viewScope?: ViewScope;

    /**
     * Metadata storage for UI components (e.g., table of contents, PDF page list, code outline).
     * This allows type widgets to publish data that sidebar/toolbar components can consume.
     * Data is automatically cleared when navigating to a different note.
     */
    private contextData: Map<string, unknown> = new Map();

    constructor(ntxId: string | null = null, hoistedNoteId: string = "root", mainNtxId: string | null = null) {
        super();

        this.ntxId = ntxId || NoteContext.generateNtxId();
        this.hoistedNoteId = hoistedNoteId;
        this.mainNtxId = mainNtxId;

        this.resetViewScope();
    }

    static generateNtxId() {
        return utils.randomString(6);
    }

    setEmpty() {
        this.notePath = null;
        this.noteId = null;
        this.parentNoteId = null;
        // hoisted note is kept intentionally

        this.triggerEvent("noteSwitched", {
            noteContext: this,
            notePath: this.notePath
        });

        this.resetViewScope();
    }

    isEmpty() {
        return !this.noteId;
    }

    async setNote(inputNotePath: string | undefined, opts: SetNoteOpts = {}) {
        opts.triggerSwitchEvent = opts.triggerSwitchEvent !== undefined ? opts.triggerSwitchEvent : true;
        opts.viewScope = opts.viewScope || {};
        opts.viewScope.viewMode = opts.viewScope.viewMode || "default";

        if (!inputNotePath) {
            return;
        }

        const resolvedNotePath = await this.getResolvedNotePath(inputNotePath);

        if (!resolvedNotePath) {
            return;
        }

        if (this.notePath === resolvedNotePath && utils.areObjectsEqual(this.viewScope, opts.viewScope)) {
            return;
        }

        await this.triggerEvent("beforeNoteSwitch", { noteContext: this });

        closeActiveDialog();

        this.notePath = resolvedNotePath;
        this.viewScope = opts.viewScope;
        ({ noteId: this.noteId, parentNoteId: this.parentNoteId } = treeService.getNoteIdAndParentIdFromUrl(resolvedNotePath));

        // Clear context data when switching notes and notify subscribers
        const oldKeys = Array.from(this.contextData.keys());
        this.contextData.clear();
        if (oldKeys.length > 0) {
            // Notify subscribers asynchronously to avoid blocking navigation
            window.setTimeout(() => {
                for (const key of oldKeys) {
                    this.triggerEvent("contextDataChanged", {
                        noteContext: this,
                        key,
                        value: undefined
                    });
                }
            }, 0);
        }

        this.saveToRecentNotes(resolvedNotePath);

        protectedSessionHolder.touchProtectedSessionIfNecessary(this.note);

        if (opts.triggerSwitchEvent) {
            await this.triggerEvent("noteSwitched", {
                noteContext: this,
                notePath: this.notePath
            });
        }

        await this.setHoistedNoteIfNeeded();

        if (utils.isMobile()) {
            this.triggerCommand("setActiveScreen", { screen: "detail" });
        }
    }

    async setHoistedNoteIfNeeded() {
        if (this.hoistedNoteId === "root" && this.notePath?.startsWith("root/_hidden") && !this.note?.isLabelTruthy("keepCurrentHoisting")) {
            // hidden subtree displays only when hoisted, so it doesn't make sense to keep root as hoisted note

            let hoistedNoteId = "_hidden";

            if (this.note?.isLaunchBarConfig()) {
                hoistedNoteId = "_lbRoot";
            } else if (this.note?.isOptions()) {
                hoistedNoteId = "_options";
            }

            await this.setHoistedNoteId(hoistedNoteId);
        }
    }

    getSubContexts() {
        return appContext.tabManager.noteContexts.filter((nc) => nc.ntxId === this.ntxId || nc.mainNtxId === this.ntxId);
    }

    /**
     * A main context represents a tab and also the first split. Further splits are the children contexts of the main context.
     * Imagine you have a tab with 3 splits, each showing notes A, B, C (in this order).
     * In such a scenario, A context is the main context (also representing the tab as a whole), and B, C are the children
     * of context A.
     *
     * @returns {boolean} true if the context is main (= tab)
     */
    isMainContext() {
        // if null, then this is a main context
        return !this.mainNtxId;
    }

    /**
     * See docs for isMainContext() for better explanation.
     *
     * @returns {NoteContext}
     */
    getMainContext() {
        if (this.mainNtxId) {
            try {
                return appContext.tabManager.getNoteContextById(this.mainNtxId);
            } catch (e) {
                this.mainNtxId = null;
                return this;
            }
        } else {
            return this;
        }
    }

    saveToRecentNotes(resolvedNotePath: string) {
        if (options.is("databaseReadonly")) {
            return;
        }
        setTimeout(async () => {
            // we include the note in the recent list only if the user stayed on the note at least 5 seconds
            if (resolvedNotePath && resolvedNotePath === this.notePath) {
                await server.post("recent-notes", {
                    noteId: this.note?.noteId,
                    notePath: this.notePath
                });
                utils.reloadTray();
            }
        }, 5000);
    }

    async getResolvedNotePath(inputNotePath: string) {
        const resolvedNotePath = await treeService.resolveNotePath(inputNotePath, this.hoistedNoteId);

        if (!resolvedNotePath) {
            logError(`Cannot resolve note path ${inputNotePath}`);
            return;
        }

        if ((await hoistedNoteService.checkNoteAccess(resolvedNotePath, this)) === false) {
            return; // note is outside of hoisted subtree and user chose not to unhoist
        }

        return resolvedNotePath;
    }

    get note(): FNote | null {
        if (!this.noteId || !(this.noteId in froca.notes)) {
            return null;
        }

        return froca.notes[this.noteId];
    }

    /** @returns {string[]} */
    get notePathArray() {
        return this.notePath ? this.notePath.split("/") : [];
    }

    isActive() {
        return appContext.tabManager.activeNtxId === this.ntxId;
    }

    getPojoState() {
        if (this.hoistedNoteId !== "root") {
            // keeping empty hoisted tab is esp. important for mobile (e.g. opened launcher config)

            if (!this.notePath && this.getSubContexts().length === 0) {
                return null;
            }
        }

        return {
            ntxId: this.ntxId,
            mainNtxId: this.mainNtxId,
            notePath: this.notePath,
            hoistedNoteId: this.hoistedNoteId,
            active: this.isActive(),
            viewScope: this.viewScope
        };
    }

    async unhoist() {
        await this.setHoistedNoteId("root");
    }

    async setHoistedNoteId(noteIdToHoist: string) {
        if (this.hoistedNoteId === noteIdToHoist) {
            return;
        }

        this.hoistedNoteId = noteIdToHoist;

        if (!this.notePathArray?.includes(noteIdToHoist)) {
            await this.setNote(noteIdToHoist);
        }

        await this.triggerEvent("hoistedNoteChanged", {
            noteId: noteIdToHoist,
            ntxId: this.ntxId
        });
    }

    /** @returns {Promise<boolean>} */
    async isReadOnly() {
        if (this?.viewScope?.readOnlyTemporarilyDisabled) {
            return false;
        }

        // "readOnly" is a state valid only for text/code notes
        if (!this.note || (this.note.type !== "text" && this.note.type !== "code")) {
            return false;
        }

        if (options.is("databaseReadonly")) {
            return true;
        }

        if (this.note.isLabelTruthy("readOnly")) {
            return true;
        }

        if (this.viewScope?.viewMode === "source") {
            return true;
        }

        // Store the initial decision about read-only status in the viewScope
        // This will be "remembered" until the viewScope is refreshed
        if (!this.viewScope) {
            this.resetViewScope();
        }

        const viewScope = this.viewScope!;

        if (viewScope.isReadOnly === undefined) {
            const blob = await this.note.getBlob();
            if (!blob) {
                viewScope.isReadOnly = false;
                return false;
            }

            const sizeLimit = this.note.type === "text"
                ? options.getInt("autoReadonlySizeText")
                : options.getInt("autoReadonlySizeCode");

            viewScope.isReadOnly = Boolean(sizeLimit &&
                blob.contentLength > sizeLimit &&
                !this.note.isLabelTruthy("autoReadOnlyDisabled"));
        }

        // Return the cached decision, which won't change until viewScope is reset
        return viewScope.isReadOnly || false;
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (this.noteId && loadResults.isNoteReloaded(this.noteId)) {
            const noteRow = loadResults.getEntityRow("notes", this.noteId);

            if (noteRow.isDeleted) {
                this.noteId = null;
                this.notePath = null;

                this.triggerEvent("noteSwitched", {
                    noteContext: this,
                    notePath: this.notePath
                });
            }
        }
    }

    hasNoteList() {
        const note = this.note;

        if (!note) {
            return false;
        }

        if (note.type === "search") {
            return false;
        }

        if (!["default", "contextual-help"].includes(this.viewScope?.viewMode ?? "")) {
            return false;
        }

        // Collections must always display a note list, even if no children.
        if (note.type === "book") {
            const viewType = note.getLabelValue("viewType") ?? "grid";
            if (!["list", "grid"].includes(viewType)) {
                return true;
            }
        }

        if (!note.hasChildren()) {
            return false;
        }

        if (!["book", "text", "code"].includes(note.type)) {
            return false;
        }

        if (note.mime === "text/x-sqlite;schema=trilium") {
            return false;
        }

        if (note.isLabelTruthy("hideChildrenOverview")) {
            return false;
        }

        return true;
    }

    async getTextEditor(callback?: GetTextEditorCallback) {
        return this.timeout<CKTextEditor>(
            new Promise((resolve) =>
                appContext.triggerCommand("executeWithTextEditor", {
                    callback,
                    resolve,
                    ntxId: this.ntxId
                })
            )
        );
    }

    async getCodeEditor() {
        return this.timeout(
            new Promise<CodeMirror>((resolve) =>
                appContext.triggerCommand("executeWithCodeEditor", {
                    resolve,
                    ntxId: this.ntxId
                })
            )
        );
    }

    /**
     * Returns a promise which will retrieve the JQuery element of the content of this note context.
     *
     * Do note that retrieving the content element needs to be handled by the type widget, which is the one which
     * provides the content element by listening to the `executeWithContentElement` event. Not all note types support
     * this.
     *
     * If no content could be determined `null` is returned instead.
     */
    async getContentElement() {
        return this.timeout<JQuery<HTMLElement> | null>(
            new Promise((resolve) =>
                appContext.triggerCommand("executeWithContentElement", {
                    resolve,
                    ntxId: this.ntxId
                })
            )
        );
    }

    async getTypeWidget() {
        return this.timeout(
            new Promise<ReactWrappedWidget | null>((resolve) =>
                appContext.triggerCommand("executeWithTypeWidget", {
                    resolve,
                    ntxId: this.ntxId
                })
            )
        );
    }

    timeout<T>(promise: Promise<T | null>) {
        return Promise.race([promise, new Promise((res) => setTimeout(() => res(null), 200))]) as Promise<T>;
    }

    resetViewScope() {
        // view scope contains data specific to one note context and one "view".
        // it is used to e.g., make read-only note temporarily editable or to hide TOC
        // this is reset after navigating to a different note
        this.viewScope = {};
    }

    async getNavigationTitle() {
        if (!this.note) {
            return null;
        }

        const { note, viewScope } = this;

        const isNormalView = (viewScope?.viewMode === "default" || viewScope?.viewMode === "contextual-help");
        let title = (isNormalView ? note.title : `${note.title}: ${viewScope?.viewMode}`);

        if (viewScope?.attachmentId) {
            // assuming the attachment has been already loaded
            const attachment = await note.getAttachmentById(viewScope.attachmentId);

            if (attachment) {
                title += `: ${attachment.title}`;
            }
        }

        return title;
    }

    /**
     * Set metadata for this note context (e.g., table of contents, PDF pages, code outline).
     * This data can be consumed by sidebar/toolbar components.
     *
     * @param key - Unique identifier for the data type (e.g., "toc", "pdfPages", "codeOutline")
     * @param value - The data to store (will be cleared when switching notes)
     */
    setContextData<K extends ContextDataKey>(key: K, value: NoteContextDataMap[K]): void {
        this.contextData.set(key, value);
        // Trigger event so subscribers can react
        this.triggerEvent("contextDataChanged", {
            noteContext: this,
            key,
            value
        });
    }

    /**
     * Get metadata for this note context.
     *
     * @param key - The data key to retrieve
     * @returns The stored data, or undefined if not found
     */
    getContextData<K extends ContextDataKey>(key: K): NoteContextDataMap[K] | undefined {
        return this.contextData.get(key) as NoteContextDataMap[K] | undefined;
    }

    /**
     * Check if context data exists for a given key.
     */
    hasContextData(key: ContextDataKey): boolean {
        return this.contextData.has(key);
    }

    /**
     * Clear specific context data.
     */
    clearContextData(key: ContextDataKey): void {
        this.contextData.delete(key);
        this.triggerEvent("contextDataChanged", {
            noteContext: this,
            key,
            value: undefined
        });
    }
}

export function openInCurrentNoteContext(evt: MouseEvent | JQuery.ClickEvent | JQuery.MouseDownEvent | React.PointerEvent<HTMLCanvasElement> | null, notePath: string, viewScope?: ViewScope) {
    const ntxId = $(evt?.target as Element)
        .closest("[data-ntx-id]")
        .attr("data-ntx-id");

    const noteContext = ntxId ? appContext.tabManager.getNoteContextById(ntxId) : appContext.tabManager.getActiveContext();

    if (noteContext) {
        noteContext.setNote(notePath, { viewScope }).then(() => {
            if (noteContext !== appContext.tabManager.getActiveContext()) {
                appContext.tabManager.activateNoteContext(noteContext.ntxId);
            }
        });
    } else {
        appContext.tabManager.openContextWithNote(notePath, { viewScope, activate: true });
    }
}

export default NoteContext;
