import { dayjs, formatLogMessage, type ToMarkdownResponse } from "@triliumnext/commons";
import type { FrontendApi as PublicFrontendApi, ScriptFNote as PublicScriptFNote, ScriptLinkOptions } from "@triliumnext/commons/src/lib/script_api.js";
import DOMPurify from "dompurify";

import appContext from "../components/app_context.js";
import type Component from "../components/component.js";
import type NoteContext from "../components/note_context.js";
import type FBranch from "../entities/fbranch.js";
import type FNote from "../entities/fnote.js";
import BasicWidget, { ReactWrappedWidget } from "../widgets/basic_widget.js";
import NoteContextAwareWidget from "../widgets/note_context_aware_widget.js";
import RightPanelWidget from "../widgets/right_panel_widget.js";
import { BackendScriptingDisabledError, showBackendScriptingDisabledToast } from "./backend_scripting.js";
import dateNotesService from "./date_notes.js";
import dialogService from "./dialog.js";
import froca from "./froca.js";
import { preactAPI } from "./frontend_script_api_preact.js";
import { t } from "./i18n.js";
import linkService from "./link.js";
import noteCreateService, { type CreateNoteOpts } from "./note_create.js";
import noteTooltipService from "./note_tooltip.js";
import options from "./options.js";
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
    $container: JQuery<HTMLElement> | null;

    startNote: FNote;

    currentNote: FNote;

    originEntity: unknown | null;

    dayjs: typeof dayjs;

    RightPanelWidget: typeof RightPanelWidget;
    NoteContextAwareWidget: typeof NoteContextAwareWidget;
    BasicWidget: typeof BasicWidget;

    activateNote(notePath: string): Promise<void>;

    activateNewNote(notePath: string): Promise<void>;

    openTabWithNote(notePath: string, activate: boolean): Promise<void>;

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

    runOnBackend(func: Func, params: unknown[]): unknown;

    runAsyncOnBackendWithManualTransactionHandling(func: Func, params: unknown[]): unknown;

    isBackendScriptingEnabled(): boolean;

    isSqlConsoleEnabled(): boolean;

    searchForNotes(searchString: string): Promise<FNote[]>;

    searchForNote(searchString: string): Promise<FNote | null>;

    getNote(noteId: string): Promise<FNote | null>;

    getNotes(noteIds: string[], silentNotFoundError: boolean): Promise<FNote[]>;

    reloadNotes(noteIds: string[]): Promise<void>;

    createNote(parentNotePath: string, opts?: CreateNoteOpts): Promise<{ note: FNote | null; branch: FBranch | undefined }>;

    getInstanceName(): string | null;

    formatDateISO: typeof utils.formatDateISO;

    parseDate: typeof utils.parseDate;

    showMessage: typeof toastService.showMessage;

    showError: typeof toastService.showError;

    showInfoDialog: typeof dialogService.info;

    showConfirmDialog: typeof dialogService.confirm;

    showPromptDialog: typeof dialogService.prompt;
    pickSingleItem: typeof dialogService.pickSingleItem;

    triggerCommand: typeof appContext.triggerCommand;

    triggerEvent: typeof appContext.triggerEvent;

    createLink: typeof linkService.createLink;

    createNoteLink: typeof linkService.createLink;

    addTextToActiveContextEditor(text: string): void;

    getActiveContextNote(): FNote;

    getActiveContext(): NoteContext;

    getActiveMainContext(): NoteContext;

    getNoteContexts(): NoteContext[];

    getMainNoteContexts(): NoteContext[];

    getActiveContextTextEditor(): Promise<unknown>;

    getActiveContextCodeEditor(): Promise<unknown>;

    getActiveNoteDetailWidget(): Promise<ReactWrappedWidget>;
    getActiveContextNotePath(): string | null;

    getComponentByEl(el: HTMLElement): Component;

    setupElementTooltip: typeof noteTooltipService.setupElementTooltip;

    protectNote: typeof protectedSessionService.protectNote;

    protectSubTree: typeof protectedSessionService.protectNote;

    getTodayNote: typeof dateNotesService.getTodayNote;

    getDayNote: typeof dateNotesService.getDayNote;

    getWeekFirstDayNote: typeof dateNotesService.getWeekFirstDayNote;

    getWeekNote: typeof dateNotesService.getWeekNote;

    getMonthNote: typeof dateNotesService.getMonthNote;

    getQuarterNote: typeof dateNotesService.getQuarterNote;

    getYearNote: typeof dateNotesService.getYearNote;

    setHoistedNoteId(noteId: string): void;

    bindGlobalShortcut: typeof shortcutService.bindGlobalShortcut;

    waitUntilSynced: typeof ws.waitForMaxKnownEntityChangeId;

    refreshIncludedNote(includedNoteId: string): void;

    randomString: typeof utils.randomString;

    formatSize: typeof utils.formatSize;

    formatNoteSize: typeof utils.formatSize;

    htmlToMarkdown(html: string): Promise<string>;

    markdownToHtml(markdown: string): Promise<string>;

    logMessages: Record<string, string[]>;
    logSpacedUpdates: Record<string, SpacedUpdate>;

    log(...args: unknown[]): void;

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
        // Short-circuit when backend scripting is disabled: skip the request entirely so the
        // server never returns a 500, show a single deduplicated toast (fixed id) instead of one
        // generic HTTP-error toast per failing script, and throw a typed error callers can detect.
        if (!options.is("backendScriptingEnabled")) {
            showBackendScriptingDisabledToast(startNote.noteId);
            throw new BackendScriptingDisabledError();
        }

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

    this.isBackendScriptingEnabled = () => options.is("backendScriptingEnabled");
    this.isSqlConsoleEnabled = () => options.is("sqlConsoleEnabled");

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
    this.createNote = async (parentNotePath, opts = {}) => await noteCreateService.createNote(parentNotePath, opts);
    this.getInstanceName = () => window.glob.instanceName;
    this.formatDateISO = utils.formatDateISO;
    this.parseDate = utils.parseDate;

    this.showMessage = toastService.showMessage;
    this.showError = toastService.showError;
    this.showInfoDialog = dialogService.info;
    this.showConfirmDialog = dialogService.confirm;

    this.showPromptDialog = dialogService.prompt;
    this.pickSingleItem = dialogService.pickSingleItem;

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

    this.refreshIncludedNote = (includedNoteId) => appContext.triggerEvent("refreshEmbeddedNote", { noteId: includedNoteId });

    this.randomString = utils.randomString;
    this.formatSize = utils.formatSize;
    this.formatNoteSize = utils.formatSize;

    this.htmlToMarkdown = async (html) => {
        const { markdownContent } = await server.post<ToMarkdownResponse>("other/to-markdown", { htmlContent: html });
        return markdownContent;
    };
    this.markdownToHtml = async (markdown) => {
        // The Markdown renderer pulls in marked, so it is only loaded on demand.
        const { renderToHtml } = await import("@triliumnext/commons/src/lib/markdown_renderer");
        return renderToHtml(markdown, "", {
            sanitize: (dirty) => DOMPurify.sanitize(dirty),
            wikiLink: { formatHref: (id) => `#root/${id}` }
        });
    };

    this.logMessages = {};
    this.logSpacedUpdates = {};
    this.log = (...args) => {
        const { noteId } = this.startNote;

        const message = `${utils.now()}: ${formatLogMessage(...args)}`;

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

// --- Drift guards -----------------------------------------------------------
// The public script API surface lives in @triliumnext/commons (self-contained so
// it can feed the in-editor language service and the script-deployer). These
// checks fail to compile — naming the offending member — if that public surface
// claims an `api`/`FNote` member that has since been renamed or removed here.
type _MissingApiMembers = Exclude<keyof PublicFrontendApi, keyof Api>;
// The reverse check: a member added to `api` fails to compile until the public surface declares it,
// so the editor's completions and the generated references list it. The exceptions are deprecated
// or private, and left out of the public surface on purpose.
type _UndeclaredApiMembers = Exclude<keyof Api, keyof PublicFrontendApi | "addButtonToToolbar" | "__runOnBackendInner">;
type _MissingFNoteMembers = Exclude<keyof PublicScriptFNote, keyof FNote>;
type _MissingLinkOptions = Exclude<keyof ScriptLinkOptions, keyof NonNullable<Parameters<typeof linkService.createLink>[1]>>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _apiDriftGuard: [_MissingApiMembers] extends [never] ? true : _MissingApiMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _undeclaredApiGuard: [_UndeclaredApiMembers] extends [never] ? true : _UndeclaredApiMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _fnoteDriftGuard: [_MissingFNoteMembers] extends [never] ? true : _MissingFNoteMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _linkOptionsDriftGuard: [_MissingLinkOptions] extends [never] ? true : _MissingLinkOptions = true;
