/**
 * Public type surface for Trilium **user scripts** — the shape of the `api`
 * global available inside frontend/backend script notes.
 *
 * This is the single source of truth for script API types, consumed by:
 *  - the in-editor TypeScript language service (bundled into the script-note vfs),
 *  - the `script-deployer` app (script authoring/typechecking),
 * and kept honest against the real implementations by member-presence drift
 * guards (see `frontend_script_api.ts` / `backend_script_api.ts`).
 *
 * It is intentionally **self-contained** (no imports): the real `Api` interfaces
 * drag in the whole client/server graph (froca, widgets, jQuery, Vite `?raw`
 * imports) which can't be resolved by a browser-based language service. These
 * are faithful, decoupled re-declarations of the public surface — heavy or
 * advanced members (widget base classes, editor instances, the Preact API) are
 * typed as `unknown` rather than pulling in their real types.
 */

/** A label or relation attached to a note. */
export interface ScriptAttribute {
    attributeId: string;
    type: "label" | "relation";
    name: string;
    value: string;
    isInheritable: boolean;
    isOwned: boolean;
}

/** A note as seen by frontend scripts (subset of the client's `FNote`). */
export interface ScriptFNote {
    noteId: string;
    title: string;
    type: string;
    mime: string;
    isProtected: boolean;
    attributes: string[];
    parents: string[];
    children: string[];

    getParentNotes(): ScriptFNote[];
    getChildNotes(): Promise<ScriptFNote[]>;
    getParentNoteIds(): string[];
    getChildNoteIds(): string[];

    getAttributes(type?: string, name?: string): ScriptAttribute[];
    getOwnedAttributes(type?: string, name?: string): ScriptAttribute[];
    getAttribute(type: string, name: string): ScriptAttribute | null;
    hasAttribute(type: string, name: string): boolean;
    getLabels(name?: string): ScriptAttribute[];
    getLabelValue(name: string): string | null;
    hasLabel(name: string): boolean;
    getRelations(name?: string): ScriptAttribute[];
    getRelationValue(name: string): string | null;
    getRelationTarget(name: string): Promise<ScriptFNote | null>;

    getContent(): Promise<string | Uint8Array>;
    getIcon(): string;
    isRoot(): boolean;
}

/** A split/tab context as seen by frontend scripts (subset of `NoteContext`). */
export interface ScriptNoteContext {
    ntxId: string | null;
    note: ScriptFNote | null;
    notePath: string | null;
    getCodeEditor(): Promise<unknown>;
    getTextEditor(): Promise<unknown>;
}

/** Minimal day.js surface (the real API exposes the full day.js factory). */
export type ScriptDayjs = (date?: string | number | Date) => {
    format(template?: string): string;
    add(value: number, unit: string): ReturnType<ScriptDayjs>;
    subtract(value: number, unit: string): ReturnType<ScriptDayjs>;
    toDate(): Date;
};

type Func = ((...args: unknown[]) => unknown) | string;

/** Instance shape of `BasicWidget` (subset) — the base for custom frontend widgets. */
interface BasicWidget {
    /**
     * The widget's root jQuery element (assign in `doRender`, e.g. `this.$widget = $(TPL)`).
     * Typed loosely because jQuery types can't be imported into this self-contained module;
     * inside the editor it is a real `JQuery<HTMLElement>` so all jQuery methods work.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $widget: any;
    /** Whether the widget should be shown for the current context. */
    isEnabled(): boolean | null | undefined;
    /** Builds `this.$widget`. Override to render the widget's DOM. */
    doRender(): void;
    /** Renders the widget and returns its root element. */
    render(): unknown;
    /** Tears down the widget; override to release resources. */
    cleanup(): void;
    /** Fluent builder: set the element id. Chainable. */
    id(id: string): this;
    /** Fluent builder: add a CSS class. Chainable. */
    class(className: string): this;
    /** Fluent builder: set an inline CSS property. Chainable. */
    css(name: string, value: string): this;
    /** Fluent builder: append child components. Chainable. */
    child(...components: unknown[]): this;
}

/** Instance shape of `NoteContextAwareWidget` (subset) — reacts to the active note. */
interface NoteContextAwareWidget extends BasicWidget {
    /** The note currently shown in this widget's context. */
    note: ScriptFNote | null;
    /** The note context (split) this widget is attached to. */
    noteContext?: ScriptNoteContext;
    /** Called when the active note changes. Override to update the widget. */
    refreshWithNote(note: ScriptFNote | null | undefined): void | Promise<void>;
    /** Forces a refresh against the current note. */
    refresh(): void | Promise<void>;
}

/** Instance shape of `RightPanelWidget` (subset) — a widget shown in the right sidebar. */
interface RightPanelWidget extends NoteContextAwareWidget {
    /** Title shown in the right-panel header. */
    readonly widgetTitle: string;
    /** Builds the panel body. Override to render the right-panel content. */
    doRenderBody(): void | Promise<void>;
}

/** Constructor type allowing `class X extends api.Widget { … }`. */
type WidgetClass<T> = new (...args: unknown[]) => T;

/**
 * The `api` global available inside **frontend** script notes
 * (`application/javascript;env=frontend`).
 */
export interface FrontendApi {
    /**
     * Container of all the rendered script content
     * */
    $container: unknown;
    /**
     * Note where the script started executing, i.e., the (event) entrypoint of the current script execution.
     */
    startNote: ScriptFNote;
    /**
     * Note where the script is currently executing, i.e. the note where the currently executing source code is written.
     */
    currentNote: ScriptFNote;
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
    dayjs: ScriptDayjs;

    /** Base class for right-panel widgets — `class X extends api.RightPanelWidget { … }`. */
    RightPanelWidget: WidgetClass<RightPanelWidget>;
    /** Base class for note-context-aware widgets — `class X extends api.NoteContextAwareWidget { … }`. */
    NoteContextAwareWidget: WidgetClass<NoteContextAwareWidget>;
    /** Base class for basic widgets — `class X extends api.BasicWidget { … }`. */
    BasicWidget: WidgetClass<BasicWidget>;

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
    runOnBackend(func: Func, params?: unknown[]): Promise<unknown>;
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
    runAsyncOnBackendWithManualTransactionHandling(func: Func, params?: unknown[]): Promise<unknown>;

    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See full documentation for all options at: https://triliumnext.github.io/Docs/Wiki/search.html
     */
    searchForNotes(searchString: string): Promise<ScriptFNote[]>;
    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See full documentation for all options at: https://triliumnext.github.io/Docs/Wiki/search.html
     */
    searchForNote(searchString: string): Promise<ScriptFNote | null>;
    /**
     * Returns note by given noteId. If note is missing from the cache, it's loaded.
     */
    getNote(noteId: string): Promise<ScriptFNote | null>;
    /**
     * Returns list of notes. If note is missing from the cache, it's loaded.
     *
     * This is often used to bulk-fill the cache with notes which would have to be picked one by one
     * otherwise (by e.g. createLink())
     *
     * @param [silentNotFoundError] - don't report error if the note is not found
     */
    getNotes(noteIds: string[], silentNotFoundError?: boolean): Promise<ScriptFNote[]>;
    /**
     * Update frontend tree (note) cache from the backend.
     */
    reloadNotes(noteIds: string[]): Promise<void>;
    /**
     * Instance name identifies particular Trilium instance. It can be useful for scripts
     * if some action needs to happen on only one specific instance.
     */
    getInstanceName(): string | null;

    /**
     * Adds given text to the editor cursor
     *
     * @param text - this must be clear text, HTML is not supported.
     */
    addTextToActiveContextEditor(text: string): void;
    /**
     * @returns active note (loaded into center pane)
     */
    getActiveContextNote(): ScriptFNote;
    /**
     * Obtains the currently active/focused split in the current tab.
     *
     * Note that this method does not return the note context of the "Quick edit" panel, it will return the note context behind it.
     */
    getActiveContext(): ScriptNoteContext;
    /**
     * Obtains the main context of the current tab. This is the left-most split.
     *
     * Note that this method does not return the note context of the "Quick edit" panel, it will return the note context behind it.
     */
    getActiveMainContext(): ScriptNoteContext;
    /**
     * @returns returns all note contexts (splits) in all tabs
     */
    getNoteContexts(): ScriptNoteContext[];
    /**
     * @returns returns all main contexts representing tabs
     */
    getMainNoteContexts(): ScriptNoteContext[];
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
    getActiveNoteDetailWidget(): Promise<unknown>;
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
    getComponentByEl(el: HTMLElement): unknown;

    /**
     * Show an info toast message to the user.
     */
    showMessage(message: string, delay?: number): void;
    /**
     * Show an error toast message to the user.
     */
    showError(message: string, delay?: number): void;
    /**
     * Show an info dialog to the user.
     */
    showInfoDialog(message: string): Promise<void>;
    /**
     * Show confirm dialog to the user.
     * @returns promise resolving to true if the user confirmed
     */
    showConfirmDialog(message: string): Promise<boolean>;
    /**
     * Show prompt dialog to the user.
     *
     * @returns promise resolving to the answer provided by the user
     */
    showPromptDialog(props: { title?: string; message?: string; defaultValue?: string }): Promise<string | null>;

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
    createLink(notePath: string, params?: Record<string, unknown>): unknown;
    /** @deprecated - use api.createLink() instead */
    createNoteLink(notePath: string, params?: Record<string, unknown>): unknown;

    /**
     * Trigger command. This is a very low-level API which should be avoided if possible.
     */
    triggerCommand(name: string, data?: Record<string, unknown>): Promise<unknown>;
    /**
     * Trigger event. This is a very low-level API which should be avoided if possible.
     */
    triggerEvent(name: string, data?: Record<string, unknown>): Promise<unknown>;
    /**
     * @param {object} $el - jquery object on which to set up the tooltip
     */
    setupElementTooltip(el: unknown): void;
    /**
     * @param {boolean} protect - true to protect note, false to unprotect
     */
    protectNote(noteId: string, protect: boolean): Promise<void>;
    /**
     * @param noteId
     * @param protect - true to protect subtree, false to unprotect
     */
    protectSubTree(noteId: string, protect: boolean): Promise<void>;

    /**
     * Returns date-note for today. If it doesn't exist, it is automatically created.
     */
    getTodayNote(): Promise<ScriptFNote>;
    /**
     * Returns day note for a given date. If it doesn't exist, it is automatically created.
     *
     * @param date - e.g. "2019-04-29"
     */
    getDayNote(date: string): Promise<ScriptFNote>;
    /**
     * Returns day note for the first date of the week of the given date. If it doesn't exist, it is automatically created.
     *
     * @param date - e.g. "2019-04-29"
     */
    getWeekFirstDayNote(date: string): Promise<ScriptFNote>;
    /**
     * Returns week note for given date. If such a note doesn't exist, it is automatically created.
     *
     * @param date in YYYY-MM-DD format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getWeekNote(date: string): Promise<ScriptFNote>;
    /**
     * Returns month-note. If it doesn't exist, it is automatically created.
     *
     * @param month - e.g. "2019-04"
     */
    getMonthNote(month: string): Promise<ScriptFNote>;
    /**
     * Returns quarter note for given date. If such a note doesn't exist, it is automatically created.
     *
     * @param date in YYYY-MM format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getQuarterNote(date: string): Promise<ScriptFNote>;
    /**
     * Returns year-note. If it doesn't exist, it is automatically created.
     *
     * @method
     * @param {string} year - e.g. "2019"
     * @returns {Promise<FNote>}
     */
    getYearNote(year: string): Promise<ScriptFNote>;

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
    bindGlobalShortcut(keyboardShortcut: string, handler: () => void, namespace?: string): void;
    /**
     * Trilium runs in a backend and frontend process, when something is changed on the backend from a script,
     * frontend will get asynchronously synchronized.
     *
     * This method returns a promise which resolves once all the backend -> frontend synchronization is finished.
     * Typical use case is when a new note has been created, we should wait until it is synced into frontend and only then activate it.
     */
    waitUntilSynced(): Promise<unknown>;
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
    randomString(length: number): string;
    /**
     * @param size in bytes
     * @return formatted string
     */
    formatSize(size: number): string;
    /**
     * @param size in bytes
     * @return formatted string
     * @deprecated - use api.formatSize()
     */
    formatNoteSize(size: number): string;
    /**
     * @returns date in YYYY-MM-DD format
     */
    formatDateISO(date: Date): string;
    /** Parses a date string into a Date. */
    parseDate(str: string): Date;

    /** Per-note log message buffers shown in the UI log pane. */
    logMessages: Record<string, string[]>;
    /** Per-note spaced-update handlers for the log pane. */
    logSpacedUpdates: Record<string, unknown>;
    /**
     * Log given message to the log pane in UI.
     * Accepts multiple arguments which are joined with spaces, similar to `console.log`.
     */
    log(...args: unknown[]): void;

    /** The Preact API surface (components, hooks) for render scripts. */
    preact: unknown;
}

/** A branch (note→parent placement) as seen by backend scripts (subset of `BBranch`). */
export interface ScriptBBranch {
    branchId: string;
    noteId: string;
    parentNoteId: string;
    prefix: string | null;
    notePosition: number;
    isExpanded: boolean;
    getNote(): ScriptBNote;
    getParentNote(): ScriptBNote | null;
}

/** A note as seen by backend scripts (subset of trilium-core's `BNote`). */
export interface ScriptBNote {
    noteId: string;
    title: string;
    type: string;
    mime: string;
    isProtected: boolean;

    getContent(): string | Uint8Array;
    setContent(content: string | Uint8Array, opts?: { forceFrontendReload?: boolean }): void;
    getJsonContent<T = unknown>(): T | null;
    /** Plain serialisable representation of the note (the real return type is `NotePojo`). */
    getPojo(): Record<string, unknown>;

    getParentNotes(): ScriptBNote[];
    getChildNotes(): ScriptBNote[];
    getParentBranches(): ScriptBBranch[];
    getChildBranches(): ScriptBBranch[];

    getAttributes(type?: string, name?: string): ScriptAttribute[];
    getOwnedAttributes(type?: string, name?: string): ScriptAttribute[];
    getAttribute(type: string, name: string): ScriptAttribute | null;
    hasAttribute(type: string, name: string): boolean;
    getLabel(name: string): ScriptAttribute | null;
    getLabels(name?: string): ScriptAttribute[];
    getLabelValue(name: string): string | null;
    hasLabel(name: string): boolean;
    addLabel(name: string, value?: string, isInheritable?: boolean): ScriptAttribute;
    getRelation(name: string): ScriptAttribute | null;
    getRelations(name?: string): ScriptAttribute[];
    getRelationValue(name: string): string | null;
    getRelationTarget(name: string): ScriptBNote | null;
    addRelation(name: string, targetNoteId: string, isInheritable?: boolean): ScriptAttribute;
    addAttribute(type: string, name: string, value?: string, isInheritable?: boolean): ScriptAttribute;
    isFolder(): boolean;
}

/** Result of the backend note-creation helpers. */
export interface ScriptNoteAndBranch {
    note: ScriptBNote;
    branch: ScriptBBranch;
}

/**
 * Minimal Express `Request` surface available to **custom request handlers**
 * (a subset of Express's `Request` — re-declared here to keep this module
 * self-contained). Only the commonly used members are typed; the real object is
 * a full Express request.
 */
export interface ScriptRequest {
    /** Route/path parameters. */
    params: Record<string, string>;
    /** Parsed query-string parameters. */
    query: Record<string, unknown>;
    /** Parsed request body (requires a matching body parser). */
    body: unknown;
    /** Request headers (lower-cased names). */
    headers: Record<string, string | string[] | undefined>;
    /** HTTP method, e.g. "GET", "POST". */
    method: string;
    /** Request URL (path + query string). */
    url: string;
    /** Returns the value of the given (case-insensitive) header. */
    get(headerName: string): string | undefined;
}

/**
 * Minimal Express `Response` surface available to **custom request handlers**
 * (a subset of Express's `Response`). Write the HTTP response through this
 * object, e.g. `api.res.status(200).json({ ok: true })`.
 */
export interface ScriptResponse {
    /** Sets the HTTP status code (chainable). */
    status(code: number): ScriptResponse;
    /** Sends the response body (string, Buffer, object, …) and ends the response. */
    send(body?: unknown): ScriptResponse;
    /** Sends a JSON response and ends the response. */
    json(body: unknown): ScriptResponse;
    /** Sets a response header (chainable). */
    setHeader(name: string, value: string | string[]): ScriptResponse;
    /** Sets a response header (Express alias of `setHeader`, chainable). */
    set(field: string, value?: string): ScriptResponse;
    /** Redirects to the given URL. */
    redirect(url: string): void;
    /** Ends the response without further data. */
    end(): void;
}

/**
 * The `api` global available inside **backend** script notes
 * (`application/javascript;env=backend`). Runs server-side: no DOM, no jQuery.
 */
export interface BackendApi {
    /**
     * Note where the script started executing (entrypoint).
     * As an analogy, in C this would be the file which contains the main() function of the current process.
     */
    startNote?: ScriptBNote | null;
    /**
     * Note where the script is currently executing. This comes into play when your script is spread in multiple code
     * notes, the script starts in "startNote", but then through function calls may jump into another note (currentNote).
     * A similar concept in C would be __FILE__
     * Don't mix this up with the concept of active note.
     */
    currentNote: ScriptBNote;
    /**
     * Entity whose event triggered this execution
     */
    originEntity?: unknown | null;

    /**
     * Express request object. Available only inside custom request handlers — a note
     * with the `#customRequestHandler` label, invoked via a `/custom/...` URL. The
     * editor surfaces this member only for such notes (where the request always
     * supplies it), so it is non-optional rather than forcing a null-check.
     */
    req: ScriptRequest;
    /**
     * Express response object — write the HTTP response here, e.g.
     * `api.res.status(200).json({ ok: true })`. Available only inside custom request
     * handlers (where it is always supplied), so it is non-optional.
     */
    res: ScriptResponse;
    /**
     * The capture groups from the `#customRequestHandler` regex that matched this
     * request's URL, in order. Available only inside custom request handlers.
     */
    pathParams: string[];

    /**
     * day.js library for date manipulation. See {@link https://day.js.org} for documentation
     */
    dayjs: ScriptDayjs;
    /**
     * xml2js library for XML parsing. See {@link https://github.com/Leonidas-from-XIV/node-xml2js} for documentation
     */
    xml2js: unknown;
    /**
     * cheerio library for HTML parsing and manipulation. See {@link https://cheerio.js.org} for documentation
     * @deprecated cheerio will be removed in a future version. Use api.htmlParser (node-html-parser) instead.
     */
    cheerio: unknown;
    /**
     * node-html-parser library for HTML parsing. See {@link https://github.com/piotr-nicol/node-html-parser} for documentation.
     * This is the recommended replacement for cheerio.
     */
    htmlParser: unknown;

    /**
     * Instance name identifies particular Trilium instance. It can be useful for scripts
     * if some action needs to happen on only one specific instance.
     */
    getInstanceName(): string | null;

    /** Returns a note by its ID, or null. */
    getNote(noteId: string): ScriptBNote | null;
    /** Returns a branch by its ID, or null. */
    getBranch(branchId: string): ScriptBBranch | null;
    /** Returns an attribute by its ID, or null. */
    getAttribute(attributeId: string): ScriptAttribute | null;
    /** Returns an attachment by its ID, or null. */
    getAttachment(attachmentId: string): unknown | null;
    /** Returns a revision by its ID, or null. */
    getRevision(revisionId: string): unknown | null;
    /** Returns an ETAPI token by its ID, or null. */
    getEtapiToken(etapiTokenId: string): unknown | null;
    /** Returns all ETAPI tokens. */
    getEtapiTokens(): unknown[];
    /** Returns an option by name, or null. */
    getOption(optionName: string): unknown | null;
    /** Returns all options. */
    getOptions(): unknown[];

    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See {@link https://triliumnext.github.io/Docs/Wiki/search.html} for full documentation for all options
     */
    searchForNotes(query: string, searchParams?: Record<string, unknown>): ScriptBNote[];
    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See {@link https://triliumnext.github.io/Docs/Wiki/search.html} for full documentation for all options
     */
    searchForNote(query: string, searchParams?: Record<string, unknown>): ScriptBNote | null;
    /**
     * Retrieves notes with given label name & value
     *
     * @param name - attribute name
     * @param value - attribute value
     */
    getNotesWithLabel(name: string, value?: string): ScriptBNote[];
    /**
     * Retrieves first note with given label name & value
     *
     * @param name - attribute name
     * @param value - attribute value
     */
    getNoteWithLabel(name: string, value?: string): ScriptBNote | null;

    /**
     * If there's no branch between note and parent note, create one. Otherwise, do nothing. Returns the new or existing branch.
     *
     * @param prefix - if branch is created between note and parent note, set this prefix
     */
    ensureNoteIsPresentInParent(noteId: string, parentNoteId: string, prefix?: string): { branch: ScriptBBranch | null };
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
    toggleNoteInParent(present: boolean, noteId: string, parentNoteId: string, prefix?: string): void;

    /**
     * Create text note. See also createNewNote() for more options.
     */
    createTextNote(parentNoteId: string, title: string, content: string): ScriptNoteAndBranch;
    /**
     * Create data note - data in this context means object serializable to JSON. Created note will be of type 'code' and
     * JSON MIME type. See also createNewNote() for more options.
     */
    createDataNote(parentNoteId: string, title: string, content: object): ScriptNoteAndBranch;
    /**
     * @returns object contains newly created entities note and branch
     */
    createNewNote(params: {
        parentNoteId: string;
        title: string;
        content: string | Uint8Array;
        type: string;
        mime?: string;
        [key: string]: unknown;
    }): ScriptNoteAndBranch;

    /** Per-note log message buffers shown in the UI log pane. */
    logMessages: Record<string, string[]>;
    /** Per-note spaced-update handlers for the log pane. */
    logSpacedUpdates: Record<string, unknown>;
    /**
     * Log given message to trilium logs and log pane in UI.
     * Accepts multiple arguments which are joined with spaces, similar to `console.log`.
     */
    log(...args: unknown[]): void;

    /**
     * Returns root note of the calendar.
     */
    getRootCalendarNote(): ScriptBNote | null;
    /**
     * Returns day note for given date. If such note doesn't exist, it is created.
     *
     * @method
     * @param date in YYYY-MM-DD format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getDayNote(date: string, rootNote?: ScriptBNote): ScriptBNote | null;
    /**
     * Returns today's day note. If such note doesn't exist, it is created.
     *
     * @param rootNote specify calendar root note, normally leave empty to use the default calendar
     */
    getTodayNote(rootNote?: ScriptBNote): ScriptBNote | null;
    /**
     * Returns note for the first date of the week of the given date.
     *
     * @param date in YYYY-MM-DD format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getWeekFirstDayNote(date: string, rootNote?: ScriptBNote): ScriptBNote | null;
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
    getWeekNote(date: string, rootNote?: ScriptBNote): ScriptBNote | null;
    /**
     * Returns month note for given date. If such a note doesn't exist, it is created.
     *
     * @param date in YYYY-MM format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getMonthNote(date: string, rootNote?: ScriptBNote): ScriptBNote | null;
    /**
     * Returns quarter note for given date. If such a note doesn't exist, it is created.
     *
     * @param date in YYYY-MM format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getQuarterNote(date: string, rootNote?: ScriptBNote): ScriptBNote | null;
    /**
     * Returns year note for given year. If such a note doesn't exist, it is created.
     *
     * @param year in YYYY format
     * @param rootNote - specify calendar root note, normally leave empty to use the default calendar
     */
    getYearNote(year: string, rootNote?: ScriptBNote): ScriptBNote | null;

    /**
     * Sort child notes of a given note.
     */
    sortNotes(parentNoteId: string, sortConfig: { sortBy?: string; reverse?: boolean; foldersFirst?: boolean }): void;
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
    transactional<T>(func: () => T): T;

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
    escapeHtml(str: string): string;
    /**
     * @param string to unescape
     * @returns unescaped string
     */
    unescapeHtml(str: string): string;
    /**
     * sql
     * @type {module:sql}
     */
    sql: unknown;
    /** Application info (version, build date, etc.). */
    getAppInfo(): unknown;

    /**
     * Creates a new launcher to the launchbar. If the launcher (id) already exists, it will be updated.
     */
    createOrUpdateLauncher(opts: {
        id: string;
        type: "note" | "script" | "customWidget";
        title: string;
        isVisible: boolean;
        icon: string;
        keyboardShortcut: string;
        targetNoteId?: string;
        scriptNoteId?: string;
        widgetNoteId?: string;
    }): { note: ScriptBNote };
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
    runOnFrontend(script: (() => void) | string, params?: unknown[]): void;
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
    duplicateSubtree(origNoteId: string, newParentNoteId: string): ScriptNoteAndBranch;
}
