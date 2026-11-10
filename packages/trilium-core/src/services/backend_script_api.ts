import { type AttributeRow, dayjs, formatLogMessage } from "@triliumnext/commons";
import type { BackendApi as PublicBackendApi, ScriptAppInfo, ScriptBAttachment, ScriptBEtapiToken, ScriptBNote as PublicScriptBNote, ScriptBOption, ScriptRequest, ScriptResponse, ScriptSearchParams, ScriptSql } from "@triliumnext/commons/src/lib/script_api.js";
import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity";
import Becca from "../becca/becca-interface";
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
import type { SearchParams as CoreSearchParams } from "./search/services/types.js";
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
    htmlToMarkdown(html: string): string;

    markdownToHtml(markdown: string): string;

    startNote?: BNote | null;

    currentNote: BNote;

    originEntity?: AbstractBeccaEntity<any> | null;

    // Note: these are optional here (unlike the gated public surface in
    // `@triliumnext/commons`, where they're required) because this interface types
    // *every* backend script, and they're only populated for custom request handlers.
    req?: ScriptRequest;
    res?: ScriptResponse;
    pathParams?: string[];

    /**
     * @deprecated Axios was deprecated since April 2024 and has now been removed following the March 2026 supply chain attack.
     * Use the native fetch() API instead.
     */
    axios: undefined;

    dayjs: typeof dayjs;


    xml2js: typeof xml2js;

    /**
     * @deprecated cheerio was deprecated in v0.103.0 and has now been removed.
     * Use api.htmlParser (node-html-parser) instead.
     */
    cheerio: undefined;

    htmlParser: typeof htmlParser;

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

    searchForNotes(query: string, searchParams: SearchParams): BNote[];

    searchForNote(query: string, searchParams: SearchParams): BNote | null;

    getNotesWithLabel(name: string, value?: string): BNote[];

    getNoteWithLabel(name: string, value?: string): BNote | null;

    ensureNoteIsPresentInParent(
        noteId: string,
        parentNoteId: string,
        prefix: string
    ): {
        branch: BBranch | null;
    };

    ensureNoteIsAbsentFromParent(noteId: string, parentNoteId: string): void;

    toggleNoteInParent(present: true, noteId: string, parentNoteId: string, prefix: string): void;

    createTextNote(parentNoteId: string, title: string, content: string): NoteAndBranch;

    createDataNote(parentNoteId: string, title: string, content: {}): NoteAndBranch;

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

    log(...args: unknown[]): void;

    getRootCalendarNote(): BNote | null;

    getDayNote(date: string, rootNote?: BNote): BNote | null;

    getTodayNote(rootNote?: BNote): BNote | null;

    getWeekFirstDayNote(date: string, rootNote: BNote): BNote | null;

    getWeekNote(date: string, rootNote: BNote): BNote | null;

    getMonthNote(date: string, rootNote: BNote): BNote | null;

    getQuarterNote(date: string, rootNote: BNote): BNote | null;

    getYearNote(year: string, rootNote?: BNote): BNote | null;

    sortNotes(
        parentNoteId: string,
        sortConfig: {
            /** The `#sorted` grammar: 'title', 'dateCreated', 'dateModified' or a label name per
             * level, each optionally followed by 'asc' or 'desc', e.g. 'priority desc, dueDate'. */
            sortBy?: string;
            /** Descending for levels without their own direction, the folders grouping and ties. */
            reverse?: boolean;
            foldersFirst?: boolean;
        }
    ): void;

    setNoteToParent(noteId: string, prefix: string, parentNoteId: string | null): void;

    transactional(func: () => void): any;

    randomString(length: number): string;

    escapeHtml(string: string): string;

    unescapeHtml(string: string): string;

    sql: any;

    getAppInfo(): typeof appInfo;

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

    exportSubtreeToZipFile(noteId: string, format: "markdown" | "html", zipFilePath: string): Promise<void>;

    runOnFrontend(script: () => void | string, params: []): void;

    runOutsideOfSync(callback: () => void): Promise<void>;

    backupNow(backupName: string): Promise<string>;

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
    // Throw when cheerio is used (removed in favor of node-html-parser, which core already uses)
    const cheerioError = () => {
        throw new Error("api.cheerio was deprecated since v0.103.0 and has been removed. Please update your script to use api.htmlParser (node-html-parser) instead.");
    };
    this.cheerio = new Proxy(cheerioError, {
        get: cheerioError,
        apply: cheerioError
    }) as unknown as undefined;
    this.dayjs = dayjs;
    this.xml2js = xml2js;
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
// that public surface claims a member of `api`, or of a type it returns, that has
// since been renamed or removed here.
type _MissingBackendApiMembers = Exclude<keyof PublicBackendApi, keyof Api>;
// The reverse check: a member added to `api` fails to compile until the public surface declares it,
// so the editor's completions and the generated references list it. The exceptions are deprecated
// or private, and left out of the public surface on purpose.
type _UndeclaredBackendApiMembers = Exclude<keyof Api, keyof PublicBackendApi | "axios" | "cheerio" | "createNote" | "__private">;
type _MissingBNoteMembers = Exclude<keyof PublicScriptBNote, keyof BNote>;
type _MissingBAttachmentMembers = Exclude<keyof ScriptBAttachment, keyof BAttachment>;
type _MissingBOptionMembers = Exclude<keyof ScriptBOption, keyof BOption>;
type _MissingBEtapiTokenMembers = Exclude<keyof ScriptBEtapiToken, keyof BEtapiToken>;
type _MissingSearchParams = Exclude<keyof ScriptSearchParams, keyof CoreSearchParams>;
type _MissingAppInfoMembers = Exclude<keyof ScriptAppInfo, keyof typeof appInfo>;
type _MissingSqlMembers = Exclude<keyof ScriptSql, keyof ReturnType<typeof getSql>>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _backendApiDriftGuard: [_MissingBackendApiMembers] extends [never] ? true : _MissingBackendApiMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _undeclaredBackendApiGuard: [_UndeclaredBackendApiMembers] extends [never] ? true : _UndeclaredBackendApiMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _bnoteDriftGuard: [_MissingBNoteMembers] extends [never] ? true : _MissingBNoteMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _battachmentDriftGuard: [_MissingBAttachmentMembers] extends [never] ? true : _MissingBAttachmentMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _boptionDriftGuard: [_MissingBOptionMembers] extends [never] ? true : _MissingBOptionMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _betapiTokenDriftGuard: [_MissingBEtapiTokenMembers] extends [never] ? true : _MissingBEtapiTokenMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _searchParamsDriftGuard: [_MissingSearchParams] extends [never] ? true : _MissingSearchParams = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _appInfoDriftGuard: [_MissingAppInfoMembers] extends [never] ? true : _MissingAppInfoMembers = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _sqlDriftGuard: [_MissingSqlMembers] extends [never] ? true : _MissingSqlMembers = true;
