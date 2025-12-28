import { dayjs, formatLogMessage } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import type Component from "../components/component.js";
import type NoteContext from "../components/note_context.js";
import type FNote from "../entities/fnote.js";
import BasicWidget, { ReactWrappedWidget } from "../widgets/basic_widget.js";
import NoteContextAwareWidget from "../widgets/note_context_aware_widget.js";
import RightPanelWidget from "../widgets/right_panel_widget.js";
import dateNotesService from "./date_notes.js";
import dialogService from "./dialog.js";
import froca from "./froca.js";
import { preactAPI } from "./frontend_script_api_preact.js";
import { t } from "./i18n.js";
import linkService from "./link.js";
import noteTooltipService from "./note_tooltip.js";
import protectedSessionService from "./protected_session.js";
import searchService from "./search.js";
import server from "./server.js";
import shortcutService from "./shortcuts.js";
import SpacedUpdate from "./spaced_update.js";
import toastService from "./toast.js";
import utils from "./utils.js";
import ws from "./ws.js";

/**
 * A whole number
 * @typedef {number} int
 */

/**
 * An instance of the frontend api available globally.
 * @global
 * @var {FrontendScriptApi} api
 */

interface AddToToolbarOpts {
    title: string;
    /** callback handling the click on the button */
    action: () => void;
    /** id of the button, used to identify the old instances of this button to be replaced
     * ID is optional because of BC, but not specifying it is deprecated. ID can be alphanumeric only. */
    id: string;
    /** name of the boxicon to be used (e.g. "time" for "bx-time" icon) */
    icon: string;
    /** keyboard shortcut for the button, e.g. "alt+t" */
    shortcut: string;
}

// TODO: Deduplicate me with the server.
interface ExecResult {
    success: boolean;
    executionResult: unknown;
    error?: string;
}

export interface Entity {
    noteId: string;
}

type Func = ((...args: unknown[]) => unknown) | string;

export interface Api {
    /**
     * Container of all the rendered script content
     * */
    $container: JQuery<HTMLElement> | null;

    /**
     * Note where the script started executing, i.e., the (event) entrypoint of the current script execution.
     */
    startNote: FNote;

    /**
     * Note where the script is currently executing, i.e. the note where the currently executing source code is written.
     */
    currentNote: FNote;

    /**
     * Entity whose event triggered this execution.
     *
     * <p>
     * For front-end scripts, generally there's no origin entity specified since the scripts are run by the user or automatically by the UI (widgets).
     * If there is an origin entity specified, then it's going to be a note entity.
     */
    originEntity: unknown | null;

    /**
     * day.js library for date manipulation.
     * See {@link https://day.js.org} for documentation
     * @see https://day.js.org
     */
    dayjs: typeof dayjs;

    RightPanelWidget: typeof RightPanelWidget;
    NoteContextAwareWidget: typeof NoteContextAwareWidget;
    BasicWidget: typeof BasicWidget;

    /**
     * Activates note in the tree and in the note detail.
     *
     * @param notePath (or noteId)
     */
    activateNote(notePath: string): Promise<void>;

    /**
     * Activates newly created note. Compared to this.activateNote() also makes sure that frontend has been fully synced.
     *
     * @param notePath (or noteId)
     */
    activateNewNote(notePath: string): Promise<void>;

    /**
     * Open a note in a new tab.
     *
     * @method
     * @param notePath (or noteId)
     * @param activate - set to true to activate the new tab, false to stay on the current tab
     */
    openTabWithNote(notePath: string, activate: boolean): Promise<void>;

    /**
     * Open a note in a new split.
     *
     * @param notePath (or noteId)
     * @param activate - set to true to activate the new split, false to stay on the current split
     */
    openSplitWithNote(notePath: string, activate: boolean): Promise<void>;

    /**
     * Adds a new launcher to the launchbar. If the launcher (id) already exists, it will be updated.
     *
     * @method
     * @deprecated you can now create/modify launchers in the top-left Menu -> Configure Launchbar
     *             for special needs there's also backend API's createOrUpdateLauncher()
     */
    addButtonToToolbar(opts: AddToToolbarOpts): void;

    /**
     * @private
     */
    __runOnBackendInner(func: unknown, params: unknown[], transactional: boolean): unknown;

    /**
     * Executes given anonymous function on the backend.
     * Internally this serializes the anonymous function into string and sends it to backend via AJAX.
     * Please make sure that the supplied function is synchronous. Only sync functions will work correctly
     * with transaction management. If you really know what you're doing, you can call api.runAsyncOnBackendWithManualTransactionHandling()
     *
     * @method
     * @param func - (synchronous) function to be executed on the backend
     * @param params - list of parameters to the anonymous function to be sent to backend
     * @returns return value of the executed function on the backend
     */
    runOnBackend(func: Func, params: unknown[]): unknown;

    /**
     * Executes given anonymous function on the backend.
     * Internally this serializes the anonymous function into string and sends it to backend via AJAX.
     * This function is meant for advanced needs where an async function is necessary.
     * In this case, the automatic request-scoped transaction management is not applied,
     * and you need to manually define transaction via api.transactional().
     *
     * If you have a synchronous function, please use api.runOnBackend().
     *
     * @method
     * @param func - (synchronous) function to be executed on the backend
     * @param params - list of parameters to the anonymous function to be sent to backend
     * @returns return value of the executed function on the backend
     */
    runAsyncOnBackendWithManualTransactionHandling(func: Func, params: unknown[]): unknown;

    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See full documentation for all options at: https://triliumnext.github.io/Docs/Wiki/search.html
     */
    searchForNotes(searchString: string): Promise<FNote[]>;

    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See full documentation for all options at: https://triliumnext.github.io/Docs/Wiki/search.html
     */
    searchForNote(searchString: string): Promise<FNote | null>;

    /**
     * Returns note by given noteId. If note is missing from the cache, it's loaded.
     */
    getNote(noteId: string): Promise<FNote | null>;

    /**
     * Returns list of notes. If note is missing from the cache, it's loaded.
     *
     * This is often used to bulk-fill the cache with notes which would have to be picked one by one
     * otherwise (by e.g. createLink())
     *
     * @param [silentNotFoundError] - don't report error if the note is not found
     */
    getNotes(noteIds: string[], silentNotFoundError: boolean): Promise<FNote[]>;

    /**
     * Update frontend tree (note) cache from the backend.
     */
    reloadNotes(noteIds: string[]): Promise<void>;

    /**
     * Instance name identifies particular Trilium instance. It can be useful for scripts
     * if some action needs to happen on only one specific instance.
     */
    getInstanceName(): string;

    /**
     * @returns date in YYYY-MM-DD format
     */
    formatDateISO: typeof utils.formatDateISO;

    parseDate: typeof utils.parseDate;

    /**
     * Show an info toast message to the user.
     */
    showMessage: typeof toastService.showMessage;

    /**
     * Show an error toast message to the user.
     */
    showError: typeof toastService.showError;

    /**
     * Show an info dialog to the user.
     */
    showInfoDialog: typeof dialogService.info;

    /**
     * Show confirm dialog to the user.
     * @returns promise resolving to true if the user confirmed
     */
    showConfirmDialog: typeof dialogService.confirm;

    /**
     * Show prompt dialog to the user.
     *
     * @returns promise resolving to the answer provided by the user
     */
    showPromptDialog: typeof dialogService.prompt;

    /**
     * Trigger command. This is a very low-level API which should be avoided if possible.
     */
    triggerCommand: typeof appContext.triggerCommand;

    /**
     * Trigger event. This is a very low-level API which should be avoided if possible.
     */
    triggerEvent: typeof appContext.triggerEvent;

    /**
     * Create a note link (jQuery object) for given note.
     *
     * @param {string} notePath (or noteId)
     * @param {object} [params]
     * @param {boolean} [params.showTooltip] - enable/disable tooltip on the link
     * @param {boolean} [params.showNotePath] - show also whole note's path as part of the link
     * @param {boolean} [params.showNoteIcon] - show also note icon before the title
     * @param {string} [params.title] - custom link tile with note's title as default
     * @param {string} [params.title=] - custom link tile with note's title as default
     * @returns {jQuery} - jQuery element with the link (wrapped in <span>)
     */
    createLink: typeof linkService.createLink;

    /** @deprecated - use api.createLink() instead */
    createNoteLink: typeof linkService.createLink;

    /**
     * Adds given text to the editor cursor
     *
     * @param text - this must be clear text, HTML is not supported.
     */
    addTextToActiveContextEditor(text: string): void;

    /**
     * @returns active note (loaded into center pane)
     */
    getActiveContextNote(): FNote;

    /**
     * Obtains the currently active/focused split in the current tab.
     *
     * Note that this method does not return the note context of the "Quick edit" panel, it will return the note context behind it.
     */
    getActiveContext(): NoteContext;

    /**
     * Obtains the main context of the current tab. This is the left-most split.
     *
     * Note that this method does not return the note context of the "Quick edit" panel, it will return the note context behind it.
     */
    getActiveMainContext(): NoteContext;

    /**
     * @returns returns all note contexts (splits) in all tabs
     */
    getNoteContexts(): NoteContext[];

    /**
     * @returns returns all main contexts representing tabs
     */
    getMainNoteContexts(): NoteContext[];

    /**
     * See https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editor_editor-Editor.html for documentation on the returned instance.
     *
     * @returns {Promise<BalloonEditor>} instance of CKEditor
     */
    getActiveContextTextEditor(): Promise<unknown>;

    /**
     * See https://codemirror.net/doc/manual.html#api
     *
     * @method
     * @returns instance of CodeMirror
     */
    getActiveContextCodeEditor(): Promise<unknown>;

    /**
     * Get access to the widget handling note detail. Methods like `getWidgetType()` and `getTypeWidget()` to get to the
     * implementation of actual widget type.
     */
    getActiveNoteDetailWidget(): Promise<ReactWrappedWidget>;
    /**
     * @returns returns a note path of active note or null if there isn't active note
     */
    getActiveContextNotePath(): string | null;

    /**
     * Returns component which owns the given DOM element (the nearest parent component in DOM tree)
     *
     * @method
     * @param el DOM element
     */
    getComponentByEl(el: HTMLElement): Component;

    /**
     * @param {object} $el - jquery object on which to set up the tooltip
     */
    setupElementTooltip: typeof noteTooltipService.setupElementTooltip;

    /**
     * @param {boolean} protect - true to protect note, false to unprotect
     */
    protectNote: typeof protectedSessionService.protectNote;

    /**
     * @param noteId
     * @param protect - true to protect subtree, false to unprotect
     */
    protectSubTree: typeof protectedSessionService.protectNote;

    /**
     * Returns date-note for today. If it doesn't exist, it is automatically created.
     */
    getTodayNote: typeof dateNotesService.getTodayNote;

    /**
     * Returns day note for a given date. If it doesn't exist, it is automatically created.
     *
     * @param date - e.g. "2019-04-29"
     */
    getDayNote: typeof dateNotesService.getDayNote;

    /**
     * Returns day note for the first date of the week of the given date. If it doesn't exist, it is automatically created.
     *
     * @param date - e.g. "2019-04-29"
     */
    getWeekFirstDayNote: typeof dateNotesService.getWeekFirstDayNote;

    /**
     * Returns week note for given date. If such a note doesn't exist, it is automatically created.
     *
     * @param date in YYYY-MM-DD format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getWeekNote: typeof dateNotesService.getWeekNote;

    /**
     * Returns month-note. If it doesn't exist, it is automatically created.
     *
     * @param month - e.g. "2019-04"
     */
    getMonthNote: typeof dateNotesService.getMonthNote;

    /**
     * Returns quarter note for given date. If such a note doesn't exist, it is automatically created.
     *
     * @param date in YYYY-MM format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getQuarterNote: typeof dateNotesService.getQuarterNote;

    /**
     * Returns year-note. If it doesn't exist, it is automatically created.
     *
     * @method
     * @param {string} year - e.g. "2019"
     * @returns {Promise<FNote>}
     */
    getYearNote: typeof dateNotesService.getYearNote;

    /**
     * Hoist note in the current tab. See https://triliumnext.github.io/Docs/Wiki/note-hoisting.html
     *
     * @param {string} noteId - set hoisted note. 'root' will effectively unhoist
     */
    setHoistedNoteId(noteId: string): void;

    /**
     * @param keyboardShortcut - e.g. "ctrl+shift+a"
     * @param [namespace] specify namespace of the handler for the cases where call for bind may be repeated.
     *                               If a handler with this ID exists, it's replaced by the new handler.
     */
    bindGlobalShortcut: typeof shortcutService.bindGlobalShortcut;

    /**
     * Trilium runs in a backend and frontend process, when something is changed on the backend from a script,
     * frontend will get asynchronously synchronized.
     *
     * This method returns a promise which resolves once all the backend -> frontend synchronization is finished.
     * Typical use case is when a new note has been created, we should wait until it is synced into frontend and only then activate it.
     */
    waitUntilSynced: typeof ws.waitForMaxKnownEntityChangeId;

    /**
     * This will refresh all currently opened notes which have included note specified in the parameter
     *
     * @param includedNoteId - noteId of the included note
     */
    refreshIncludedNote(includedNoteId: string): void;

    /**
     * Return randomly generated string of given length. This random string generation is NOT cryptographically secure.
     *
     * @method
     * @param length of the string
     * @returns random string
     */
    randomString: typeof utils.randomString;

    /**
     * @param size in bytes
     * @return formatted string
     */
    formatSize: typeof utils.formatSize;

    /**
     * @param size in bytes
     * @return formatted string
     * @deprecated - use api.formatSize()
     */
    formatNoteSize: typeof utils.formatSize;

    logMessages: Record<string, string[]>;
    logSpacedUpdates: Record<string, SpacedUpdate>;

    /**
     * Log given message to the log pane in UI
     */
    log(message: string | object): void;

    preact: typeof preactAPI;
}

/**
 * <p>This is the main frontend API interface for scripts. All the properties and methods are published in the "api" object
 * available in the JS frontend notes. You can use e.g. <code>api.showMessage(api.startNote.title);</code></p>
 */
function FrontendScriptApi(this: Api, startNote: FNote, currentNote: FNote, originEntity: Entity | null = null, $container: JQuery<HTMLElement> | null = null) {
    this.$container = $container;
    this.startNote = startNote;
    this.currentNote = currentNote;
    this.originEntity = originEntity;
    this.dayjs = dayjs;
    this.RightPanelWidget = RightPanelWidget;
    this.NoteContextAwareWidget = NoteContextAwareWidget;
    this.BasicWidget = BasicWidget;

    this.activateNote = async (notePath) => {
        await appContext.tabManager.getActiveContext()?.setNote(notePath);
    };

    this.activateNewNote = async (notePath) => {
        await ws.waitForMaxKnownEntityChangeId();

        await appContext.tabManager.getActiveContext()?.setNote(notePath);
        await appContext.triggerEvent("focusAndSelectTitle", {});
    };

    this.openTabWithNote = async (notePath, activate) => {
        await ws.waitForMaxKnownEntityChangeId();

        await appContext.tabManager.openTabWithNoteWithHoisting(notePath, { activate });

        if (activate) {
            await appContext.triggerEvent("focusAndSelectTitle", {});
        }
    };

    this.openSplitWithNote = async (notePath, activate) => {
        await ws.waitForMaxKnownEntityChangeId();

        const subContexts = appContext.tabManager.getActiveContext()?.getSubContexts();
        const { ntxId } = subContexts?.[subContexts.length - 1] ?? {};

        await appContext.triggerCommand("openNewNoteSplit", { ntxId, notePath });

        if (activate) {
            await appContext.triggerEvent("focusAndSelectTitle", {});
        }
    };

    this.addButtonToToolbar = async (opts) => {
        console.warn("api.addButtonToToolbar() has been deprecated since v0.58 and may be removed in the future. Use  Menu -> Configure Launchbar to create/update launchers instead.");

        const { action, ...reqBody } = opts;

        await server.put("special-notes/api-script-launcher", {
            action: action.toString(),
            ...reqBody
        });
    };

    function prepareParams(params: unknown[]) {
        if (!params) {
            return params;
        }

        return params.map((p) => {
            if (typeof p === "function") {
                return `!@#Function: ${p.toString()}`;
            }
            return p;
        });
    }

    this.__runOnBackendInner = async (func, params, transactional) => {
        if (typeof func === "function") {
            func = func.toString();
        }

        const ret = await server.post<ExecResult>(
            "script/exec",
            {
                script: func,
                params: prepareParams(params),
                startNoteId: startNote.noteId,
                currentNoteId: currentNote.noteId,
                originEntityName: "notes", // currently there's no other entity on the frontend which can trigger event
                originEntityId: originEntity ? originEntity.noteId : null,
                transactional
            },
            "script"
        );

        if (ret.success) {
            await ws.waitForMaxKnownEntityChangeId();

            return ret.executionResult;
        }
        throw new Error(`server error: ${ret.error}`);
    };

    this.runOnBackend = async (func, params = []) => {
        if (func?.constructor.name === "AsyncFunction" || (typeof func === "string" && func?.startsWith?.("async "))) {
            toastService.showError(t("frontend_script_api.async_warning"));
        }

        return await this.__runOnBackendInner(func, params, true);
    };

    this.runAsyncOnBackendWithManualTransactionHandling = async (func, params = []) => {
        if (func?.constructor.name === "Function" || (typeof func === "string" && func?.startsWith?.("function"))) {
            toastService.showError(t("frontend_script_api.sync_warning"));
        }

        return await this.__runOnBackendInner(func, params, false);
    };

    this.searchForNotes = async (searchString) => {
        return await searchService.searchForNotes(searchString);
    };

    this.searchForNote = async (searchString) => {
        const notes = await this.searchForNotes(searchString);

        return notes.length > 0 ? notes[0] : null;
    };

    this.getNote = async (noteId) => await froca.getNote(noteId);
    this.getNotes = async (noteIds, silentNotFoundError = false) => await froca.getNotes(noteIds, silentNotFoundError);
    this.reloadNotes = async (noteIds) => await froca.reloadNotes(noteIds);
    this.getInstanceName = () => window.glob.instanceName;
    this.formatDateISO = utils.formatDateISO;
    this.parseDate = utils.parseDate;

    this.showMessage = toastService.showMessage;
    this.showError = toastService.showError;
    this.showInfoDialog = dialogService.info;
    this.showConfirmDialog = dialogService.confirm;

    this.showPromptDialog = dialogService.prompt;

    this.triggerCommand = (name, data) => appContext.triggerCommand(name, data);
    this.triggerEvent = (name, data) => appContext.triggerEvent(name, data);

    this.createLink = linkService.createLink;
    this.createNoteLink = linkService.createLink;

    this.addTextToActiveContextEditor = (text) => appContext.triggerCommand("addTextToActiveEditor", { text });

    this.getActiveContextNote = (): FNote => {
        const note = appContext.tabManager.getActiveContextNote();
        if (!note) {
            throw new Error("No active context note found");
        }
        return note;
    };

    this.getActiveContext = (): NoteContext => {
        const context = appContext.tabManager.getActiveContext();
        if (!context) {
            throw new Error("No active context found");
        }
        return context;
    };

    this.getActiveMainContext = (): NoteContext => {
        const context = appContext.tabManager.getActiveMainContext();
        if (!context) {
            throw new Error("No active main context found");
        }
        return context;
    };

    this.getNoteContexts = () => appContext.tabManager.getNoteContexts();
    this.getMainNoteContexts = () => appContext.tabManager.getMainNoteContexts();

    this.getActiveContextTextEditor = () => {
        const context = appContext.tabManager.getActiveContext();
        if (!context) {
            throw new Error("No active context found");
        }
        return context.getTextEditor();
    };

    this.getActiveContextCodeEditor = () => {
        const context = appContext.tabManager.getActiveContext();
        if (!context) {
            throw new Error("No active context found");
        }
        return context.getCodeEditor();
    };

    this.getActiveNoteDetailWidget = () => new Promise((resolve) => appContext.triggerCommand("executeInActiveNoteDetailWidget", { callback: resolve }));
    this.getActiveContextNotePath = () => appContext.tabManager.getActiveContextNotePath();

    this.getComponentByEl = (el) => appContext.getComponentByEl(el);

    this.setupElementTooltip = noteTooltipService.setupElementTooltip;

    this.protectNote = async (noteId, protect) => {
        await protectedSessionService.protectNote(noteId, protect, false);
    };

    this.protectSubTree = async (noteId, protect) => {
        await protectedSessionService.protectNote(noteId, protect, true);
    };

    this.getTodayNote = dateNotesService.getTodayNote;
    this.getDayNote = dateNotesService.getDayNote;
    this.getWeekFirstDayNote = dateNotesService.getWeekFirstDayNote;
    this.getWeekNote = dateNotesService.getWeekNote;
    this.getMonthNote = dateNotesService.getMonthNote;
    this.getQuarterNote = dateNotesService.getQuarterNote;
    this.getYearNote = dateNotesService.getYearNote;

    this.setHoistedNoteId = (noteId) => {
        const activeNoteContext = appContext.tabManager.getActiveContext();

        if (activeNoteContext) {
            activeNoteContext.setHoistedNoteId(noteId);
        }
    };

    this.bindGlobalShortcut = shortcutService.bindGlobalShortcut;

    this.waitUntilSynced = ws.waitForMaxKnownEntityChangeId;

    this.refreshIncludedNote = (includedNoteId) => appContext.triggerEvent("refreshIncludedNote", { noteId: includedNoteId });

    this.randomString = utils.randomString;
    this.formatSize = utils.formatSize;
    this.formatNoteSize = utils.formatSize;

    this.logMessages = {};
    this.logSpacedUpdates = {};
    this.log = (message) => {
        const { noteId } = this.startNote;

        message = `${utils.now()}: ${formatLogMessage(message)}`;

        console.log(`Script ${noteId}: ${message}`);

        this.logMessages[noteId] = this.logMessages[noteId] || [];
        this.logSpacedUpdates[noteId] =
            this.logSpacedUpdates[noteId] ||
            new SpacedUpdate(() => {
                const messages = this.logMessages[noteId];
                this.logMessages[noteId] = [];

                appContext.triggerEvent("apiLogMessages", { noteId, messages });
            }, 100);

        this.logMessages[noteId].push(message);
        this.logSpacedUpdates[noteId].scheduleUpdate();
    };

    this.preact = preactAPI;
}

export default FrontendScriptApi as any as {
    new(startNote: FNote, currentNote: FNote, originEntity: Entity | null, $container: JQuery<HTMLElement> | null): Api;
};
