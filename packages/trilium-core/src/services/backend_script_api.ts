import { type AttributeRow, dayjs, formatLogMessage } from "@triliumnext/commons";
import type { BackendApi as PublicBackendApi, ScriptBNote as PublicScriptBNote } from "@triliumnext/commons/src/lib/script_api.js";
import type { Request, Response } from "express";
import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity";
import Becca from "../becca/becca-interface";
import * as cheerio from "cheerio";
import * as htmlParser from "node-html-parser";
import xml2js from "xml2js";
import branchService from "./branches";
import { NoteParams } from "./notes.js";
import SearchContext from "./search/search_context";
import syncMutex from "./sync_mutex";
import zipExportService from "./export/zip";
import becca from "../becca/becca.js";
import type BAttachment from "../becca/entities/battachment.js";
import type BAttribute from "../becca/entities/battribute.js";
import type BBranch from "../becca/entities/bbranch.js";
import type BEtapiToken from "../becca/entities/betapi_token.js";
import type BNote from "../becca/entities/bnote.js";
import type BOption from "../becca/entities/boption.js";
import type BRevision from "../becca/entities/brevision.js";
import appInfo from "./app_info.js";
import attributeService from "./attributes.js";
import type { ApiParams } from "./backend_script_api_interface.js";
import { getBackup } from "./backup.js";
import cloningService from "./cloning.js";
import config from "./config.js";
import dateNoteService from "./date_notes.js";
import log, { getLog } from "./log.js";
import noteService from "./notes.js";
import optionsService from "./options.js";
import searchService from "./search/services/search.js";
import SpacedUpdate from "./spaced_update.js";
import specialNotesService from "./special_notes.js";
import { getSql } from "./sql/index";
import treeService from "./tree.js";
import { escapeHtml, randomString, unescapeHtml } from "./utils/index";
import ws from "./ws.js";
import markdownExport from "./export/markdown.js";
import markdownImport from "./import/markdown.js";

/**
 * A whole number
 * @typedef {number} int
 */

/**
 * An instance of the frontend api available globally.
 * @global
 * @var {BackendScriptApi} api
 */

interface SearchParams {
    includeArchivedNotes?: boolean;
    ignoreHoistedNote?: boolean;
}

interface NoteAndBranch {
    note: BNote;
    /** object having "note" and "branch" keys representing respective objects */
    branch: BBranch;
}

export interface Api {
    /**
     * Converts the given HTML string to Markdown.
     *
     * @param html - HTML content to convert
     * @returns Markdown representation of the input HTML
     */
    htmlToMarkdown(html: string): string;

    /**
     * Converts the given Markdown string to HTML.
     *
     * @param markdown - Markdown content to convert
     * @returns HTML representation of the input Markdown
     */
    markdownToHtml(markdown: string): string;

    /**
     * Note where the script execution started — the entry point of the current script bundle
     * (in C terms, the file containing `main()`). When a script is spread across multiple code
     * notes (descendant code notes loaded as modules via `require()`), every note in the
     * bundle shares the same `startNote`, while {@link currentNote} differs per note.
     * Messages from `api.log()` are grouped under this note.
     *
     * When a frontend script calls `api.runOnBackend()`, the frontend's `startNote` is
     * preserved here; since that note may not be resolvable on the backend, this can be null.
     */
    startNote?: BNote | null;

    /**
     * Note containing the source code that is currently executing (in C terms, `__FILE__`).
     * Equal to {@link startNote} unless execution has moved into a descendant module note
     * loaded via `require()`. Don't confuse this with the concept of the active note in
     * the UI.
     */
    currentNote: BNote;

    /**
     * Entity whose event triggered this execution; `undefined` when the run was not
     * event-driven (e.g. started manually via "Execute script" or `note.executeScript()`).
     *
     * What it holds depends on the trigger:
     * - `~runOnNoteCreation`, `~runOnNoteChange`, `~runOnNoteTitleChange`,
     *   `~runOnNoteContentChange` — the affected note ({@link BNote});
     * - `~runOnChildNoteCreation` — the newly created child note;
     * - `~runOnAttributeCreation`, `~runOnAttributeChange` — the attribute;
     * - `~runOnBranchCreation`, `~runOnBranchChange`, `~runOnBranchDeletion` — the branch;
     * - scheduled scripts (`#run=backendStartup` / `#run=hourly` / `#run=daily`) — the
     *   script note itself;
     * - search scripts (`~searchScript`) — the search note.
     */
    originEntity?: AbstractBeccaEntity<any> | null;

    // Note: these are optional here (unlike the gated public surface in
    // `@triliumnext/commons`, where they're required) because this interface types
    // *every* backend script, and they're only populated for custom request handlers.
    /**
     * Express request object. Only present when the script runs as a custom request
     * handler (a note with the `#customRequestHandler` label invoked via `/custom/...`);
     * `undefined` for every other backend script.
     */
    req?: Request;
    /**
     * Express response object — write the HTTP response here. Only present in custom
     * request handlers; `undefined` otherwise.
     */
    res?: Response;
    /**
     * Capture groups from the `#customRequestHandler` regex that matched this request's
     * URL, in order. Only present in custom request handlers.
     */
    pathParams?: string[];

    /**
     * @deprecated Axios was deprecated since April 2024 and has now been removed following the March 2026 supply chain attack.
     * Use the native fetch() API instead.
     */
    axios: undefined;

    /**
     * day.js library for date manipulation. See {@link https://day.js.org} for documentation
     */
    dayjs: typeof dayjs;

    /**
     * xml2js library for XML parsing. See {@link https://github.com/Leonidas-from-XIV/node-xml2js} for documentation
     */

    xml2js: typeof xml2js;

    /**
     * cheerio library for HTML parsing and manipulation. See {@link https://cheerio.js.org} for documentation
     * @deprecated cheerio will be removed in a future version. Use api.htmlParser (node-html-parser) instead.
     */
    cheerio: typeof cheerio;

    /**
     * node-html-parser library for HTML parsing. See {@link https://github.com/piotr-nicol/node-html-parser} for documentation.
     * This is the recommended replacement for cheerio.
     */
    htmlParser: typeof htmlParser;

    /**
     * Instance name identifies particular Trilium instance. It can be useful for scripts
     * if some action needs to happen on only one specific instance.
     */
    getInstanceName(): string | null;

    getNote(noteId: string): BNote | null;
    getBranch(branchId: string): BBranch | null;
    getAttribute(attachmentId: string): BAttribute | null;
    getAttachment(attachmentId: string): BAttachment | null;
    getRevision(revisionId: string): BRevision | null;
    getEtapiToken(etapiTokenId: string): BEtapiToken | null;
    getEtapiTokens(): BEtapiToken[];
    getOption(optionName: string): BOption | null;
    getOptions(): BOption[];
    getAttribute(attributeId: string): BAttribute | null;

    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See {@link https://triliumnext.github.io/Docs/Wiki/search.html} for full documentation for all options
     */
    searchForNotes(query: string, searchParams: SearchParams): BNote[];

    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See {@link https://triliumnext.github.io/Docs/Wiki/search.html} for full documentation for all options
     */
    searchForNote(query: string, searchParams: SearchParams): BNote | null;

    /**
     * Retrieves notes with given label name & value
     *
     * @param name - attribute name
     * @param value - attribute value
     */
    getNotesWithLabel(name: string, value?: string): BNote[];

    /**
     * Retrieves first note with given label name & value
     *
     * @param name - attribute name
     * @param value - attribute value
     */
    getNoteWithLabel(name: string, value?: string): BNote | null;

    /**
     * If there's no branch between note and parent note, create one. Otherwise, do nothing. Returns the new or existing branch.
     *
     * @param prefix - if branch is created between note and parent note, set this prefix
     */
    ensureNoteIsPresentInParent(
        noteId: string,
        parentNoteId: string,
        prefix: string
    ): {
        branch: BBranch | null;
    };

    /**
     * If there's a branch between note and parent note, remove it. Otherwise, do nothing.
     */
    ensureNoteIsAbsentFromParent(noteId: string, parentNoteId: string): void;

    /**
     * Based on the value, either create or remove branch between note and parent note.
     *
     * @param present - true if we want the branch to exist, false if we want it gone
     * @param prefix - if branch is created between note and parent note, set this prefix
     */
    toggleNoteInParent(present: true, noteId: string, parentNoteId: string, prefix: string): void;

    /**
     * Create text note. See also createNewNote() for more options.
     */
    createTextNote(parentNoteId: string, title: string, content: string): NoteAndBranch;

    /**
     * Create data note - data in this context means object serializable to JSON. Created note will be of type 'code' and
     * JSON MIME type. See also createNewNote() for more options.
     */
    createDataNote(parentNoteId: string, title: string, content: {}): NoteAndBranch;

    /**
     * @returns object contains newly created entities note and branch
     */
    createNewNote(params: NoteParams): NoteAndBranch;

    /**
     * @deprecated please use createTextNote() with similar API for simpler use cases or createNewNote() for more complex needs
     * @param parentNoteId - create new note under this parent
     * @returns object contains newly created entities note and branch
     */
    createNote(
        parentNoteId: string,
        title: string,
        content: string,
        extraOptions: Omit<NoteParams, "title" | "content" | "type" | "parentNoteId"> & {
            /** should the note be JSON */
            json?: boolean;
            attributes?: AttributeRow[];
        }
    ): NoteAndBranch;

    logMessages: Record<string, string[]>;
    logSpacedUpdates: Record<string, SpacedUpdate>;

    /**
     * Log given message to trilium logs and log pane in UI.
     * Accepts multiple arguments which are joined with spaces, similar to `console.log`.
     */
    log(...args: unknown[]): void;

    /**
     * Returns root note of the calendar.
     */
    getRootCalendarNote(): BNote | null;

    /**
     * Returns day note for given date. If such note doesn't exist, it is created.
     *
     * @method
     * @param date in YYYY-MM-DD format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getDayNote(date: string, rootNote?: BNote): BNote | null;

    /**
     * Returns today's day note. If such note doesn't exist, it is created.
     *
     * @param rootNote specify calendar root note, normally leave empty to use the default calendar
     */
    getTodayNote(rootNote?: BNote): BNote | null;

    /**
     * Returns note for the first date of the week of the given date.
     *
     * @param date in YYYY-MM-DD format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getWeekFirstDayNote(date: string, rootNote: BNote): BNote | null;

    /**
     * Returns week note for given date. If such a note doesn't exist, it is created.
     *
     * <p>
     * If the calendar does not support week notes, this method will return `null`.
     *
     * @param date in YYYY-MM-DD format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     * @return an existing or newly created week note, or `null` if the calendar does not support week notes.
     */
    getWeekNote(date: string, rootNote: BNote): BNote | null;

    /**
     * Returns month note for given date. If such a note doesn't exist, it is created.
     *
     * @param date in YYYY-MM format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getMonthNote(date: string, rootNote: BNote): BNote | null;

    /**
     * Returns quarter note for given date. If such a note doesn't exist, it is created.
     *
     * @param date in YYYY-MM format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getQuarterNote(date: string, rootNote: BNote): BNote | null;

    /**
     * Returns year note for given year. If such a note doesn't exist, it is created.
     *
     * @param year in YYYY format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getYearNote(year: string, rootNote?: BNote): BNote | null;

    /**
     * Sort child notes of a given note.
     */
    sortNotes(
        parentNoteId: string,
        sortConfig: {
            /** 'title', 'dateCreated', 'dateModified' or a label name
             * See {@link https://triliumnext.github.io/Docs/Wiki/sorting.html} for details. */
            sortBy?: string;
            reverse?: boolean;
            foldersFirst?: boolean;
        }
    ): void;

    /**
     * This method finds note by its noteId and prefix and either sets it to the given parentNoteId
     * or removes the branch (if parentNoteId is not given).
     *
     * This method looks similar to toggleNoteInParent() but differs because we're looking up branch by prefix.
     *
     * @deprecated this method is pretty confusing and serves specialized purpose only
     */
    setNoteToParent(noteId: string, prefix: string, parentNoteId: string | null): void;

    /**
     * This functions wraps code which is supposed to be running in transaction. If transaction already
     * exists, then we'll use that transaction.
     *
     * @param func
     * @returns result of func callback
     */
    transactional(func: () => void): any;

    /**
     * Return randomly generated string of given length. This random string generation is NOT cryptographically secure.
     *
     * @param length of the string
     * @returns random string
     */
    randomString(length: number): string;

    /**
     * @param to escape
     * @returns escaped string
     */
    escapeHtml(string: string): string;

    /**
     * @param string to unescape
     * @returns unescaped string
     */
    unescapeHtml(string: string): string;

    /**
     * sql
     * @type {module:sql}
     */
    sql: any;

    getAppInfo(): typeof appInfo;

    /**
     * Creates a new launcher to the launchbar. If the launcher (id) already exists, it will be updated.
     */
    createOrUpdateLauncher(opts: {
        /** id of the launcher, only alphanumeric at least 6 characters long */
        id: string;
        /** one of
         * - "note" - activating the launcher will navigate to the target note (specified in targetNoteId param)
         * - "script" -  activating the launcher will execute the script (specified in scriptNoteId param)
         * - "customWidget" - the launcher will be rendered with a custom widget (specified in widgetNoteId param)
         */
        type: "note" | "script" | "customWidget";
        title: string;
        /** if true, will be created in the "Visible launchers", otherwise in "Available launchers" */
        isVisible: boolean;
        /** name of the boxicon to be used (e.g. "bx-time") */
        icon: string;
        /** will activate the target note/script upon pressing, e.g. "ctrl+e" */
        keyboardShortcut: string;
        /** for type "note" */
        targetNoteId: string;
        /** for type "script" */
        scriptNoteId: string;
        /** for type "customWidget" */
        widgetNoteId?: string;
    }): { note: BNote };

    /**
     * @param format - either 'html' or 'markdown'
     */
    exportSubtreeToZipFile(noteId: string, format: "markdown" | "html", zipFilePath: string): Promise<void>;

    /**
     * Executes given anonymous function on the frontend(s).
     * Internally, this serializes the anonymous function into string and sends it to frontend(s) via WebSocket.
     * Note that there can be multiple connected frontend instances (e.g. in different tabs). In such case, all
     * instances execute the given function.
     *
     * @param script - script to be executed on the frontend
     * @param params - list of parameters to the anonymous function to be sent to frontend
     * @returns no return value is provided.
     */
    runOnFrontend(script: () => void | string, params: []): void;

    /**
     * Sync process can make data intermittently inconsistent. Scripts which require strong data consistency
     * can use this function to wait for a possible sync process to finish and prevent new sync process from starting
     * while it is running.
     *
     * Because this is an async process, the inner callback doesn't have automatic transaction handling, so in case
     * you need to make some DB changes, you need to surround your call with api.transactional(...)
     *
     * @param callback - function to be executed while sync process is not running
     * @returns resolves once the callback is finished (callback is awaited)
     */
    runOutsideOfSync(callback: () => void): Promise<void>;

    /**
     * @param backupName - If the backupName is e.g. "now", then the backup will be written to "backup-now.db" file
     * @returns resolves once the backup is finished
     */
    backupNow(backupName: string): Promise<string>;

    /**
     * Enables the complete duplication of the specified original note and all its children into the specified parent note.
     * The new note will be named the same as the original, with (Dup) added to the end of it.
     *
     * @param origNoteId - the noteId for the original note to be duplicated
     * @param newParentNoteId - the noteId for the parent note where the duplication is to be placed.
     *
     * @returns the note and the branch of the newly created note.
     */
    duplicateSubtree(origNoteId: string, newParentNoteId: string): { note: BNote; branch: BBranch; }

    /**
     * This object contains "at your risk" and "no BC guarantees" objects for advanced use cases.
     */
    __private: {
        /** provides access to the backend in-memory object graph, see {@link Becca} */
        becca: Becca;
    };
}

// TODO: Convert to class.
/**
 * <p>This is the main backend API interface for scripts. All the properties and methods are published in the "api" object
 * available in the JS backend notes. You can use e.g. <code>api.log(api.startNote.title);</code></p>
 *
 * @constructor
 */
function BackendScriptApi(this: Api, currentNote: BNote, apiParams: ApiParams) {
    this.startNote = apiParams.startNote;

    this.currentNote = currentNote;

    this.originEntity = apiParams.originEntity;

    for (const key in apiParams) {
        (this as any)[key] = apiParams[key as keyof ApiParams];
    }

    // Throw when axios is used (removed after 2 years of deprecation + supply chain attack)
    const axiosError = () => {
        throw new Error("api.axios was deprecated since 2024 and has been removed following the March 2026 npm supply chain compromise. Please update your script to use the native fetch() API.");
    };
    this.axios = new Proxy(axiosError, {
        get: axiosError,
        apply: axiosError
    }) as unknown as undefined;
    this.dayjs = dayjs;
    this.xml2js = xml2js;
    this.cheerio = cheerio;
    this.htmlParser = htmlParser;
    this.getInstanceName = () => (config.General ? config.General.instanceName : null);
    this.getNote = (noteId) => becca.getNote(noteId);
    this.getBranch = (branchId) => becca.getBranch(branchId);
    this.getAttribute = (attributeId) => becca.getAttribute(attributeId);
    this.getAttachment = (attachmentId) => becca.getAttachment(attachmentId);
    this.getRevision = (revisionId) => becca.getRevision(revisionId);
    this.getEtapiToken = (etapiTokenId) => becca.getEtapiToken(etapiTokenId);
    this.getEtapiTokens = () => becca.getEtapiTokens();
    this.getOption = (optionName) => becca.getOption(optionName);
    this.getOptions = () => optionsService.getOptions();
    this.getAttribute = (attributeId) => becca.getAttribute(attributeId);

    this.htmlToMarkdown = (html) => markdownExport.toMarkdown(html);
    this.markdownToHtml = (markdown) => markdownImport.renderToHtml(markdown, "");

    this.searchForNotes = (query, searchParams = {}) => {
        if (searchParams.includeArchivedNotes === undefined) {
            searchParams.includeArchivedNotes = true;
        }

        if (searchParams.ignoreHoistedNote === undefined) {
            searchParams.ignoreHoistedNote = true;
        }

        const noteIds = searchService.findResultsWithQuery(query, new SearchContext(searchParams)).map((sr) => sr.noteId);

        return becca.getNotes(noteIds);
    };

    this.searchForNote = (query, searchParams = {}) => {
        const notes = this.searchForNotes(query, searchParams);

        return notes.length > 0 ? notes[0] : null;
    };

    this.getNotesWithLabel = attributeService.getNotesWithLabel;
    this.getNoteWithLabel = attributeService.getNoteWithLabel;
    this.ensureNoteIsPresentInParent = cloningService.ensureNoteIsPresentInParent;
    this.ensureNoteIsAbsentFromParent = cloningService.ensureNoteIsAbsentFromParent;
    this.toggleNoteInParent = cloningService.toggleNoteInParent;
    this.createTextNote = (parentNoteId, title, content = "") =>
        noteService.createNewNote({
            parentNoteId,
            title,
            content,
            type: "text"
        });

    this.createDataNote = (parentNoteId, title, content = {}) =>
        noteService.createNewNote({
            parentNoteId,
            title,
            content: JSON.stringify(content, null, "\t"),
            type: "code",
            mime: "application/json"
        });

    this.createNewNote = noteService.createNewNote;

    this.createNote = (parentNoteId, title, content = "", _extraOptions = {}) => {
        const parentNote = becca.getNote(parentNoteId);
        if (!parentNote) {
            throw new Error(`Unable to find parent note with ID ${parentNote}.`);
        }

        const extraOptions: NoteParams = {
            ..._extraOptions,
            content: "",
            type: "text",
            parentNoteId,
            title
        };

        // code note type can be inherited, otherwise "text" is the default
        extraOptions.type = parentNote.type === "code" ? "code" : "text";
        extraOptions.mime = parentNote.type === "code" ? parentNote.mime : "text/html";

        if (_extraOptions.json) {
            extraOptions.content = JSON.stringify(content || {}, null, "\t");
            extraOptions.type = "code";
            extraOptions.mime = "application/json";
        } else {
            extraOptions.content = content;
        }

        return getSql().transactional(() => {
            const { note, branch } = noteService.createNewNote(extraOptions);

            for (const attr of _extraOptions.attributes || []) {
                attributeService.createAttribute({
                    noteId: note.noteId,
                    type: attr.type,
                    name: attr.name,
                    value: attr.value,
                    isInheritable: !!attr.isInheritable
                });
            }

            return { note, branch };
        });
    };

    this.logMessages = {};
    this.logSpacedUpdates = {};

    const logInstance = getLog();
    const sql = getSql();
    this.log = (...rawMessages) => {
        const message = formatLogMessage(...rawMessages);
        logInstance.info(message);

        if (!this.startNote) {
            return;
        }

        const { noteId } = this.startNote;

        this.logMessages[noteId] = this.logMessages[noteId] || [];
        this.logSpacedUpdates[noteId] =
            this.logSpacedUpdates[noteId] ||
            new SpacedUpdate(() => {
                const messages = this.logMessages[noteId];
                this.logMessages[noteId] = [];

                ws.sendMessageToAllClients({
                    type: "api-log-messages",
                    noteId,
                    messages
                });
            }, 100);

        this.logMessages[noteId].push(message);
        this.logSpacedUpdates[noteId].scheduleUpdate();
    };

    this.getRootCalendarNote = dateNoteService.getRootCalendarNote;
    this.getDayNote = dateNoteService.getDayNote;
    this.getTodayNote = dateNoteService.getTodayNote;
    this.getWeekFirstDayNote = dateNoteService.getWeekFirstDayNote;
    this.getWeekNote = dateNoteService.getWeekNote;
    this.getMonthNote = dateNoteService.getMonthNote;
    this.getQuarterNote = dateNoteService.getQuarterNote;
    this.getYearNote = dateNoteService.getYearNote;

    this.sortNotes = (parentNoteId, sortConfig = {}) => treeService.sortNotes(parentNoteId, sortConfig.sortBy || "title", !!sortConfig.reverse, !!sortConfig.foldersFirst);

    this.setNoteToParent = treeService.setNoteToParent;
    this.transactional = sql.transactional.bind(sql);
    this.randomString = randomString;
    this.escapeHtml = escapeHtml;
    this.unescapeHtml = unescapeHtml;
    this.sql = sql;
    this.getAppInfo = () => appInfo;

    this.createOrUpdateLauncher = (opts) => {
        if (!opts.id) {
            throw new Error("ID is a mandatory parameter for api.createOrUpdateLauncher(opts)");
        }
        if (!opts.id.match(/[a-z0-9]{6,1000}/i)) {
            throw new Error(`ID must be an alphanumeric string at least 6 characters long.`);
        }
        if (!opts.type) {
            throw new Error("Launcher Type is a mandatory parameter for api.createOrUpdateLauncher(opts)");
        }
        if (!["note", "script", "customWidget"].includes(opts.type)) {
            throw new Error(`Given launcher type '${opts.type}'`);
        }
        if (!opts.title?.trim()) {
            throw new Error("Title is a mandatory parameter for api.createOrUpdateLauncher(opts)");
        }
        if (opts.type === "note" && !opts.targetNoteId) {
            throw new Error("targetNoteId is mandatory for launchers of type 'note'");
        }
        if (opts.type === "script" && !opts.scriptNoteId) {
            throw new Error("scriptNoteId is mandatory for launchers of type 'script'");
        }
        if (opts.type === "customWidget" && !opts.widgetNoteId) {
            throw new Error("widgetNoteId is mandatory for launchers of type 'customWidget'");
        }

        const parentNoteId = opts.isVisible ? "_lbVisibleLaunchers" : "_lbAvailableLaunchers";
        const noteId = `al_${opts.id}`;

        const launcherNote =
            becca.getNote(noteId) ||
            specialNotesService.createLauncher({
                noteId,
                parentNoteId,
                launcherType: opts.type
            }).note;

        if (launcherNote.title !== opts.title) {
            launcherNote.title = opts.title;
            launcherNote.save();
        }

        if (launcherNote.getParentBranches().length === 1) {
            const branch = launcherNote.getParentBranches()[0];

            if (branch.parentNoteId !== parentNoteId) {
                branchService.moveBranchToNote(branch, parentNoteId);
            }
        }

        if (opts.type === "note") {
            launcherNote.setRelation("target", opts.targetNoteId);
        } else if (opts.type === "script") {
            launcherNote.setRelation("script", opts.scriptNoteId);
        } else if (opts.type === "customWidget") {
            launcherNote.setRelation("widget", opts.widgetNoteId);
        } else {
            throw new Error(`Unrecognized launcher type '${opts.type}'`);
        }

        if (opts.keyboardShortcut) {
            launcherNote.setLabel("keyboardShortcut", opts.keyboardShortcut);
        } else {
            launcherNote.removeLabel("keyboardShortcut");
        }

        if (opts.icon) {
            launcherNote.setLabel("iconClass", `bx ${opts.icon}`);
        } else {
            launcherNote.removeLabel("iconClass");
        }

        return { note: launcherNote };
    };

    this.exportSubtreeToZipFile = async (noteId, format, zipFilePath) => await zipExportService.exportToZipFile(noteId, format, zipFilePath);

    this.runOnFrontend = async (_script, params = []) => {
        let script: string;
        if (typeof _script === "string") {
            script = _script;
        } else {
            script = _script.toString();
        }

        ws.sendMessageToAllClients({
            type: "execute-script",
            script,
            params: prepareParams(params),
            startNoteId: this.startNote?.noteId,
            currentNoteId: this.currentNote.noteId,
            originEntityName: "notes", // currently there's no other entity on the frontend which can trigger event
            originEntityId: (this.originEntity && "noteId" in this.originEntity && (this.originEntity as BNote)?.noteId) || null
        });

        function prepareParams(params: any[]) {
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
    };

    this.runOutsideOfSync = syncMutex.doExclusively;
    this.backupNow = (name: string) => getBackup().backupNow(name);
    this.duplicateSubtree = noteService.duplicateSubtree;

    this.__private = {
        becca
    };
}

export default BackendScriptApi as any as {
    new(currentNote: BNote, apiParams: ApiParams): Api;
};

// --- Drift guards -----------------------------------------------------------
// The public backend script API surface lives in @triliumnext/commons (self-
// contained so it can feed the in-editor language service and the script-
// deployer). These checks fail to compile — naming the offending member — if
// that public surface claims an `api`/`BNote` member that has since been renamed
// or removed here.
type _MissingBackendApiMembers = Exclude<keyof PublicBackendApi, keyof Api>;
type _MissingBNoteMembers = Exclude<keyof PublicScriptBNote, keyof BNote>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _backendApiDriftGuard: [_MissingBackendApiMembers] extends [never] ? true : _MissingBackendApiMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _bnoteDriftGuard: [_MissingBNoteMembers] extends [never] ? true : _MissingBNoteMembers = true;
