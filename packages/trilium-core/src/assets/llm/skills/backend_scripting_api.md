<!-- Generated from script_api.ts by `pnpm edit-docs:sync-docs`. Do not edit. -->

## API reference

Every member of `api` and of the objects it returns, as TypeScript declarations, each under the first sentence of its description.

```ts
/** The `api` global available inside **backend** script notes (`application/javascript;env=backend`). */
interface BackendApi {
    /** Note where the script execution started — the entry point of the current script bundle (in C terms, the file containing `main()`). */
    startNote?: BNote | null;
    /** Note containing the source code that is currently executing (in C terms, `__FILE__`). */
    currentNote: BNote;
    /** Entity whose event triggered this execution; `undefined` when the run was not event-driven (e.g. started manually via "Execute script" or `note.executeScript()`). */
    originEntity?: Attribute | BBranch | BNote | null;
    /** The HTTP request, present only when the script runs as a custom request handler: a note with the `#customRequestHandler` label, invoked through a `/custom/...` URL. */
    req: Request;
    /** The HTTP response to write the reply to, such as `api.res.status(200).json({ ok: true })`. */
    res: Response;
    /** The capture groups from the `#customRequestHandler` regex that matched this request's URL, in order. */
    pathParams: string[];
    /** day.js library for date manipulation. */
    dayjs: Dayjs;
    /** The xml2js library, which converts between XML and JavaScript objects. */
    xml2js: Xml2js;
    /** The node-html-parser library, which parses HTML into elements that can be queried. */
    htmlParser: HtmlParser;
    /** Instance name identifies particular Trilium instance. */
    getInstanceName(): string | null;
    /** Returns a note by its ID, or null. */
    getNote(noteId: string): BNote | null;
    /** Returns a branch by its ID, or null. */
    getBranch(branchId: string): BBranch | null;
    /** Returns an attribute by its ID, or null. */
    getAttribute(attributeId: string): Attribute | null;
    /** Returns an attachment by its ID, or null. */
    getAttachment(attachmentId: string): BAttachment | null;
    /** Returns a revision by its ID, or null. */
    getRevision(revisionId: string): BRevision | null;
    /** Returns an ETAPI token by its ID, or null. */
    getEtapiToken(etapiTokenId: string): BEtapiToken | null;
    /** Returns all ETAPI tokens. */
    getEtapiTokens(): BEtapiToken[];
    /** Returns an option by name, or null. */
    getOption(optionName: string): BOption | null;
    /** Returns all options. */
    getOptions(): BOption[];
    /** This is a powerful search method - you can search by attributes and their values, e.g.: "#dateModified =* MONTH AND #log". */
    searchForNotes(query: string, searchParams?: SearchParams): BNote[];
    /** This is a powerful search method - you can search by attributes and their values, e.g.: "#dateModified =* MONTH AND #log". */
    searchForNote(query: string, searchParams?: SearchParams): BNote | null;
    /** Retrieves notes with given label name & value */
    getNotesWithLabel(name: string, value?: string): BNote[];
    /** Retrieves first note with given label name & value */
    getNoteWithLabel(name: string, value?: string): BNote | null;
    /** If there's no branch between note and parent note, create one. */
    ensureNoteIsPresentInParent(noteId: string, parentNoteId: string, prefix?: string): { branch: BBranch | null };
    /** If there's a branch between note and parent note, remove it. */
    ensureNoteIsAbsentFromParent(noteId: string, parentNoteId: string): void;
    /** Based on the value, either create or remove branch between note and parent note. */
    toggleNoteInParent(present: boolean, noteId: string, parentNoteId: string, prefix?: string): void;
    /** Create text note. */
    createTextNote(parentNoteId: string, title: string, content: string): NoteAndBranch;
    /** Create data note - data in this context means object serializable to JSON. */
    createDataNote(parentNoteId: string, title: string, content: object): NoteAndBranch;
    createNewNote(params: { parentNoteId: string; title: string; content: string | Uint8Array<ArrayBufferLike>; type: string; mime?: string; [key: string]: unknown }): NoteAndBranch;
    /** Per-note log message buffers shown in the UI log pane. */
    logMessages: Record<string, string[]>;
    /** Per-note spaced-update handlers for the log pane. */
    logSpacedUpdates: Record<string, unknown>;
    /** Log given message to trilium logs and log pane in UI. */
    log(...args: unknown[]): void;
    /** Returns root note of the calendar. */
    getRootCalendarNote(): BNote | null;
    /** Returns day note for given date. */
    getDayNote(date: string, rootNote?: BNote): BNote | null;
    /** Returns today's day note. */
    getTodayNote(rootNote?: BNote): BNote | null;
    /** Returns note for the first date of the week of the given date. */
    getWeekFirstDayNote(date: string, rootNote?: BNote): BNote | null;
    /** Returns week note for given date. */
    getWeekNote(date: string, rootNote?: BNote): BNote | null;
    /** Returns month note for given date. */
    getMonthNote(date: string, rootNote?: BNote): BNote | null;
    /** Returns quarter note for given date. */
    getQuarterNote(date: string, rootNote?: BNote): BNote | null;
    /** Returns year note for given year. */
    getYearNote(year: string, rootNote?: BNote): BNote | null;
    /** Sort child notes of a given note. `sortBy` takes the `#sorted` grammar — comma-separated levels of `title`, `dateCreated`, `dateModified` or a label name, each optionally followed by `asc` or `desc` (`priority desc, dueDate`); `reverse` is the direction of the levels without their own, of the folders grouping and of ties. */
    sortNotes(parentNoteId: string, sortConfig: { sortBy?: string; reverse?: boolean; foldersFirst?: boolean }): void;
    /** This functions wraps code which is supposed to be running in transaction. */
    transactional<T>(func: () => T): T;
    /** Return randomly generated string of given length. */
    randomString(length: number): string;
    escapeHtml(str: string): string;
    unescapeHtml(str: string): string;
    /** Converts the given HTML string to Markdown. */
    htmlToMarkdown(html: string): string;
    /** Converts the given Markdown string to HTML. */
    markdownToHtml(markdown: string): string;
    /** Direct access to Trilium's SQLite database. */
    sql: Sql;
    /** Application info (version, build date, etc.). */
    getAppInfo(): AppInfo;
    /** Creates a new launcher to the launchbar. */
    createOrUpdateLauncher(opts: { id: string; type: "note" | "script" | "customWidget"; title: string; isVisible: boolean; icon: string; keyboardShortcut: string; targetNoteId?: string; scriptNoteId?: string; widgetNoteId?: string }): { note: BNote };
    exportSubtreeToZipFile(noteId: string, format: "markdown" | "html", zipFilePath: string): Promise<void>;
    /** Executes given anonymous function on the frontend(s). */
    runOnFrontend(script: string | (() => void), params?: unknown[]): void;
    /** Sync process can make data intermittently inconsistent. */
    runOutsideOfSync(callback: () => void): Promise<void>;
    backupNow(backupName: string): Promise<string>;
    /** Enables the complete duplication of the specified original note and all its children into the specified parent note. */
    duplicateSubtree(origNoteId: string, newParentNoteId: string): NoteAndBranch;
}

/** A note as seen by backend scripts (subset of trilium-core's `BNote`). */
interface BNote {
    /** The ID of the note. */
    noteId: string;
    /** The title of the note. */
    title: string;
    /** The note type, such as `text`, `code`, `file`, `image`, `search` or `book`. */
    type: string;
    /** The MIME type of the note's content, such as `text/html` for a text note or `application/javascript;env=backend` for a backend script. */
    mime: string;
    /** Whether the note is protected. */
    isProtected: boolean;
    /** Whether the note is archived: it has an `archived` label of its own or inherits one. */
    isArchived: boolean;
    /** Whether the note has been deleted, or its deletion is in progress. */
    isDeleted: boolean;
    /** Share root ID this note is published under, if any. */
    shareId: string;
    /** The ID of the blob that stores the note's content. */
    blobId: string;
    /** The date and time the note was created, in local time with its UTC offset, for example `2026-10-22 14:03:05.123+0200`. */
    dateCreated: string;
    /** The date and time the note was last modified, in local time with its UTC offset, for example `2026-10-22 14:03:05.123+0200`. */
    dateModified: string;
    /** The date and time the note was created, in UTC, for example `2026-10-22 12:03:05.123Z`. */
    utcDateCreated: string;
    /** The date and time the note was last modified, in UTC, for example `2026-10-22 12:03:05.123Z`. */
    utcDateModified: string;
    /** Returns the content of the note: a string for text-based notes (see `hasStringContent()`), a `Uint8Array` for binary ones such as images and files. */
    getContent(): string | Uint8Array<ArrayBufferLike>;
    /** Replaces the content of the note and saves it immediately; there is no need to call `save()` afterwards. */
    setContent(content: string | Uint8Array<ArrayBufferLike>, opts?: { forceFrontendReload?: boolean }): void;
    /** Returns the note's content parsed as JSON. */
    getJsonContent<T = unknown>(): T | null;
    /** Returns the note's content parsed as JSON, like `getJsonContent()`, but returns `null` instead of throwing an error when the content is not valid JSON. */
    getJsonContentSafely(): unknown;
    /** Serializes `content` to JSON, indented with tabs, and saves it as the note's content through `setContent()`, with the same errors. */
    setJsonContent(content: unknown): void;
    /** Returns whether `getContent()` returns a string rather than a `Uint8Array`. */
    hasStringContent(): boolean;
    /** Returns a file name for the note, as used when it is downloaded or exported: the title with characters invalid in file names removed (`untitled` when the title is empty), plus an extension. */
    getFileName(): string;
    /** Returns a single line of text that Trilium searches when matching notes: the note ID, type, MIME type, branch prefixes, title and attributes (as `#name=value` and `~name=value`, inherited ones included), lowercased and with diacritics removed. */
    getFlatText(): string;
    /** Plain serialisable representation of the note (the real return type is `NotePojo`). */
    getPojo(): Record<string, unknown>;
    /** Returns the note's title, or the literal string `[protected]` when the note is protected and no protected session is active. */
    getTitleOrProtected(): string;
    /** Returns the CSS classes of the note's icon, for example `tn-icon bx bx-note`. */
    getIcon(): string;
    /** The parent notes of this note: one per place the note appears in the tree, so a cloned note has several. */
    parents: BNote[];
    /** The child notes of this note, in their order in the tree. */
    children: BNote[];
    /** The branches that place this note under each of its parents, in the same order as `parents`. */
    parentBranches: BBranch[];
    /** The number of parent notes, which is greater than 1 for a cloned note. */
    parentCount: number;
    /** The number of child notes, including hidden and system notes. */
    childrenCount: number;
    /** Returns the parent notes of this note, one per place the note appears in the tree. */
    getParentNotes(): BNote[];
    /** Returns the child notes of this note, in their order in the tree. */
    getChildNotes(): BNote[];
    /** Returns the child notes that are shown in a shared note's navigation tree, in tree order. */
    getVisibleChildNotes(): BNote[];
    /** Returns the branches that place this note under each of its parents. */
    getParentBranches(): BBranch[];
    /** Returns the branches that connect this note to each of its children, in their order in the tree. */
    getChildBranches(): BBranch[];
    /** Returns the child branches whose notes are shown in a shared note's navigation tree, in tree order. */
    getVisibleChildBranches(): BBranch[];
    /** Returns the parent branches the user created, leaving out the automatic placements under the shared notes (`_share`) and the bookmarks (`_lbBookmarks`). */
    getStrongParentBranches(): BBranch[];
    /** Returns the same branches as `getChildBranches()`. */
    getFilteredChildBranches(): BBranch[];
    /** Returns whether the note has at least one child note, including hidden and system notes. */
    hasChildren(): boolean;
    /** Returns whether `getVisibleChildNotes()` returns at least one note. */
    hasVisibleChildren(): boolean;
    /** Returns every ancestor of the note across all of its paths in the tree, each note once, up to and including the root note. */
    getAncestors(): BNote[];
    /** Returns the IDs of the notes `getAncestors()` returns, in the same order. */
    getAncestorNoteIds(): string[];
    /** Returns the number of levels between this note and the given ancestor along the shortest path: `1` for a parent, `2` for a grandparent, and `0` for the note itself. */
    getDistanceToAncestor(ancestorNoteId: string): number;
    /** Returns whether the given note is an ancestor of this note on any of its paths. */
    hasAncestor(ancestorNoteId: string): boolean;
    /** Returns whether the given note lies on at least one of this note's paths from the root. */
    isDescendantOfNote(ancestorNoteId: string): boolean;
    /** Returns whether this note is the root of the note tree, whose ID is `root`. */
    isRoot(): boolean;
    /** Returns the note and all its descendants, each note once, together with every parent-child relationship among them, including those of cloned notes. */
    getSubtree(opts?: SubtreeOpts): { notes: BNote[]; relationships: SubtreeRelationship[] };
    /** Returns the IDs of this note and all its descendants, each once. */
    getSubtreeNoteIds(opts?: SubtreeOpts): string[];
    /** Returns the notes that this note's inheritable attributes reach: the note itself, its descendants, and every note that uses one of them as a `template` or `inherit` relation target, along with that note's descendants. */
    getSubtreeNotesIncludingTemplated(): BNote[];
    /** Returns the notes that this note's non-inheritable attributes apply to: the note itself and every note that uses it as a `template` or `inherit` relation target. */
    getInheritingNotes(): BNote[];
    /** Returns every path from the root note to this note, one per placement in the tree. */
    getAllNotePaths(): string[][];
    /** Returns the best path from the root note to this note as an array of note IDs, ranked as in `getSortedNotePathRecords()`. */
    getBestNotePath(hoistedNoteId?: string): string[];
    /** Returns the best path from the root note to this note as a string of note IDs joined by `/`, for example `root/a1h315/js725h`. */
    getBestNotePathString(hoistedNoteId?: string): string;
    /** Returns a record for every path from the root note to this note, best path first. */
    getSortedNotePathRecords(hoistedNoteId?: string): NotePathRecord[];
    /** Returns whether every path to this note passes through an archived note. */
    areAllNotePathsArchived(): boolean;
    /** The labels and relations defined directly on this note, without inherited ones. */
    ownedAttributes: Attribute[];
    /** The relations in other notes (or this one) that point to this note. */
    targetRelations: Attribute[];
    /** The number of labels and relations on this note, inherited ones and automatic link relations included. */
    attributeCount: number;
    /** The number of labels and relations defined directly on this note, automatic link relations included. */
    ownedAttributeCount: number;
    /** The number of labels on this note, inherited ones included. */
    labelCount: number;
    /** The number of labels defined directly on this note. */
    ownedLabelCount: number;
    /** The number of relations on this note, inherited ones included. */
    relationCount: number;
    /** The number of relations on this note, inherited ones included, together with the link relations Trilium creates automatically for links in note content. */
    relationCountIncludingLinks: number;
    /** The number of relations defined directly on this note, excluding the link relations Trilium creates automatically for links in note content. */
    ownedRelationCount: number;
    /** The number of relations defined directly on this note, together with the link relations Trilium creates automatically for links in note content. */
    ownedRelationCountIncludingLinks: number;
    /** The number of relations in other notes that point to this note, excluding the link relations Trilium creates automatically for links in note content. */
    targetRelationCount: number;
    /** The number of relations in other notes that point to this note, together with the link relations Trilium creates automatically for links in note content. */
    targetRelationCountIncludingLinks: number;
    /** Returns the labels and relations of this note, inherited ones included, optionally filtered by type and name. */
    getAttributes(type?: string, name?: string): Attribute[];
    /** Returns the labels and relations defined directly on this note, optionally filtered by type and name. */
    getOwnedAttributes(type?: string, name?: string): Attribute[];
    /** Returns the first attribute of the given type and name, inherited ones included, or `null` if there is none. */
    getAttribute(type: string, name: string): Attribute | null;
    /** Returns the first attribute of the given type and name defined directly on this note, or `null` if there is none. */
    getOwnedAttribute(type: string, name: string, value?: string | null): Attribute | null;
    /** Returns the value of the first attribute of the given type and name, inherited ones included, or `null` if there is none. */
    getAttributeValue(type: string, name: string): string | null;
    /** Returns the value of the first attribute of the given type and name defined directly on this note, or `null` if there is none. */
    getOwnedAttributeValue(type: string, name: string): string | null;
    /** Returns the attribute of this note with the given ID, inherited ones included, or `undefined` if there is none. */
    getAttributeById(attributeId: string): Attribute | undefined;
    /** Returns the first attribute of the given type whose name, and optionally value, matches regardless of letter case, or `undefined` if none does. */
    getAttributeCaseInsensitive(type: string, name: string, value?: string | null): Attribute | undefined;
    /** Returns `true` if the note has a label or relation of the given type and name, inherited ones included. */
    hasAttribute(type: string, name: string): boolean;
    /** Returns whether the note has a label or relation of the given type and name defined directly on it. */
    hasOwnedAttribute(type: string, name: string, value?: string): boolean;
    /** Returns the attribute definitions on this note, inherited ones included. */
    getLabelDefinitions(): Attribute[];
    /** Returns the relation definitions on this note, inherited ones included: the `#relation:*` labels that declare promoted relations, such as `#relation:author="promoted,single"`. */
    getRelationDefinitions(): Attribute[];
    /** Returns the relations in other notes (or this one) that point to this note, the automatic link relations included. */
    getTargetRelations(): Attribute[];
    /** Returns the first label with the given name, inherited ones included, or `null` if there is none. */
    getLabel(name: string): Attribute | null;
    /** Returns the first label with the given name defined directly on this note, or `null` if there is none. */
    getOwnedLabel(name: string): Attribute | null;
    /** Returns the labels of this note, inherited ones included. */
    getLabels(name?: string): Attribute[];
    /** Returns the labels with the given name defined directly on this note. */
    getOwnedLabels(name: string): Attribute[];
    /** Returns the value of the first label with the given name, inherited ones included, or `null` if there is none. */
    getLabelValue(name: string): string | null;
    /** Returns the value of the first label with the given name defined directly on this note, or `null` if there is none. */
    getOwnedLabelValue(name: string): string | null;
    /** Returns the values of all labels with the given name, inherited ones included, for labels that can occur more than once. */
    getLabelValues(name: string): string[];
    /** Returns the values of all labels with the given name defined directly on this note. */
    getOwnedLabelValues(name: string): string[];
    /** Returns whether the note has a label with the given name, inherited ones included. */
    hasLabel(name: string): boolean;
    /** Returns whether the note has a label with the given name defined directly on it. */
    hasOwnedLabel(name: string, value?: string): boolean;
    /** Returns whether the note has a label with the given name, inherited ones included, whose value is not `"false"`. */
    isLabelTruthy(name: string): boolean;
    /** Returns `true` if the note has an inheritable `#archived` label, owned or inherited, so that the note's descendants are archived too. */
    hasInheritableArchivedLabel(): boolean;
    /** Returns the first relation with the given name, inherited ones included, or `null` if there is none. */
    getRelation(name: string): Attribute | null;
    /** Returns the first relation with the given name defined directly on this note, or `null` if there is none. */
    getOwnedRelation(name: string): Attribute | null;
    /** Returns the relations of this note, inherited ones included. */
    getRelations(name?: string): Attribute[];
    /** Returns the relations defined directly on this note. */
    getOwnedRelations(name?: string | null): Attribute[];
    /** Returns the ID of the note that the first relation with the given name points to, inherited relations included, or `null` if there is none. */
    getRelationValue(name: string): string | null;
    /** Returns the ID of the note that the first relation with the given name defined directly on this note points to, or `null` if there is none. */
    getOwnedRelationValue(name: string): string | null;
    /** Returns the note that the first relation with the given name points to, or `null` if the note has no such relation. */
    getRelationTarget(name: string): BNote | null;
    /** Returns whether the note has a relation with the given name, inherited ones included. */
    hasRelation(name: string, value?: string): boolean;
    /** Returns whether the note has a relation with the given name defined directly on it. */
    hasOwnedRelation(name: string, value?: string): boolean;
    /** Adds a label to this note, saves it and returns it. */
    addLabel(name: string, value?: string, isInheritable?: boolean): Attribute;
    /** Adds a relation from this note to another note, saves it and returns it. */
    addRelation(name: string, targetNoteId: string, isInheritable?: boolean): Attribute;
    /** Adds a label or relation to this note, saves it and returns it. `addLabel()` and `addRelation()` do the same for one type. */
    addAttribute(type: string, name: string, value?: string, isInheritable?: boolean): Attribute;
    /** Sets the value of the first label with the given name defined directly on this note, or adds a non-inheritable label if the note has none of its own. */
    setLabel(name: string, value?: string): void;
    /** Points the first relation with the given name defined directly on this note to another note, or adds a non-inheritable relation if the note has none of its own. */
    setRelation(name: string, value?: string): void;
    /** Sets the value of the first attribute of the given type and name defined directly on this note, or adds a non-inheritable one if the note has none of its own. `setLabel()` and `setRelation()` do the same for one type. */
    setAttribute(type: string, name: string, value?: string): void;
    /** Sets the value of the attribute with the given ID, which must be defined directly on this note, and saves it. */
    setAttributeValueById(attributeId: string, value?: string): void;
    /** Sets the label like `setLabel()` when `enabled` is `true`, and removes it like `removeLabel()` when it is `false`. */
    toggleLabel(enabled: boolean, name: string, value?: string): void;
    /** Sets the relation like `setRelation()` when `enabled` is `true`, and removes it like `removeRelation()` when it is `false`. */
    toggleRelation(enabled: boolean, name: string, value?: string): void;
    /** Sets the attribute like `setAttribute()` when `enabled` is `true`, and removes it like `removeAttribute()` when it is `false`. */
    toggleAttribute(type: string, enabled: boolean, name: string, value?: string): void;
    /** Removes every label with the given name defined directly on this note. */
    removeLabel(name: string, value?: string): void;
    /** Removes every relation with the given name defined directly on this note. */
    removeRelation(name: string, value?: string): void;
    /** Removes every attribute of the given type and name defined directly on this note. */
    removeAttribute(type: string, name: string, value?: string): void;
    /** Returns `true` if another note uses this note as its template or inheritance source, through a `~template` or `~inherit` relation. */
    isInherited(): boolean;
    /** The number of revisions of this note. */
    revisionCount: number | null;
    /** Returns the saved revisions of this note, oldest first. */
    getRevisions(): BRevision[];
    /** Saves a revision that snapshots the note's current title, content and attachments, and returns it. */
    saveRevision(opts?: { description?: string; source?: string }): BRevision;
    /** Returns the attachments of this note, ordered by position. */
    getAttachments(): BAttachment[];
    /** Returns the attachment of this note with the given ID. */
    getAttachmentById(attachmentId: string): BAttachment;
    /** Returns the first attachment of this note whose title matches exactly, or `undefined` if none does. */
    getAttachmentByTitle(title: string): BAttachment | undefined;
    /** Returns the attachments of this note with the given role, such as `"image"` or `"file"`, ordered by position. */
    getAttachmentsByRole(role: string): BAttachment[];
    /** Saves an attachment of this note and returns it. */
    saveAttachment(attachment: SaveAttachmentInput, matchBy?: "title" | "attachmentId"): BAttachment;
    /** Converts this image note into an image attachment of its parent text note, points the parent's content at the attachment, deletes this note and returns the attachment. */
    convertToParentAttachment(opts?: { autoConversion?: boolean }): BAttachment | null;
    /** Returns `true` if this note can be converted into an attachment of its parent: it is an image note with no children and a single parent, the parent is a text note, both are readable in the current session, and at most one `~imageLink` relation points to the image, from the parent. */
    isEligibleForConversionToAttachment(opts?: { autoConversion?: boolean }): boolean;
    /** The size of the note's content in bytes. */
    contentSize: number | null;
    /** The size in bytes of the note's content together with its attachments, counting content that several of them share once. */
    contentAndAttachmentsSize: number | null;
    /** The size in bytes of the note's content together with its attachments and its revisions and their attachments, counting shared content once. */
    contentAndAttachmentsAndRevisionsSize: number | null;
    /** Places this note under another parent note as well, keeping its existing placements, and expands the new parent in the note tree. */
    cloneTo(parentNoteId: string): CloneResponse;
    /** Deletes the note from every place in the tree, together with its descendants that have no other placement, and runs its `runOnNoteDeletion` relations first. */
    deleteNote(deleteId?: string | null): void;
    /** Reorders this note's `parents` and `parentBranches` in memory so that archived and hidden parents come last, which makes Trilium prefer the other paths when it picks a note path. */
    sortParents(): void;
    /** Reorders this note's `children` array in memory by each child's `notePosition`. */
    sortChildren(): void;
    /** Returns the notes that match a search query. */
    searchNotesInSubtree(searchString: string): BNote[];
    /** Returns the first note that matches a search query, or `undefined` if none does. */
    searchNoteInSubtree(searchString: string): BNote | null;
    /** Runs the saved search of a search note and returns the notes it finds. */
    getSearchResultNotes(): BNote[];
    /** Returns `true` if this note is a search note or has at least one child, archived children included. */
    isFolder(): boolean;
    /** Returns `true` if the note's title and content can be read: the note is not protected, or a protected session is open. */
    isContentAvailable(): boolean;
    /** Returns whether this is a code, file or render note with the MIME type `text/html`. */
    isHtml(): boolean;
    /** Returns whether this is an image note, or a file note with an `image/*` MIME type. */
    isImage(): boolean;
    /** Returns whether this is a code, file or launcher note with a JavaScript MIME type. */
    isJavaScript(): boolean;
    /** Returns `true` if this is a code note with the MIME type `text/jsx`. */
    isJsx(): boolean;
    /** Returns whether the note's MIME type is `application/json`, whatever its type. */
    isJson(): boolean;
    /** Returns whether this is a code note with a Markdown MIME type. */
    isMarkdown(): boolean;
    /** Returns `true` if this note is one of the settings pages in the hidden subtree, whose IDs start with `_options`. */
    isOptions(): boolean;
    /** Returns `true` if this note is a launcher or one of the containers that configure the desktop or mobile launch bar. */
    isLaunchBarConfig(): boolean;
    /** Returns whether every path to this note passes through the hidden subtree (`_hidden`), so that the note has no placement in the visible tree. */
    isHiddenCompletely(): boolean;
    /** Returns `true` if this note is the hidden root note (`_hidden`) or lies under it in any of its placements. */
    isInHiddenSubtree(): boolean;
    /** Returns where the note runs as a script: `"backend"` for JavaScript with `env=backend` in its MIME type, `"frontend"` for frontend JavaScript, JSX, HTML and render notes, and `null` for notes that are not scripts. */
    getScriptEnv(): "frontend" | "backend" | null;
    /** Runs this note as a backend script and returns the script's return value, which is a promise for an async script. */
    executeScript(): unknown;
}

/** A branch (note→parent placement) as seen by backend scripts (subset of `BBranch`). */
interface BBranch {
    /** The ID of the branch. */
    branchId: string;
    /** The ID of the child note this branch places in the tree. */
    noteId: string;
    /** The ID of the parent note. */
    parentNoteId: string;
    /** The text shown before the note's title in the note tree for this placement only, or `null` if there is none. */
    prefix: string | null;
    /** The position of the note among its siblings under this parent; notes with lower values come first. */
    notePosition: number;
    /** Whether the note is expanded in the note tree at this placement, showing its children. */
    isExpanded: boolean;
    /** Returns the child note this branch places in the tree. */
    getNote(): BNote;
    /** Returns the parent note. */
    getParentNote(): BNote | null;
}

/** Minimal Express `Request` surface available to **custom request handlers** (a subset of Express's `Request` — re-declared here to keep this module self-contained). */
interface Request {
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

/** Minimal Express `Response` surface available to **custom request handlers** (a subset of Express's `Response`). */
interface Response {
    /** Sets the HTTP status code (chainable). */
    status(code: number): Response;
    /** Sends the response body (string, Buffer, object, …) and ends the response. */
    send(body?: unknown): Response;
    /** Sends a JSON response and ends the response. */
    json(body: unknown): Response;
    /** Sets a response header (chainable). */
    setHeader(name: string, value: string | string[]): Response;
    /** Sets a response header (Express alias of `setHeader`, chainable). */
    set(field: string, value?: string): Response;
    /** Redirects to the given URL. */
    redirect(url: string): void;
    /** Ends the response without further data. */
    end(): void;
}

/** An attachment as seen by backend scripts (subset of trilium-core's `BAttachment`). */
interface BAttachment {
    /** The ID of the attachment. */
    attachmentId?: string;
    /** The ID of the note the attachment belongs to. */
    ownerId: string;
    /** The purpose of the attachment: `image` for an image shown in a text note, `file` for an attached file. */
    role: string;
    /** The MIME type of the attachment's content, such as `image/png`. */
    mime: string;
    /** The title of the attachment, usually its file name. */
    title: string;
    /** The place of the attachment among its owner's attachments, listed by ascending position. */
    position?: number;
    /** Whether the attachment is protected (encrypted). */
    isProtected?: boolean;
    /** The ID of the blob that stores the content. */
    blobId?: string;
    /** The date and time, in UTC, that the attachment was last saved. */
    utcDateModified?: string;
    /** The length of the attachment's content, when it was loaded together with the attachment. */
    contentLength?: number;
    /** Returns the note the attachment belongs to, or `undefined` for a revision's attachment. */
    getNote(): BNote | undefined;
    /** Returns the content: a string for text-based content, a `Uint8Array` for binary content such as images. */
    getContent(): string | Uint8Array<ArrayBufferLike>;
    /** Replaces the content and saves it immediately. */
    setContent(content: string | Uint8Array<ArrayBufferLike>, opts?: { forceSave?: boolean; forceFrontendReload?: boolean }): void;
    /** Returns whether the content is text rather than binary, judged by the MIME type. */
    hasStringContent(): boolean;
    /** Returns whether the title and content can be read: the attachment is not protected, or a protected session is active. */
    isContentAvailable(): boolean;
    /** Returns the title, or `[protected]` when the title cannot be read. */
    getTitleOrProtected(): string;
    /** Returns the file name the attachment downloads under: its title with a fitting extension. */
    getFileName(): string;
    /** Turns the attachment into a child note of its owner and deletes the attachment. */
    convertToNote(): NoteAndBranch;
    /** Saves changes made to the attachment's properties, such as `title`. */
    save(): this;
    /** Deletes the attachment. */
    markAsDeleted(deleteId?: string | null): void;
}

/** A note revision as seen by backend scripts (subset of trilium-core's `BRevision`). */
interface BRevision {
    /** The ID of the revision. */
    revisionId?: string;
    /** The ID of the note this revision belongs to. */
    noteId: string;
    /** The note's type at the time of the revision, such as `"text"` or `"code"`. */
    type: string;
    /** The note's MIME type at the time of the revision. */
    mime: string;
    /** The note's title at the time of the revision. */
    title: string;
    /** When the note was last edited before the revision was saved, in local time with its UTC offset, formatted as `YYYY-MM-DD HH:mm:ss.SSS+ZZZZ` (for example, `2026-10-22 14:05:09.123+0200`). */
    dateLastEdited?: string;
    /** When the note was last edited before the revision was saved, in UTC, formatted as `YYYY-MM-DD HH:mm:ss.SSSZ` (for example, `2026-10-22 12:05:09.123Z`). */
    utcDateLastEdited?: string;
    /** The size of the revision's content in bytes, when it was loaded together with the revision. */
    contentLength?: number;
    /** Returns the content of the revision: a string for text-based note types, a `Uint8Array` for binary ones such as images and files. */
    getContent(): string | Uint8Array<ArrayBufferLike>;
    /** Returns the revision's content parsed as JSON. */
    getJsonContent(): unknown;
}

/** Direct access to Trilium's SQLite database (subset of trilium-core's `SqlService`). */
interface Sql {
    /** Returns the first row of the result, as an object of column names to values, or `undefined` when the query returns no rows. */
    getRow<T>(query: string, params?: unknown[]): T;
    /** Returns the first row of the result, or `null` when the query returns no rows. */
    getRowOrNull<T>(query: string, params?: unknown[]): T | null;
    /** Returns the first column of the first row, such as the count of `SELECT COUNT(*) FROM notes`, or `undefined` when the query returns no rows. */
    getValue<T>(query: string, params?: unknown[]): T;
    /** Returns every row of the result, each as an object of column names to values. */
    getRows<T>(query: string, params?: unknown[]): T[];
    /** Returns the first column of every row of the result. */
    getColumn<T>(query: string, params?: unknown[]): T[];
    /** Returns an object that maps the first column of each row to its second column. */
    getMap<K extends string | number | symbol, V>(query: string, params?: unknown[]): Record<K, V>;
    /** Returns the rows of the result one at a time, which keeps a large result out of memory. */
    iterateRows<T>(query: string, params?: unknown[]): IterableIterator<T>;
    /** Runs a statement that changes data, such as `UPDATE` or `INSERT`. */
    execute(query: string, params?: unknown[]): { changes: number; lastInsertRowid: number };
    /** Runs several statements separated by semicolons, without parameters. */
    executeScript(query: string): void;
    /** Calls `func` in a transaction: when it throws, every change it made is undone. */
    transactional<T>(func: () => T): T;
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

/** Minimal day.js surface (the real API exposes the full day.js factory). */
type Dayjs = (date?: string | number | Date) => DayjsInstance;

/** The [xml2js](https://github.com/Leonidas-from-XIV/node-xml2js) library, version 0.6, which converts between XML and JavaScript objects, such as with `xml2js.parseStringPromise(xml)`. */
interface Xml2js {}

/** The [node-html-parser](https://github.com/taoqf/node-html-parser) library, version 9, which parses HTML into elements that can be queried, such as with `htmlParser.parse(html).querySelectorAll("a")`. */
interface HtmlParser {}

/** An ETAPI token, which grants an external program access to the ETAPI (subset of trilium-core's `BEtapiToken`). */
interface BEtapiToken {
    /** The ID of the token. */
    etapiTokenId?: string;
    /** The name given to the token when it was created. */
    name: string;
    /** The date and time, in UTC, that the token was created. */
    utcDateCreated: string;
    /** The date and time, in UTC, that the token was last changed, such as renamed. */
    utcDateModified?: string;
    /** Whether the token has been deleted, which revokes it. */
    isDeleted: boolean;
}

/** An option, one of Trilium's settings (subset of trilium-core's `BOption`). */
interface BOption {
    /** The name of the option, such as `theme` or `locale`. */
    name: string;
    /** The value of the option. */
    value: string;
    /** Whether the option syncs to other devices; device-specific options do not. */
    isSynced?: boolean;
    /** The date and time, in UTC, that the option last changed. */
    utcDateModified?: string;
}

/** Options of `api.searchForNotes()` and `api.searchForNote()`. */
interface SearchParams {
    /** Whether to search only titles and attributes, leaving out note content, which is faster. */
    fastSearch?: boolean;
    /** Whether to include archived notes. */
    includeArchivedNotes?: boolean;
    /** Whether to include the hidden subtree's notes, such as settings and launchers. */
    includeHiddenNotes?: boolean;
    /** Whether to search the whole tree even while a note is hoisted. */
    ignoreHoistedNote?: boolean;
    /** The ID of a note to search under: only its descendants are found. */
    ancestorNoteId?: string;
    /** How deep under `ancestorNoteId` the found notes can lie: `eq`, `gt` or `lt` followed by a depth, such as `eq1` for its children only or `lt4` for less than four levels down. */
    ancestorDepth?: string;
    /** What to order the results by: a note property such as `title`, `dateCreated` or `dateModified`, or `relevancy`, the default. */
    orderBy?: string;
    /** `asc` or `desc`; the direction of `orderBy`. */
    orderDirection?: string;
    /** The largest number of results to return. */
    limit?: number | null;
    /** Whether to write how the query was parsed to the backend log. */
    debug?: boolean;
    /** Whether attribute conditions match loosely: `#status=done` also matches values that contain `done`, and `#stat` matches attributes whose name starts with `stat`. */
    fuzzyAttributeSearch?: boolean;
}

/** Result of the backend note-creation helpers. */
interface NoteAndBranch {
    /** The new note. */
    note: BNote;
    /** The branch that places the new note under its parent. */
    branch: BBranch;
}

/** Information about the running Trilium, as `api.getAppInfo()` returns it. */
interface AppInfo {
    /** The version of Trilium, such as `0.106.0`. */
    appVersion: string;
    /** The version of the database schema. */
    dbVersion: number;
    /** The version of Node.js; absent in the standalone and mobile apps, which have no Node.js. */
    nodeVersion?: string;
    /** The version of the sync protocol, which both sides of a sync must share. */
    syncVersion: number;
    /** When this build of Trilium was made. */
    buildDate: string;
    /** The Git commit this build of Trilium was made from. */
    buildRevision: string;
    /** The directory that holds the database and the other data; absent in the standalone and mobile apps. */
    dataDirectory?: string;
    /** The version of the protocol the web clipper speaks with Trilium. */
    clipperProtocolVersion: string;
    /** The date and time, in UTC, that Trilium started, in ISO 8601 form. */
    utcDateTime: string;
}

/** Options accepted by the subtree traversal helpers on `BNote`. */
interface SubtreeOpts {
    /** Whether to include archived notes and their descendants. */
    includeArchived?: boolean;
    /** Whether to descend into the hidden subtree, `_hidden`, which holds Trilium's system notes. */
    includeHidden?: boolean;
    /** Whether to run each search note and include its results as its children. */
    resolveSearch?: boolean;
}

/** A single parent→child link in a subtree (`BNote.getSubtree`). */
interface SubtreeRelationship {
    /** The ID of the parent note. */
    parentNoteId: string;
    /** The ID of the child note. */
    childNoteId: string;
}

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

/** Input accepted by `BNote.saveAttachment`. */
interface SaveAttachmentInput {
    /** The ID of the attachment to update. */
    attachmentId?: string;
    /** The purpose of the attachment, such as `image` or `file`. */
    role: string;
    /** The MIME type of the content, such as `image/png`. */
    mime: string;
    /** The title of the attachment, usually its file name. */
    title: string;
    /** The content of the attachment: a string, or bytes for binary content. */
    content?: string | Uint8Array<ArrayBufferLike>;
    /** The place of the attachment among the note's attachments, which `getAttachments()` lists by ascending `position`. */
    position?: number;
}

/** Result of a clone operation (`BNote.cloneTo`); mirrors `CloneResponse`. */
interface CloneResponse {
    /** Whether the note was cloned. */
    success: boolean;
    /** Why the clone failed, such as the note already being in that parent. */
    message?: string;
    /** The ID of the new branch that places the note under the new parent. */
    branchId?: string;
    /** The path of the clone, as note IDs from `root` joined by `/`, ending in the note's ID. */
    notePath?: string;
}
```
