<!-- Generated from script_api.ts by `pnpm edit-docs:sync-docs`. Do not edit. -->

## API reference

Every member of `api` and of the objects it returns, as TypeScript declarations, each under the first sentence of its description.

```ts
/** The `api` global available inside **frontend** script notes (`application/javascript;env=frontend`). */
interface FrontendApi {
    /** The element a render note's script renders into: the script of a note that a `~renderNote` relation points to. */
    $container: JQuery | null;
    /** Note where the script execution started — the entry point of the current script bundle (in C terms, the file containing `main()`). */
    startNote: FNote;
    /** Note containing the source code that is currently executing (in C terms, `__FILE__`). */
    currentNote: FNote;
    /** Entity whose event triggered this execution, or `null`. */
    originEntity: FNote | null;
    /** day.js library for date manipulation. */
    dayjs: Dayjs;
    /** Base class for right-panel widgets — `class X extends api.RightPanelWidget { … }`. */
    RightPanelWidget: WidgetClass<RightPanelWidget>;
    /** Base class for note-context-aware widgets — `class X extends api.NoteContextAwareWidget { … }`. */
    NoteContextAwareWidget: WidgetClass<NoteContextAwareWidget>;
    /** Base class for basic widgets — `class X extends api.BasicWidget { … }`. */
    BasicWidget: WidgetClass<BasicWidget>;
    /** Activates note in the tree and in the note detail. */
    activateNote(notePath: string): Promise<void>;
    /** Activates newly created note. */
    activateNewNote(notePath: string): Promise<void>;
    /** Open a note in a new tab. */
    openTabWithNote(notePath: string, activate: boolean): Promise<void>;
    /** Open a note in a new split. */
    openSplitWithNote(notePath: string, activate: boolean): Promise<void>;
    /** Executes given anonymous function on the backend. */
    runOnBackend(func: Func, params?: unknown[]): Promise<unknown>;
    /** Executes given anonymous function on the backend. */
    runAsyncOnBackendWithManualTransactionHandling(func: Func, params?: unknown[]): Promise<unknown>;
    /** Whether backend script execution is enabled on the server (the `[Security] backendScriptingEnabled` config toggle). */
    isBackendScriptingEnabled(): boolean;
    /** Whether the SQL console is enabled on the server (the `[Security] sqlConsoleEnabled` config toggle). */
    isSqlConsoleEnabled(): boolean;
    /** This is a powerful search method - you can search by attributes and their values, e.g.: "#dateModified =* MONTH AND #log". */
    searchForNotes(searchString: string): Promise<FNote[]>;
    /** This is a powerful search method - you can search by attributes and their values, e.g.: "#dateModified =* MONTH AND #log". */
    searchForNote(searchString: string): Promise<FNote | null>;
    /** Returns note by given noteId. */
    getNote(noteId: string): Promise<FNote | null>;
    /** Returns list of notes. */
    getNotes(noteIds: string[], silentNotFoundError?: boolean): Promise<FNote[]>;
    /** Update frontend tree (note) cache from the backend. */
    reloadNotes(noteIds: string[]): Promise<void>;
    /** Creates a new note as a child of the given parent, entirely on the frontend — no backend scripting required (unlike `api.runOnBackend(() => api.createTextNote(...))`). */
    createNote(parentNotePath: string, opts?: CreateNoteOpts): Promise<{ note: FNote | null; branch: FBranch | undefined }>;
    /** Instance name identifies particular Trilium instance. */
    getInstanceName(): string | null;
    /** Adds given text to the editor cursor */
    addTextToActiveContextEditor(text: string): void;
    getActiveContextNote(): FNote;
    /** Obtains the currently active/focused split in the current tab. */
    getActiveContext(): NoteContext;
    /** Obtains the main context of the current tab. */
    getActiveMainContext(): NoteContext;
    getNoteContexts(): NoteContext[];
    getMainNoteContexts(): NoteContext[];
    /** Returns the editor of the text note in the active tab or split. */
    getActiveContextTextEditor(): Promise<TextEditor | null>;
    /** Returns the editor of the code note in the active tab or split. */
    getActiveContextCodeEditor(): Promise<CodeEditor | null>;
    /** Get access to the widget handling note detail. */
    getActiveNoteDetailWidget(): Promise<unknown>;
    getActiveContextNotePath(): string | null;
    /** Returns component which owns the given DOM element (the nearest parent component in DOM tree) */
    getComponentByEl(el: HTMLElement): unknown;
    /** Show an info toast message to the user. */
    showMessage(message: string, delay?: number): void;
    /** Show an error toast message to the user. */
    showError(message: string, delay?: number): void;
    /** Show an info dialog to the user. */
    showInfoDialog(message: string): Promise<void>;
    /** Show confirm dialog to the user. */
    showConfirmDialog(message: string): Promise<boolean>;
    /** Show prompt dialog to the user. */
    showPromptDialog(props: { title?: string; message?: string; defaultValue?: string }): Promise<string | null>;
    /** Show a dialog for picking one item out of many, grouped and searchable. `items` are either the items themselves or groups of them, never the two mixed. */
    pickSingleItem(props: { title?: string; items: PickerItem[] | PickerItemGroup[]; placeholder?: string }): Promise<PickerItem | null>;
    /** Create a note link (jQuery object) for given note. */
    createLink(notePath: string, params?: LinkOptions): Promise<JQuery>;
    /** Trigger command. */
    triggerCommand(name: string, data?: Record<string, unknown>): Promise<unknown>;
    /** Trigger event. */
    triggerEvent(name: string, data?: Record<string, unknown>): Promise<unknown>;
    /** Shows a preview of the linked note while the mouse pointer rests on the element, as Trilium does for links in note content. */
    setupElementTooltip(el: JQuery): void;
    protectNote(noteId: string, protect: boolean): Promise<void>;
    protectSubTree(noteId: string, protect: boolean): Promise<void>;
    /** Returns date-note for today. */
    getTodayNote(): Promise<FNote>;
    /** Returns day note for a given date. */
    getDayNote(date: string): Promise<FNote>;
    /** Returns day note for the first date of the week of the given date. */
    getWeekFirstDayNote(date: string): Promise<FNote>;
    /** Returns week note for given date. */
    getWeekNote(date: string): Promise<FNote>;
    /** Returns month-note. */
    getMonthNote(month: string): Promise<FNote>;
    /** Returns quarter note for given date. */
    getQuarterNote(date: string): Promise<FNote>;
    /** Returns year-note. */
    getYearNote(year: string): Promise<FNote>;
    /** Hoist note in the current tab. */
    setHoistedNoteId(noteId: string): void;
    bindGlobalShortcut(keyboardShortcut: string, handler: () => void, namespace?: string): void;
    /** Trilium runs in a backend and frontend process, when something is changed on the backend from a script, frontend will get asynchronously synchronized. */
    waitUntilSynced(): Promise<unknown>;
    /** This will refresh all currently opened notes which have included note specified in the parameter */
    refreshIncludedNote(includedNoteId: string): void;
    /** Return randomly generated string of given length. */
    randomString(length: number): string;
    formatSize(size: number): string;
    /** Converts the given HTML string to Markdown. */
    htmlToMarkdown(html: string): Promise<string>;
    /** Converts the given Markdown string to HTML. */
    markdownToHtml(markdown: string): Promise<string>;
    formatDateISO(date: Date): string;
    /** Parses a date string into a Date. */
    parseDate(str: string): Date;
    /** Per-note log message buffers shown in the UI log pane. */
    logMessages: Record<string, string[]>;
    /** Per-note spaced-update handlers for the log pane. */
    logSpacedUpdates: Record<string, unknown>;
    /** Log given message to the log pane in UI. */
    log(...args: unknown[]): void;
    /** The Preact API surface (components, hooks) for render scripts. */
    preact: Preact;
}

/** A note as seen by frontend scripts (subset of the client's `FNote`). */
interface FNote {
    /** The ID of the note. */
    noteId: string;
    /** The title of the note. */
    title: string;
    /** The note type, such as `text`, `code`, `file`, `image`, `search`, `book`, `render` or `launcher`. */
    type: string;
    /** The MIME type of the note's content, such as `application/json`. */
    mime: string;
    /** Whether the note is protected (encrypted). */
    isProtected: boolean;
    /** Whether the note is archived (has the `archived` label). */
    isArchived: boolean;
    /** Whether the note's title and icon cannot be edited, which is the case for the system notes behind the options, the in-app help and the launch bar configuration. */
    isMetadataReadOnly: boolean;
    /** IDs of this note's owned attributes. */
    attributes: string[];
    /** IDs of relations pointing *at* this note. */
    targetRelations: string[];
    /** Parent note IDs. */
    parents: string[];
    /** Child note IDs. */
    children: string[];
    /** Returns the parent notes that the client has already loaded. */
    getParentNotes(): FNote[];
    /** Loads any missing child notes from the server, then returns all child notes in tree order. */
    getChildNotes(): Promise<FNote[]>;
    /** Returns the IDs of the parent notes. */
    getParentNoteIds(): string[];
    /** Returns the IDs of the child notes in tree order, archived ones included. */
    getChildNoteIds(): string[];
    /** Returns the IDs of the child notes in tree order, leaving out archived notes unless `includeArchived` is `true`. */
    getChildNoteIdsWithArchiveFiltering(includeArchived?: boolean): Promise<string[]>;
    /** Returns all descendants of the note, loading missing ones from the server one level at a time. */
    getSubtreeNotes(): Promise<FNote[]>;
    /** Returns the IDs of all the note's descendants, depth-first, without the note itself. */
    getSubtreeNoteIds(includeArchived?: boolean): Promise<string[]>;
    /** Returns `true` if the note has at least one child, archived ones included. */
    hasChildren(): boolean;
    /** Returns `true` if the note with the given ID is this note or one of its ancestors. */
    hasAncestor(ancestorNoteId: string, followTemplates?: boolean): boolean;
    /** Returns `true` if this is the root note of the tree. */
    isRoot(): boolean;
    /** Returns the IDs of the branches that place this note under each of its parents. */
    getParentBranchIds(): string[];
    /** Returns the branches that place this note under each of its parents. */
    getParentBranches(): FBranch[];
    /** Returns the branches to this note's children, in tree order. */
    getChildBranches(): FBranch[];
    /** Returns the same branches as `getChildBranches()`. */
    getFilteredChildBranches(): FBranch[];
    /** Returns every path from the root to the note, each as a list of note IDs that starts with `root`. */
    getAllNotePaths(): string[][];
    /** Returns the note's best path as a list of note IDs that starts with `root`. */
    getBestNotePath(hoistedNoteId?: string, activeNotePath?: string | null): string[];
    /** Returns the note's best path, as `getBestNotePath()` chooses it, as note IDs joined by `/`, such as `root/a1h315/js725h`. */
    getBestNotePathString(hoistedNoteId?: string): string;
    /** Returns every path from the root to this note, best first. */
    getSortedNotePathRecords(hoistedNoteId?: string, activeNotePath?: string | null): NotePathRecord[];
    /** Returns the note's attributes, including inherited ones, optionally only those of the given type and name. */
    getAttributes(type?: string, name?: string): Attribute[];
    /** Returns the note's own attributes, without inherited ones, optionally only those of the given type and name. */
    getOwnedAttributes(type?: string, name?: string): Attribute[];
    /** Returns the first attribute of the given type and name, including inherited ones, or `undefined` if the note has none. */
    getAttribute(type: string, name: string): Attribute | null;
    /** Returns the first of the note's own attributes with the given type and name, or `undefined` if the note has none. */
    getOwnedAttribute(type: string, name: string): Attribute | null;
    /** Returns the value of the first attribute of the given type and name, including inherited ones, or `null` if the note has none. */
    getAttributeValue(type: string, name: string): string | null;
    /** Returns the value of the first of the note's own attributes with the given type and name, or `null` if the note has none. */
    getOwnedAttributeValue(type: string, name: string): string | null;
    /** Returns whether the note has an attribute of the given type and name, including inherited ones. */
    hasAttribute(type: string, name: string): boolean;
    /** Returns whether the note itself has an attribute of the given type and name, without inherited ones. */
    hasOwnedAttribute(type: string, name: string): boolean;
    /** Returns the attribute definitions that apply to the note, at most one per defined name. */
    getAttributeDefinitions(): Attribute[];
    /** Returns the attribute definitions that are marked as promoted, at most one per name, grouped by the note that owns them and ordered by position. */
    getPromotedDefinitionAttributes(): Attribute[];
    /** Returns the note's labels, including inherited ones, optionally only those with `name`. */
    getLabels(name?: string): Attribute[];
    /** Returns the note's own labels, without inherited ones, optionally only those with `name`. */
    getOwnedLabels(name?: string): Attribute[];
    /** Returns the first label with the given name, including inherited ones, or `undefined` if the note has none. */
    getLabel(name: string): Attribute | null;
    /** Returns the first of the note's own labels with the given name, or `undefined` if the note has none. */
    getOwnedLabel(name: string): Attribute | null;
    /** Returns the value of the first label with the given name, including inherited ones, or `null` if the note has none. */
    getLabelValue(name: string): string | null;
    /** Returns the value of the first of the note's own labels with the given name, or `null` if the note has none. */
    getOwnedLabelValue(name: string): string | null;
    /** Returns whether the note has a label with the given name, including inherited ones. */
    hasLabel(name: string): boolean;
    /** Returns whether the note itself has a label with the given name, without inherited ones. */
    hasOwnedLabel(name: string): boolean;
    /** Returns whether the note has a label with the given name, including inherited ones, or the same label with the `disabled:` prefix, which a safe import gives it. */
    hasLabelOrDisabled(name: string): boolean;
    /** Returns whether the note has a label with the given name, including inherited ones, whose value is anything but `false`. */
    isLabelTruthy(name: string): boolean;
    /** Returns the note's relations, including inherited ones, optionally only those with `name`. */
    getRelations(name?: string): Attribute[];
    /** Returns the note's own relations, without inherited ones, optionally only those with `name`. */
    getOwnedRelations(name: string): Attribute[];
    /** Returns the first relation with the given name, including inherited ones, or `undefined` if the note has none. */
    getRelation(name: string): Attribute | null;
    /** Returns the first of the note's own relations with the given name, or `undefined` if the note has none. */
    getOwnedRelation(name: string): Attribute | null;
    /** Returns the target note ID of the first relation with the given name, including inherited ones, or `null` if the note has none. */
    getRelationValue(name: string): string | null;
    /** Returns the target note ID of the first of the note's own relations with the given name, or `null` if the note has none. */
    getOwnedRelationValue(name: string): string | null;
    /** Returns whether the note has a relation with the given name, including inherited ones. */
    hasRelation(name: string): boolean;
    /** Returns whether the note itself has a relation with the given name, without inherited ones. */
    hasOwnedRelation(name: string): boolean;
    /** Returns the value of a label or relation, inherited ones included, or `null` if the note has none. */
    getLabelOrRelation(nameWithPrefix: string): string | null;
    /** Returns the target note of the first relation with the given name, including inherited ones. */
    getRelationTarget(name: string): Promise<FNote | null>;
    /** Returns the target notes of the note's relations with the given name, including inherited ones, in the order of the relations. */
    getRelationTargets(name: string): Promise<(FNote | null)[]>;
    /** Returns the relations, owned by any note, that point at this note. */
    getTargetRelations(): Attribute[];
    /** Returns the notes that own a relation pointing at this note. */
    getTargetRelationSourceNotes(): Promise<FNote[]>;
    /** Fetches the note's content from the server. */
    getContent(): Promise<string | Uint8Array<ArrayBufferLike>>;
    /** Fetches the note's content and parses it as JSON. */
    getJsonContent(): Promise<unknown>;
    /** Fetches the note's content together with its blob ID, length and modification date. */
    getBlob(): Promise<Blob | null>;
    /** Returns the note's creation and modification dates, which it requests from the server. */
    getMetadata(): Promise<NoteMetadata>;
    /** The note's attachments, or `null` until `getAttachments()` loads them. */
    attachments: Attachment[] | null;
    /** Returns the note's attachments. */
    getAttachments(): Promise<Attachment[]>;
    /** Returns the note's attachments with the given role, such as `image` or `file`. */
    getAttachmentsByRole(role: string): Promise<Attachment[]>;
    /** Returns the note's attachment with the given ID, or `undefined` if this note has no such attachment. */
    getAttachmentById(attachmentId: string): Promise<Attachment | undefined>;
    /** Returns the target notes of this note's `~template` and `~inherit` relations, inherited relations included. */
    getNotesToInheritAttributesFrom(): FNote[];
    /** Returns the CSS classes of the note's icon, such as `tn-icon bx bx-note`. */
    getIcon(): string;
    /** Returns `true` if the note shows as a folder in the tree: a search note, or a note with children (archived ones included). */
    isFolder(): boolean;
    /** Returns `true` if the note is placed, directly or through ancestors the client has loaded, under the shared notes root (`_share`). */
    isShared(): boolean;
    /** Returns `true` if the note's content can be read: the note is not protected, or a protected session is active. */
    isContentAvailable(): boolean;
    /** Returns `true` if the note's MIME type is `application/json`. */
    isJson(): boolean;
    /** Returns whether the note is a code, file or launcher note with a JavaScript MIME type. */
    isJavaScript(): boolean;
    /** Returns `true` if the note is a code note with the MIME type `text/jsx`. */
    isJsx(): boolean;
    /** Returns whether the note is a code, file or render note with the `text/html` MIME type. */
    isHtml(): boolean;
    /** Returns `true` if the note is a code note with a Markdown MIME type (`text/markdown`, `text/x-markdown` or `text/x-gfm`). */
    isMarkdown(): boolean;
    /** Returns `true` if the note is one of Trilium's settings pages. */
    isOptions(): boolean;
    /** Returns `true` if the note's MIME type starts with `application/javascript`, which covers both frontend and backend scripts. */
    isTriliumScript(): boolean;
    /** Returns `true` if the note is a SQL console note, which has the MIME type `text/x-sqlite;schema=trilium`. */
    isTriliumSqlite(): boolean;
    /** Returns `true` if the note is a launcher or one of the notes that hold the launch bar's launchers. */
    isLaunchBarConfig(): boolean;
    /** Returns whether every path to the note runs through the hidden subtree, so that no clone of it appears in the visible tree. */
    isHiddenCompletely(): boolean;
    /** Returns `true` if the note is the hidden subtree's root (`_hidden`) or has it as an ancestor through any of its loaded parents, even when the note is also cloned into the visible tree. */
    isInHiddenSubtree(): boolean;
    /** Returns `true` if the image note can be converted into an attachment of its parent: it is an image note without children, it has exactly one parent, that parent is a text note, the content of both is available, and no note other than the parent links to the image. */
    isEligibleForConversionToAttachment(): boolean;
    /** Returns the CSS class that applies the note's `color` label, such as `color-ff0000`, or an empty string if the label is missing or not a valid color. */
    getColorClass(): string;
    /** Returns the values of all the note's `cssClass` labels, inherited ones included, separated by spaces. */
    getCssClass(): string;
    /** Returns the value of the note's `workspaceIconClass` label, or an empty string if it has none. */
    getWorkspaceIconClass(): string;
    /** Returns the value of the note's `workspaceTabBackgroundColor` label, or an empty string if it has none. */
    getWorkspaceTabBackgroundColor(): string;
    /** Returns where the note runs as a script: `frontend` for HTML, JSX, render notes and JavaScript with `env=frontend` in its MIME type, `backend` for JavaScript with `env=backend`, and `null` for any other note. */
    getScriptEnv(): "frontend" | "backend" | null;
    /** Runs the note as a frontend or backend script, depending on `getScriptEnv()`. */
    executeScript(): Promise<unknown>;
    /** Blob ID of the current content; changes when content changes. */
    blobId: string;
    /** Map of parent note ID → branch ID. */
    parentToBranch: Record<string, string>;
    /** Map of child note ID → branch ID. */
    childToBranch: Record<string, string>;
    /** For a search note, `true` once its results have been loaded as its children; otherwise not set. */
    searchResultsLoaded?: boolean;
    /** For a search note whose results are loaded, the search words to highlight in those results; otherwise not set. */
    highlightedTokens?: string[];
    /** Plain data representation of the note (the live object minus its cache handle). */
    dto: Record<string, unknown>;
    /** Adds a parent to this note in the client's cache only. */
    addParent(parentNoteId: string, branchId: string, sort?: boolean): void;
    /** Adds a child to this note in the client's cache only. */
    addChild(childNoteId: string, branchId: string, sort?: boolean): void;
    /** Reorders the parent list in the client's cache so that ordinary parents come before search notes, archived notes and notes outside the visible tree. */
    sortParents(): void;
    /** Reorders the child list in the client's cache by each branch's position. */
    sortChildren(): void;
    /** Overwrites the note's ID, title, type, MIME type, protection flag and blob ID in the client's cache with the values in `row`. */
    update(row: Record<string, unknown>): void;
    /** Returns a short description of the note for logging, such as `Note(noteId=abc123, title=My note)`. */
    toString(): string;
}

/** Instance shape of `RightPanelWidget` (subset) — a widget shown in the right sidebar. */
interface RightPanelWidget extends NoteContextAwareWidget {
    /** The title shown in the panel's header, `Untitled widget` unless overridden. */
    readonly widgetTitle: string;
    /** Builds the panel's body. */
    doRenderBody(): void | Promise<void>;
}

/** Instance shape of `NoteContextAwareWidget` (subset) — reacts to the active note. */
interface NoteContextAwareWidget extends BasicWidget {
    /** The note currently shown in this widget's context. */
    note: FNote | null;
    /** The ID of `note`, such as for `loadResults.isNoteContentReloaded(this.noteId)`. */
    readonly noteId: string | undefined;
    /** The path of `note` in the tree, such as `root/abc123/def456`. */
    readonly notePath: string | null | undefined;
    /** The ID of the note context (split) this widget is attached to. */
    readonly ntxId: string | null | undefined;
    /** The note context (split) this widget is attached to. */
    noteContext?: NoteContext;
    /** Returns whether `noteId` is the note shown in this widget's context. */
    isNote(noteId: string): boolean;
    /** Updates the widget for the note in its context. */
    refreshWithNote(note: FNote | null | undefined): void | Promise<void>;
    /** Forces a refresh against the current note. */
    refresh(): void | Promise<void>;
}

/** Instance shape of `BasicWidget` (subset) — the base for custom frontend widgets. */
interface BasicWidget {
    /** The widget's root element, which `doRender()` assigns, such as `this.$widget = $(TPL)`. */
    $widget: JQuery;
    /** Returns whether the widget is shown: always for a `BasicWidget`, and only while a note is active for a `NoteContextAwareWidget`. */
    isEnabled(): boolean | null | undefined;
    /** Builds the widget's DOM. */
    doRender(): void;
    /** Renders the widget and returns its root element. */
    render(): JQuery;
    /** Tears down the widget; override to release resources. */
    cleanup(): void;
    /** Shows or hides the widget from inside the widget itself, such as from `refreshWithNote()` when the note does not apply. */
    toggleInt(show: boolean | null | undefined): void;
    /** Fluent builder: set the element id. */
    id(id: string): this;
    /** Fluent builder: add a CSS class. */
    class(className: string): this;
    /** Sets an inline CSS property on the widget's root element, such as `css("padding-inline-start", "12px")`, and returns the widget for chaining. */
    css(name: string, value: string): this;
    /** Fluent builder: append child components. */
    child(...components: unknown[]): this;
}

/** A branch (parent↔child link) as seen by frontend scripts (subset of `FBranch`). */
interface FBranch {
    /** The unique ID of the branch. */
    branchId: string;
    /** The ID of the child note that this branch places in the tree. */
    noteId: string;
    /** The ID of the parent note. */
    parentNoteId: string;
    /** The place of the note among its siblings; the note tree lists siblings by ascending `notePosition`. */
    notePosition: number;
    /** The prefix shown before the note's title in the note tree, for this placement of the note only. */
    prefix?: string;
    /** Whether the note tree shows this branch expanded, with the note's children visible. */
    isExpanded?: boolean;
    /** Returns the child note, loading it from the server if the frontend cache does not hold it yet. */
    getNote(): Promise<FNote | null>;
    /** Returns the child note from the frontend cache, without contacting the server. */
    getNoteFromCache(): FNote | undefined;
    /** Returns the parent note, loading it from the server if the frontend cache does not hold it yet. */
    getParentNote(): Promise<FNote | null>;
    /** Returns whether the branch places its note directly under the root note. */
    isTopLevel(): boolean;
}

/** A split/tab context as seen by frontend scripts (subset of `NoteContext`). */
interface NoteContext {
    /** The ID of the note context, which identifies one tab or split. */
    ntxId: string | null;
    /** The note this context shows, or `null` if the context is empty. */
    note: FNote | null;
    /** The path of the note this context shows, as note IDs from `root` joined by `/`, such as `root/abc123/def456`. */
    notePath: string | null;
    /** Returns the CodeMirror editor of the code note this context shows. */
    getCodeEditor(): Promise<CodeEditor | null>;
    /** Returns the CKEditor instance of the editable text note this context shows. */
    getTextEditor(): Promise<TextEditor | null>;
}

/** A date as day.js wraps it (subset). */
interface DayjsInstance {
    /** Formats the date, such as `"YYYY-MM-DD"` for `2026-10-22`. */
    format(template?: string): string;
    /** Returns a new date, `value` units later. */
    add(value: number, unit: string): DayjsInstance;
    /** Returns a new date, `value` units earlier. */
    subtract(value: number, unit: string): DayjsInstance;
    /** Returns the date as a JavaScript `Date`. */
    toDate(): Date;
}

/** A jQuery object: one or more page elements with jQuery's methods, as `$(…)` returns. */
interface JQuery {}

/** Minimal day.js surface (the real API exposes the full day.js factory). */
type Dayjs = (date?: string | number | Date) => DayjsInstance;

/** Constructor type allowing `class X extends api.Widget { … }`. */
type WidgetClass<T> = new (...args: unknown[]) => T;

type Func = ((...args: unknown[]) => unknown) | string;

/** Options accepted by `FrontendApi.createNote`. */
interface CreateNoteOpts {
    /** Title of the new note. */
    title?: string | null;
    /** Content of the new note (HTML for text notes, source for code notes, etc.). */
    content?: string | null;
    /** Note type, e.g. "text" (default), "code", "book". */
    type?: string;
    /** MIME type, e.g. "application/javascript;env=frontend" for a frontend code note. */
    mime?: string;
    /** Note ID of a template to apply to the new note. */
    templateNoteId?: string;
    /** Create the note as protected (only takes effect when a protected session is available). */
    isProtected?: boolean;
    /** Activate (open) the new note after creation. */
    activate?: boolean;
    /** Which part of the activated note to focus. */
    focus?: "title" | "content";
    /** Where to place the note relative to the parent/target: "into" (default) or "after". */
    target?: string;
    /** Branch ID used together with `target: "after"`. */
    targetBranchId?: string;
    /** Attributes to set atomically on creation. */
    attributes?: CreateAttribute[];
}

/** The editor of a text note, a CKEditor 5 editor. */
interface TextEditor {}

/** The editor of a code note, a CodeMirror 6 `EditorView`. */
interface CodeEditor {}

/** One thing a picker offers, as `pickSingleItem` takes and answers with. */
interface PickerItem {
    /** The ID of the item. */
    key: string;
    /** The text shown for the item. */
    caption: string;
    /** An icon class, `bx` prefix included. */
    icon?: string;
    /** HTML shown in a tooltip while the item is hovered. */
    tooltip?: string;
}

/** A run of picker items under a heading of their own. */
interface PickerItemGroup {
    /** The ID of the group. */
    key: string;
    /** The heading shown above the group's items. */
    groupHeader: string;
    /** The items in the group, in the order the picker shows them. */
    items: PickerItem[];
}

/** Options of `api.createLink()`. */
interface LinkOptions {
    /** The text of the link. */
    title?: string;
    /** Whether a preview of the note shows while the mouse pointer rests on the link. */
    showTooltip?: boolean;
    /** Whether the path of the note's parents shows below the link. */
    showNotePath?: boolean;
    /** Whether the note's icon shows before the link. */
    showNoteIcon?: boolean;
    /** Whether the link is styled as a reference link, as in text notes. */
    referenceLink?: boolean;
    /** Whether an image, canvas or Mermaid note shows as its picture instead of a link. */
    autoConvertToImage?: boolean;
    /** Text shown right after the link's title. */
    titleSuffix?: string;
}

/** The Preact API that render notes import from `trilium:preact`: Preact's own functions and hooks, and Trilium's components and `defineWidget()`. */
interface Preact {}

/** One resolved tree path to a note (subset of the client's `NotePathRecord`). */
interface NotePathRecord {
    /** Whether a note on the path, the note itself included, is archived, which means it has the `#archived` label, owned or inherited. */
    isArchived: boolean;
    /** Whether the path passes through the hoisted note passed to `getSortedNotePathRecords()`. */
    isInHoistedSubTree: boolean;
    /** Whether the note itself is a search note. */
    isSearch?: boolean;
    /** The note IDs along the path, from `root` to the note itself. */
    notePath: string[];
    /** Whether the path passes through the hidden subtree, `_hidden`, which holds Trilium's system notes. */
    isHidden: boolean;
}

/** A label or relation attached to a note. */
interface Attribute {
    /** The ID of the attribute. */
    attributeId: string;
    /** The type of the attribute: `label` or `relation`. */
    type: "label" | "relation";
    /** The name of the attribute, without the `#` or `~` prefix. */
    name: string;
    /** The value of the attribute. */
    value: string;
    /** Whether the note's descendants inherit the attribute. */
    isInheritable: boolean;
    /** Not set by Trilium: neither frontend nor backend attributes carry this property, so it reads `undefined`. */
    isOwned: boolean;
}

/** A note's binary/text content blob (subset of the client's `FBlob`). */
interface Blob {
    /** The ID of the blob, derived from its content. */
    blobId: string;
    /** The content as text. */
    content: string;
    /** The length of the content as stored: characters for text, bytes for binary content. */
    contentLength: number;
    /** The local date and time this content was first stored, with the UTC offset, such as `2026-10-22 14:03:05.123+0200`. */
    dateModified: string;
    /** The date and time, in UTC, that this content was first stored, such as `2026-10-22 12:03:05.123Z`. */
    utcDateModified: string;
}

/** Creation/modification timestamps returned by `FNote.getMetadata`. */
interface NoteMetadata {
    /** The local date and time the note was created, with the UTC offset, such as `2026-10-22 14:03:05.123+0200`. */
    dateCreated: string;
    /** The date and time, in UTC, that the note was created, such as `2026-10-22 12:03:05.123Z`. */
    utcDateCreated: string;
    /** The local date and time the note was last modified, with the UTC offset, such as `2026-10-22 14:03:05.123+0200`. */
    dateModified: string;
    /** The date and time, in UTC, that the note was last modified, such as `2026-10-22 12:03:05.123Z`. */
    utcDateModified: string;
}

/** An attachment as seen by frontend scripts (subset of the client's `FAttachment`). */
interface Attachment {
    /** The ID of the attachment. */
    attachmentId: string;
    /** The ID of the note the attachment belongs to. */
    ownerId: string;
    /** The purpose of the attachment, such as `image` for an image shown in a text note or `file` for an attached file. */
    role: string;
    /** The MIME type of the attachment's content, such as `image/png`. */
    mime: string;
    /** The title of the attachment, usually its file name. */
    title: string;
    /** The date and time, in UTC, that the attachment was last saved, such as `2026-10-22 12:03:05.123Z`. */
    utcDateModified: string;
    /** The length of the attachment's content. */
    contentLength: number;
}

/** An attribute to create together with a note (see `CreateNoteOpts.attributes`). */
interface CreateAttribute {
    /** The type of the attribute: `label` or `relation`. */
    type: "label" | "relation";
    /** The name of the attribute, without the `#` or `~` prefix. */
    name: string;
    /** The value of the attribute. */
    value?: string;
    /** Whether the note's descendants inherit the attribute. */
    isInheritable?: boolean;
    /** The place of the attribute among the note's attributes, which are listed by ascending `position`. */
    position?: number;
}
```
