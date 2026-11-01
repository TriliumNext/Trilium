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

/** One thing a picker offers, as `pickSingleItem` takes and answers with. */
export interface PickerItem {
    /**
     * The ID of the item. It must be unique within its group, and tells the script which item the
     * user picked.
     */
    key: string;
    /** The text shown for the item. The search field filters items by it. */
    caption: string;
    /** An icon class, `bx` prefix included. */
    icon?: string;
    /** HTML shown in a tooltip while the item is hovered. */
    tooltip?: string;
}

/** A run of picker items under a heading of their own. */
export interface PickerItemGroup {
    /** The ID of the group. It must be unique among the groups. */
    key: string;
    /**
     * The heading shown above the group's items. An empty string shows the items without a heading.
     */
    groupHeader: string;
    /** The items in the group, in the order the picker shows them. */
    items: PickerItem[];
}

/** A label or relation attached to a note. */
export interface ScriptAttribute {
    /** The ID of the attribute. */
    attributeId: string;
    /** The type of the attribute: `label` or `relation`. */
    type: "label" | "relation";
    /** The name of the attribute, without the `#` or `~` prefix. */
    name: string;
    /**
     * The value of the attribute. For a relation, it is the ID of the target note. For a label
     * without a value, it is an empty string.
     */
    value: string;
    /** Whether the note's descendants inherit the attribute. */
    isInheritable: boolean;
    /**
     * Not set by Trilium: neither frontend nor backend attributes carry this property, so it reads
     * `undefined`.
     */
    isOwned: boolean;
}

/** An attachment as seen by frontend scripts (subset of the client's `FAttachment`). */
export interface ScriptAttachment {
    /** The ID of the attachment. */
    attachmentId: string;
    /**
     * The ID of the note the attachment belongs to. For an attachment of a revision, it is the ID
     * of the revision.
     */
    ownerId: string;
    /**
     * The purpose of the attachment, such as `image` for an image shown in a text note or `file`
     * for an attached file. Trilium also uses roles of its own, such as `viewConfig` for a
     * collection's view settings.
     */
    role: string;
    /** The MIME type of the attachment's content, such as `image/png`. */
    mime: string;
    /** The title of the attachment, usually its file name. */
    title: string;
    /**
     * The date and time, in UTC, that the attachment was last saved, such as `2026-10-22
     * 12:03:05.123Z`. Replacing the content counts as saving.
     */
    utcDateModified: string;
    /**
     * The length of the attachment's content. Only some ways of loading an attachment fill it in,
     * such as `getAttachments()`.
     */
    contentLength: number;
}

/** Creation/modification timestamps returned by {@link ScriptFNote.getMetadata}. */
export interface ScriptNoteMetadata {
    /**
     * The local date and time the note was created, with the UTC offset, such as `2026-10-22
     * 14:03:05.123+0200`.
     */
    dateCreated: string;
    /** The date and time, in UTC, that the note was created, such as `2026-10-22 12:03:05.123Z`. */
    utcDateCreated: string;
    /**
     * The local date and time the note was last modified, with the UTC offset, such as `2026-10-22
     * 14:03:05.123+0200`. A change to the note's content counts as a modification.
     */
    dateModified: string;
    /**
     * The date and time, in UTC, that the note was last modified, such as `2026-10-22
     * 12:03:05.123Z`. A change to the note's content counts as a modification.
     */
    utcDateModified: string;
}

/** A note's binary/text content blob (subset of the client's `FBlob`). */
export interface ScriptBlob {
    /**
     * The ID of the blob, derived from its content. Notes, attachments and revisions with identical
     * content share one blob.
     */
    blobId: string;
    /**
     * The content as text. It is `null` when the content is binary, as in images and files.
     */
    content: string;
    /**
     * The length of the content as stored: characters for text, bytes for binary content. For a
     * protected note, it measures the encrypted content.
     */
    contentLength: number;
    /**
     * The local date and time this content was first stored, with the UTC offset, such as
     * `2026-10-22 14:03:05.123+0200`. A blob never changes, so new content gets a new blob.
     */
    dateModified: string;
    /**
     * The date and time, in UTC, that this content was first stored, such as `2026-10-22
     * 12:03:05.123Z`.
     */
    utcDateModified: string;
}

/** One resolved tree path to a note (subset of the client's `NotePathRecord`). */
export interface ScriptNotePathRecord {
    /**
     * Whether a note on the path, the note itself included, is archived, which means it has the
     * `#archived` label, owned or inherited.
     */
    isArchived: boolean;
    /**
     * Whether the path passes through the hoisted note passed to `getSortedNotePathRecords()`. It
     * is always `true` when the hoisted note is `root`.
     */
    isInHoistedSubTree: boolean;
    /**
     * Whether the note itself is a search note. Only frontend scripts get this property; backend
     * records leave it out.
     */
    isSearch?: boolean;
    /** The note IDs along the path, from `root` to the note itself. */
    notePath: string[];
    /**
     * Whether the path passes through the hidden subtree, `_hidden`, which holds Trilium's system
     * notes.
     */
    isHidden: boolean;
}

/** A note as seen by frontend scripts (subset of the client's `FNote`). */
export interface ScriptFNote {
    /** The ID of the note. */
    noteId: string;
    /**
     * The title of the note. For a protected note, it is `[protected]` until a protected session is
     * started.
     */
    title: string;
    /**
     * The note type, such as `text`, `code`, `file`, `image`, `search`, `book`, `render` or
     * `launcher`.
     */
    type: string;
    /** The MIME type of the note's content, such as `application/json`. */
    mime: string;
    /** Whether the note is protected (encrypted). */
    isProtected: boolean;
    /** Whether the note is archived (has the `archived` label). */
    isArchived: boolean;
    /**
     * Whether the note's title and icon cannot be edited, which is the case for the system notes
     * behind the options, the in-app help and the launch bar configuration.
     */
    isMetadataReadOnly: boolean;
    /** IDs of this note's owned attributes. */
    attributes: string[];
    /** IDs of relations pointing *at* this note. */
    targetRelations: string[];
    /** Parent note IDs. */
    parents: string[];
    /** Child note IDs. */
    children: string[];

    // --- Hierarchy ---------------------------------------------------------
    /**
     * Returns the parent notes that the client has already loaded. A parent that is not loaded is
     * skipped, and a search note that shows this note in its results counts as a parent.
     */
    getParentNotes(): ScriptFNote[];
    /**
     * Loads any missing child notes from the server, then returns all child notes in tree order.
     * Archived children are included.
     */
    getChildNotes(): Promise<ScriptFNote[]>;
    /**
     * Returns the IDs of the parent notes. The returned array is the note's own list, so do not
     * change it.
     */
    getParentNoteIds(): string[];
    /**
     * Returns the IDs of the child notes in tree order, archived ones included. The returned array
     * is the note's own list, so do not change it.
     */
    getChildNoteIds(): string[];
    /**
     * Returns the IDs of the child notes in tree order, leaving out archived notes unless
     * `includeArchived` is `true`. Leaving out archived notes takes a search on the server; for a
     * search note or a note in the hidden subtree, all children are returned.
     *
     * @param includeArchived whether to keep archived children. Defaults to `false`.
     */
    getChildNoteIdsWithArchiveFiltering(includeArchived?: boolean): Promise<string[]>;
    /**
     * Returns all descendants of the note, loading missing ones from the server one level at a
     * time. An archived note and everything below it are left out, and the note itself is not
     * included.
     */
    getSubtreeNotes(): Promise<ScriptFNote[]>;
    /**
     * Returns the IDs of all the note's descendants, depth-first, without the note itself. Archived
     * notes and the notes below them are left out unless `includeArchived` is `true`.
     */
    getSubtreeNoteIds(includeArchived?: boolean): Promise<string[]>;
    /**
     * Returns `true` if the note has at least one child, archived ones included. For a search note,
     * the results count as children only once they are loaded.
     */
    hasChildren(): boolean;
    /**
     * Returns `true` if the note with the given ID is this note or one of its ancestors. It walks
     * only parents the client has already loaded.
     *
     * @param followTemplates whether to also walk up from the notes this note takes attributes from
     * through `~template` and `~inherit` relations. Defaults to `false`.
     */
    hasAncestor(ancestorNoteId: string, followTemplates?: boolean): boolean;
    /** Returns `true` if this is the root note of the tree. */
    isRoot(): boolean;
    /** Returns the IDs of the branches that place this note under each of its parents. */
    getParentBranchIds(): string[];
    /**
     * Returns the IDs of the branches that place the note under its parents.
     *
     * @deprecated Use `getParentBranchIds()` instead.
     */
    getBranchIds(): string[];
    /**
     * Returns the branches that place this note under each of its parents. A branch the client has
     * not loaded is skipped.
     */
    getParentBranches(): ScriptFBranch[];
    /**
     * Returns the branches to this note's children, in tree order. A branch the client has not
     * loaded is skipped.
     */
    getChildBranches(): ScriptFBranch[];
    /**
     * Returns the branches that place the note under its parents.
     *
     * @deprecated Use `getParentBranches()` instead.
     */
    getBranches(): ScriptFBranch[];
    /**
     * Returns the same branches as `getChildBranches()`. Despite the name, archived children are
     * not filtered out.
     */
    getFilteredChildBranches(): ScriptFBranch[];
    /**
     * Returns every path from the root to the note, each as a list of note IDs that starts with
     * `root`. Paths that pass through a search note are left out.
     */
    getAllNotePaths(): string[][];
    /**
     * Returns the note's best path as a list of note IDs that starts with `root`. Paths inside the
     * hoisted note's subtree come first, then paths without archived or hidden notes; among equal
     * paths, the one sharing the longest start with `activeNotePath` wins, then the shortest.
     *
     * @param hoistedNoteId The hoisted note, `root` by default.
     * @param activeNotePath The path of the active note, as note IDs joined by `/`.
     */
    getBestNotePath(hoistedNoteId?: string, activeNotePath?: string | null): string[];
    /**
     * Returns the note's best path, as `getBestNotePath()` chooses it, as note IDs joined by `/`,
     * such as `root/a1h315/js725h`.
     *
     * @param hoistedNoteId The hoisted note, `root` by default.
     */
    getBestNotePathString(hoistedNoteId?: string): string;
    /**
     * Returns every path from the root to this note, best first. Paths inside the hoisted note come
     * first, then paths that do not pass through an archived note or the hidden subtree, then paths
     * that share the most with `activeNotePath`, then shorter paths. Paths through search notes are
     * left out, and only parents the client has loaded are followed.
     *
     * @param hoistedNoteId the ID of the hoisted note. Defaults to `root`.
     * @param activeNotePath a note path such as `root/abc123/def456`, used to prefer paths close to
     * it.
     */
    getSortedNotePathRecords(
        hoistedNoteId?: string,
        activeNotePath?: string | null
    ): ScriptNotePathRecord[];

    // --- Attributes (inherited + own) --------------------------------------
    /**
     * Returns the note's attributes, including inherited ones, optionally only those of the given
     * type and name. The note's own attributes come first, then the ones inherited from its
     * parents, then the ones from its templates.
     *
     * @param type `label` or `relation`; any other value throws an error.
     * @param name The attribute name, without the `#` or `~` prefix.
     */
    getAttributes(type?: string, name?: string): ScriptAttribute[];
    /**
     * Returns the note's own attributes, without inherited ones, optionally only those of the given
     * type and name.
     *
     * @param type `label` or `relation`; any other value throws an error.
     * @param name The attribute name, without the `#` or `~` prefix.
     */
    getOwnedAttributes(type?: string, name?: string): ScriptAttribute[];
    /**
     * Returns the first attribute of the given type and name, including inherited ones, or
     * `undefined` if the note has none.
     *
     * @param type `label` or `relation`.
     */
    getAttribute(type: string, name: string): ScriptAttribute | null;
    /**
     * Returns the first of the note's own attributes with the given type and name, or `undefined`
     * if the note has none.
     *
     * @param type `label` or `relation`.
     */
    getOwnedAttribute(type: string, name: string): ScriptAttribute | null;
    /**
     * Returns the value of the first attribute of the given type and name, including inherited
     * ones, or `null` if the note has none.
     *
     * @param type `label` or `relation`.
     */
    getAttributeValue(type: string, name: string): string | null;
    /**
     * Returns the value of the first of the note's own attributes with the given type and name, or
     * `null` if the note has none.
     *
     * @param type `label` or `relation`.
     */
    getOwnedAttributeValue(type: string, name: string): string | null;
    /**
     * Returns whether the note has an attribute of the given type and name, including inherited
     * ones.
     *
     * @param type `label` or `relation`.
     */
    hasAttribute(type: string, name: string): boolean;
    /**
     * Returns whether the note itself has an attribute of the given type and name, without
     * inherited ones.
     *
     * @param type `label` or `relation`.
     */
    hasOwnedAttribute(type: string, name: string): boolean;
    /**
     * Returns the attribute definitions that apply to the note, at most one per defined name.
     * When the note gets a definition from several places, such as its own, an ancestor's and a
     * template's, the nearest one wins, in the order `getAttributes()` lists them.
     */
    getAttributeDefinitions(): ScriptAttribute[];
    /**
     * Returns the attribute definitions that are marked as promoted, at most one per name, grouped
     * by the note that owns them and ordered by position. Returns an empty array if the note has a
     * truthy `hidePromotedAttributes` label.
     */
    getPromotedDefinitionAttributes(): ScriptAttribute[];

    // --- Labels ------------------------------------------------------------
    /** Returns the note's labels, including inherited ones, optionally only those with `name`. */
    getLabels(name?: string): ScriptAttribute[];
    /** Returns the note's own labels, without inherited ones, optionally only those with `name`. */
    getOwnedLabels(name?: string): ScriptAttribute[];
    /**
     * Returns the first label with the given name, including inherited ones, or `undefined` if the
     * note has none.
     */
    getLabel(name: string): ScriptAttribute | null;
    /**
     * Returns the first of the note's own labels with the given name, or `undefined` if the note
     * has none.
     */
    getOwnedLabel(name: string): ScriptAttribute | null;
    /**
     * Returns the value of the first label with the given name, including inherited ones, or
     * `null` if the note has none.
     */
    getLabelValue(name: string): string | null;
    /**
     * Returns the value of the first of the note's own labels with the given name, or `null` if the
     * note has none.
     */
    getOwnedLabelValue(name: string): string | null;
    /** Returns whether the note has a label with the given name, including inherited ones. */
    hasLabel(name: string): boolean;
    /** Returns whether the note itself has a label with the given name, without inherited ones. */
    hasOwnedLabel(name: string): boolean;
    /**
     * Returns whether the note has a label with the given name, including inherited ones, or the
     * same label with the `disabled:` prefix, which a safe import gives it.
     */
    hasLabelOrDisabled(name: string): boolean;
    /**
     * Returns whether the note has a label with the given name, including inherited ones, whose
     * value is anything but `false`. A label without a value counts as true.
     */
    isLabelTruthy(name: string): boolean;

    // --- Relations ---------------------------------------------------------
    /**
     * Returns the note's relations, including inherited ones, optionally only those with `name`.
     */
    getRelations(name?: string): ScriptAttribute[];
    /**
     * Returns the note's own relations, without inherited ones, optionally only those with `name`.
     */
    getOwnedRelations(name: string): ScriptAttribute[];
    /**
     * Returns the first relation with the given name, including inherited ones, or `undefined` if
     * the note has none.
     */
    getRelation(name: string): ScriptAttribute | null;
    /**
     * Returns the first of the note's own relations with the given name, or `undefined` if the note
     * has none.
     */
    getOwnedRelation(name: string): ScriptAttribute | null;
    /**
     * Returns the target note ID of the first relation with the given name, including inherited
     * ones, or `null` if the note has none.
     */
    getRelationValue(name: string): string | null;
    /**
     * Returns the target note ID of the first of the note's own relations with the given name, or
     * `null` if the note has none.
     */
    getOwnedRelationValue(name: string): string | null;
    /** Returns whether the note has a relation with the given name, including inherited ones. */
    hasRelation(name: string): boolean;
    /**
     * Returns whether the note itself has a relation with the given name, without inherited ones.
     */
    hasOwnedRelation(name: string): boolean;
    /**
     * Returns the value of a label or relation, inherited ones included, or `null` if the note has
     * none. A relation's value is the ID of its target note.
     *
     * @param nameWithPrefix the attribute name prefixed with `#` for a label or `~` for a relation.
     * A name without a prefix is looked up as a label.
     */
    getLabelOrRelation(nameWithPrefix: string): string | null;
    /**
     * Returns the target note of the first relation with the given name, including inherited ones.
     * Returns `null` if the note has no such relation, the relation has no target, or the target
     * note does not exist.
     */
    getRelationTarget(name: string): Promise<ScriptFNote | null>;
    /**
     * Returns the target notes of the note's relations with the given name, including inherited
     * ones, in the order of the relations. A relation whose target is missing gives `null`.
     */
    getRelationTargets(name: string): Promise<(ScriptFNote | null)[]>;
    /** Returns the relations, owned by any note, that point at this note. */
    getTargetRelations(): ScriptAttribute[];
    /** Returns the notes that own a relation pointing at this note. */
    getTargetRelationSourceNotes(): Promise<ScriptFNote[]>;

    // --- Content & attachments ---------------------------------------------
    /**
     * Fetches the note's content from the server. Resolves to a string for text-based notes; for a
     * binary note such as an image or file, the content is not sent, and for a protected note
     * without a protected session, it is an empty string.
     */
    getContent(): Promise<string | Uint8Array>;
    /**
     * Fetches the note's content and parses it as JSON. Resolves to `null` if the content is empty,
     * is not a string, or is not valid JSON.
     */
    getJsonContent(): Promise<unknown>;
    /**
     * Fetches the note's content together with its blob ID, length and modification date. Resolves
     * to `null` if the request fails.
     */
    getBlob(): Promise<ScriptBlob | null>;
    /**
     * Returns the blob that holds the note's content.
     *
     * @deprecated Use `getBlob()` instead.
     */
    getNoteComplement(): Promise<ScriptBlob | null>;
    /** Returns the note's creation and modification dates, which it requests from the server. */
    getMetadata(): Promise<ScriptNoteMetadata>;
    /**
     * The note's attachments, or `null` until `getAttachments()` loads them. Use `getAttachments()`
     * instead of reading this property.
     */
    attachments: ScriptAttachment[] | null;
    /**
     * Returns the note's attachments. The first call loads them from the server, and later calls
     * reuse that list.
     */
    getAttachments(): Promise<ScriptAttachment[]>;
    /** Returns the note's attachments with the given role, such as `image` or `file`. */
    getAttachmentsByRole(role: string): Promise<ScriptAttachment[]>;
    /**
     * Returns the note's attachment with the given ID, or `undefined` if this note has no such
     * attachment.
     */
    getAttachmentById(attachmentId: string): Promise<ScriptAttachment | undefined>;
    /**
     * Returns the target notes of this note's `~template` and `~inherit` relations, inherited
     * relations included. A target note that the client has not loaded appears as `undefined`.
     */
    getNotesToInheritAttributesFrom(): ScriptFNote[];

    // --- Type & state predicates -------------------------------------------
    /**
     * Returns the CSS classes of the note's icon, such as `tn-icon bx bx-note`. The icon comes from
     * the `iconClass` label, then the `workspaceIconClass` label, then a default for the note type.
     */
    getIcon(): string;
    /**
     * Returns `true` if the note shows as a folder in the tree: a search note, or a note with
     * children (archived ones included). Always `false` when the note has a truthy `subtreeHidden`
     * label.
     */
    isFolder(): boolean;
    /**
     * Returns `true` if the note is placed, directly or through ancestors the client has loaded,
     * under the shared notes root (`_share`).
     */
    isShared(): boolean;
    /**
     * Returns `true` if the note's content can be read: the note is not protected, or a protected
     * session is active.
     */
    isContentAvailable(): boolean;
    /** Returns `true` if the note's MIME type is `application/json`. */
    isJson(): boolean;
    /**
     * Returns whether the note is a code, file or launcher note with a JavaScript MIME type.
     */
    isJavaScript(): boolean;
    /** Returns `true` if the note is a code note with the MIME type `text/jsx`. */
    isJsx(): boolean;
    /** Returns whether the note is a code, file or render note with the `text/html` MIME type. */
    isHtml(): boolean;
    /**
     * Returns `true` if the note is a code note with a Markdown MIME type (`text/markdown`,
     * `text/x-markdown` or `text/x-gfm`).
     */
    isMarkdown(): boolean;
    /** Returns `true` if the note is one of Trilium's settings pages. */
    isOptions(): boolean;
    /**
     * Returns `true` if the note's MIME type starts with `application/javascript`, which covers
     * both frontend and backend scripts. The note type is not checked.
     */
    isTriliumScript(): boolean;
    /**
     * Returns `true` if the note is a SQL console note, which has the MIME type
     * `text/x-sqlite;schema=trilium`.
     */
    isTriliumSqlite(): boolean;
    /**
     * Returns `true` if the note is a launcher or one of the notes that hold the launch bar's
     * launchers.
     */
    isLaunchBarConfig(): boolean;
    /**
     * Returns whether every path to the note runs through the hidden subtree, so that no clone of
     * it appears in the visible tree. Paths through search notes are not counted.
     */
    isHiddenCompletely(): boolean;
    /**
     * Returns `true` if the note is the hidden subtree's root (`_hidden`) or has it as an ancestor
     * through any of its loaded parents, even when the note is also cloned into the visible tree.
     */
    isInHiddenSubtree(): boolean;
    /**
     * Returns `true` if the image note can be converted into an attachment of its parent: it is an
     * image note without children, it has exactly one parent, that parent is a text note, the
     * content of both is available, and no note other than the parent links to the image.
     */
    isEligibleForConversionToAttachment(): boolean;

    // --- Presentation ------------------------------------------------------
    /**
     * Returns the CSS class that applies the note's `color` label, such as `color-ff0000`, or an
     * empty string if the label is missing or not a valid color. The first call for a color adds
     * the class's style rule to the page.
     */
    getColorClass(): string;
    /**
     * Returns the values of all the note's `cssClass` labels, inherited ones included, separated by
     * spaces.
     */
    getCssClass(): string;
    /**
     * Returns the value of the note's `workspaceIconClass` label, or an empty string if it has
     * none.
     */
    getWorkspaceIconClass(): string;
    /**
     * Returns the value of the note's `workspaceTabBackgroundColor` label, or an empty string if it
     * has none.
     */
    getWorkspaceTabBackgroundColor(): string;

    // --- Scripting runtime -------------------------------------------------
    /**
     * Returns where the note runs as a script: `frontend` for HTML, JSX, render notes and
     * JavaScript with `env=frontend` in its MIME type, `backend` for JavaScript with `env=backend`,
     * and `null` for any other note.
     */
    getScriptEnv(): "frontend" | "backend" | null;
    /**
     * Runs the note as a frontend or backend script, depending on `getScriptEnv()`. For a frontend
     * script, the promise resolves to the value the script returns; for a backend script, it
     * resolves to `undefined` once the script has run. A frontend script that fails shows its error
     * and resolves to `undefined`.
     *
     * @throws Error if the note is neither JavaScript nor JSX, or its MIME type names no
     *     environment.
     */
    executeScript(): Promise<unknown>;

    // --- Low-level / Froca-managed -----------------------------------------
    // Exposed for completeness; most scripts should use the higher-level
    // accessors above rather than these cache fields and mutators.
    /** Blob ID of the current content; changes when content changes. */
    blobId: string;
    /** Map of parent note ID → branch ID. */
    parentToBranch: Record<string, string>;
    /** Map of child note ID → branch ID. */
    childToBranch: Record<string, string>;
    /**
     * For a search note, `true` once its results have been loaded as its children; otherwise not
     * set.
     */
    searchResultsLoaded?: boolean;
    /**
     * For a search note whose results are loaded, the search words to highlight in those results;
     * otherwise not set.
     */
    highlightedTokens?: string[];
    /** Plain data representation of the note (the live object minus its cache handle). */
    dto: Record<string, unknown>;
    /**
     * Adds a parent to this note in the client's cache only. Trilium calls it when it loads
     * branches; scripts do not normally call it, and the change is not saved. To place a note under
     * another, use `api.runOnBackend()` with the backend API.
     *
     * @param branchId the ID of the branch that links the two notes.
     * @param sort whether to reorder the parents afterwards. Defaults to `true`.
     */
    addParent(parentNoteId: string, branchId: string, sort?: boolean): void;
    /**
     * Adds a child to this note in the client's cache only. Trilium calls it when it loads
     * branches; scripts do not normally call it, and the change is not saved.
     *
     * @param branchId the ID of the branch that links the two notes.
     * @param sort whether to reorder the children by their position afterwards. Defaults to `true`.
     */
    addChild(childNoteId: string, branchId: string, sort?: boolean): void;
    /**
     * Reorders the parent list in the client's cache so that ordinary parents come before search
     * notes, archived notes and notes outside the visible tree. Trilium calls it itself; scripts do
     * not normally call it.
     */
    sortParents(): void;
    /**
     * Reorders the child list in the client's cache by each branch's position. Trilium calls it
     * itself; scripts do not normally call it, and it does not change the order saved in the
     * database.
     */
    sortChildren(): void;
    /**
     * Overwrites the note's ID, title, type, MIME type, protection flag and blob ID in the client's
     * cache with the values in `row`. Trilium calls it when changes arrive from the server; scripts
     * do not normally call it, and the change is not saved.
     */
    update(row: Record<string, unknown>): void;
    /**
     * Does nothing; the note's attributes stay up to date without it.
     *
     * @deprecated Remove the call.
     */
    invalidateAttributeCache(): void;
    /**
     * Returns a short description of the note for logging, such as `Note(noteId=abc123, title=My
     * note)`.
     */
    toString(): string;
}

/** A branch (parent↔child link) as seen by frontend scripts (subset of `FBranch`). */
export interface ScriptFBranch {
    /** The unique ID of the branch. */
    branchId: string;
    /** The ID of the child note that this branch places in the tree. */
    noteId: string;
    /** The ID of the parent note. */
    parentNoteId: string;
    /**
     * The place of the note among its siblings; the note tree lists siblings by ascending
     * `notePosition`. Trilium spaces positions 10 apart.
     */
    notePosition: number;
    /**
     * The prefix shown before the note's title in the note tree, for this placement of the note
     * only. It is empty or missing when the branch has none.
     */
    prefix?: string;
    /** Whether the note tree shows this branch expanded, with the note's children visible. */
    isExpanded?: boolean;
    /**
     * Returns the child note, loading it from the server if the frontend cache does not hold it
     * yet. Resolves to `null` if the note does not exist.
     */
    getNote(): Promise<ScriptFNote | null>;
    /**
     * Returns the child note from the frontend cache, without contacting the server. Returns
     * `undefined` if the note is not loaded yet.
     */
    getNoteFromCache(): ScriptFNote | undefined;
    /**
     * Returns the parent note, loading it from the server if the frontend cache does not hold it
     * yet. Resolves to `null` if the note does not exist.
     */
    getParentNote(): Promise<ScriptFNote | null>;
    /** Returns whether the branch places its note directly under the root note. */
    isTopLevel(): boolean;
}

/** A split/tab context as seen by frontend scripts (subset of `NoteContext`). */
export interface ScriptNoteContext {
    /** The ID of the note context, which identifies one tab or split. */
    ntxId: string | null;
    /** The note this context shows, or `null` if the context is empty. */
    note: ScriptFNote | null;
    /**
     * The path of the note this context shows, as note IDs from `root` joined by `/`, such as
     * `root/abc123/def456`. It is `null` when the context is empty.
     */
    notePath: string | null;
    /**
     * Returns the CodeMirror editor of the code note this context shows. Resolves to `null` if the
     * context shows no code editor within 200 ms.
     */
    getCodeEditor(): Promise<ScriptCodeEditor | null>;
    /**
     * Returns the CKEditor instance of the editable text note this context shows. Resolves to
     * `null` if the context shows no editable text note within 200 ms.
     */
    getTextEditor(): Promise<ScriptTextEditor | null>;
}

/**
 * A jQuery object: one or more page elements with jQuery's methods, as `$(…)` returns. The
 * [jQuery API documentation](https://api.jquery.com/) describes them, and the script editor
 * offers them as completions.
 */
// The script editor's frontend environment extends this interface with jQuery's own `JQuery`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ScriptJQuery {}

/**
 * The editor of a text note, a CKEditor 5 editor. The
 * [CKEditor 5 API documentation](https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editor_editor-Editor.html)
 * describes it; `editor.model` and `editor.getData()` are the usual starting points.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ScriptTextEditor {}

/**
 * The editor of a code note, a CodeMirror 6 `EditorView`. The
 * [CodeMirror reference](https://codemirror.net/docs/ref/#view.EditorView) describes it;
 * `editor.state.doc.toString()` reads the code.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ScriptCodeEditor {}

/**
 * The Preact API that render notes import from `trilium:preact`: Preact's own functions and hooks,
 * and Trilium's components and `defineWidget()`. In a JSX note, the script editor offers its full
 * type.
 */
// The script editor's JSX environment extends this interface with the `trilium:preact` module.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ScriptPreact {}

/**
 * The [xml2js](https://github.com/Leonidas-from-XIV/node-xml2js) library, version 0.6, which
 * converts between XML and JavaScript objects, such as with `xml2js.parseStringPromise(xml)`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ScriptXml2js {}

/**
 * The [node-html-parser](https://github.com/taoqf/node-html-parser) library, version 9, which
 * parses HTML into elements that can be queried, such as with
 * `htmlParser.parse(html).querySelectorAll("a")`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ScriptHtmlParser {}

/** Minimal day.js surface (the real API exposes the full day.js factory). */
export type ScriptDayjs = (date?: string | number | Date) => ScriptDayjsInstance;

/** A date as day.js wraps it (subset). */
export interface ScriptDayjsInstance {
    /**
     * Formats the date, such as `"YYYY-MM-DD"` for `2026-10-22`. Without a template, it returns the
     * ISO 8601 form with the UTC offset, such as `2026-10-22T14:03:05+02:00`.
     */
    format(template?: string): string;
    /**
     * Returns a new date, `value` units later. The date it is called on stays unchanged.
     *
     * @param unit The unit, such as `"day"`, `"week"`, `"month"` or `"year"`.
     */
    add(value: number, unit: string): ScriptDayjsInstance;
    /**
     * Returns a new date, `value` units earlier. The date it is called on stays unchanged.
     *
     * @param unit The unit, such as `"day"`, `"week"`, `"month"` or `"year"`.
     */
    subtract(value: number, unit: string): ScriptDayjsInstance;
    /** Returns the date as a JavaScript `Date`. */
    toDate(): Date;
}

type Func = ((...args: unknown[]) => unknown) | string;

/** Instance shape of `BasicWidget` (subset) — the base for custom frontend widgets. */
interface BasicWidget {
    /** The widget's root element, which `doRender()` assigns, such as `this.$widget = $(TPL)`. */
    $widget: ScriptJQuery;
    /**
     * Returns whether the widget is shown: always for a `BasicWidget`, and only while a note is
     * active for a `NoteContextAwareWidget`. A disabled widget stays in the DOM, hidden, and a
     * `NoteContextAwareWidget` does not call `refreshWithNote()` while it is disabled.
     */
    isEnabled(): boolean | null | undefined;
    /**
     * Builds the widget's DOM. Override it to create the root element and assign it to
     * `this.$widget` as a jQuery object.
     */
    doRender(): void;
    /** Renders the widget and returns its root element. */
    render(): ScriptJQuery;
    /** Tears down the widget; override to release resources. */
    cleanup(): void;
    /**
     * Shows or hides the widget from inside the widget itself, such as from `refreshWithNote()`
     * when the note does not apply.
     */
    toggleInt(show: boolean | null | undefined): void;
    /** Fluent builder: set the element id. Chainable. */
    id(id: string): this;
    /** Fluent builder: add a CSS class. Chainable. */
    class(className: string): this;
    /**
     * Sets an inline CSS property on the widget's root element, such as
     * `css("padding-inline-start", "12px")`, and returns the widget for chaining. It takes effect
     * when the widget renders.
     */
    css(name: string, value: string): this;
    /** Fluent builder: append child components. Chainable. */
    child(...components: unknown[]): this;
}

/** Instance shape of `NoteContextAwareWidget` (subset) — reacts to the active note. */
interface NoteContextAwareWidget extends BasicWidget {
    /** The note currently shown in this widget's context. */
    note: ScriptFNote | null;
    /** The ID of `note`, such as for `loadResults.isNoteContentReloaded(this.noteId)`. */
    readonly noteId: string | undefined;
    /** The path of `note` in the tree, such as `root/abc123/def456`. */
    readonly notePath: string | null | undefined;
    /** The ID of the note context (split) this widget is attached to. */
    readonly ntxId: string | null | undefined;
    /** The note context (split) this widget is attached to. */
    noteContext?: ScriptNoteContext;
    /** Returns whether `noteId` is the note shown in this widget's context. */
    isNote(noteId: string): boolean;
    /**
     * Updates the widget for the note in its context. Override it to refresh the widget's content;
     * it runs when that note changes and on `refresh()`, as long as `isEnabled()` returns `true`.
     */
    refreshWithNote(note: ScriptFNote | null | undefined): void | Promise<void>;
    /** Forces a refresh against the current note. */
    refresh(): void | Promise<void>;
}

/** Instance shape of `RightPanelWidget` (subset) — a widget shown in the right sidebar. */
interface RightPanelWidget extends NoteContextAwareWidget {
    /**
     * The title shown in the panel's header, `Untitled widget` unless overridden. The panel reads
     * it once, when it renders.
     */
    readonly widgetTitle: string;
    /**
     * Builds the panel's body. Override it to fill `this.$body`, the jQuery element the panel
     * creates for the content, instead of `doRender()`. It can return a promise when the body
     * needs asynchronous work; an error that promise rejects with is logged.
     */
    doRenderBody(): void | Promise<void>;
}

/** Constructor type allowing `class X extends api.Widget { … }`. */
type WidgetClass<T> = new (...args: unknown[]) => T;

/** An attribute to create together with a note (see {@link ScriptCreateNoteOpts.attributes}). */
export interface ScriptCreateAttribute {
    /** The type of the attribute: `label` or `relation`. */
    type: "label" | "relation";
    /** The name of the attribute, without the `#` or `~` prefix. */
    name: string;
    /**
     * The value of the attribute. For a relation, it is the ID of the target note. Defaults to an
     * empty string.
     */
    value?: string;
    /** Whether the note's descendants inherit the attribute. Defaults to `false`. */
    isInheritable?: boolean;
    /**
     * The place of the attribute among the note's attributes, which are listed by ascending
     * `position`. Defaults to 10 more than the highest position among the note's attributes.
     */
    position?: number;
}

/** Options accepted by {@link FrontendApi.createNote}. */
export interface ScriptCreateNoteOpts {
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
    /** Activate (open) the new note after creation. Defaults to `true`. */
    activate?: boolean;
    /** Which part of the activated note to focus. Defaults to "title". */
    focus?: "title" | "content";
    /** Where to place the note relative to the parent/target: "into" (default) or "after". */
    target?: string;
    /** Branch ID used together with `target: "after"`. */
    targetBranchId?: string;
    /** Attributes to set atomically on creation. */
    attributes?: ScriptCreateAttribute[];
}

/** Options of `api.createLink()`. */
export interface ScriptLinkOptions {
    /** The text of the link. Defaults to the note's title. */
    title?: string;
    /**
     * Whether a preview of the note shows while the mouse pointer rests on the link. Defaults to
     * `true`.
     */
    showTooltip?: boolean;
    /** Whether the path of the note's parents shows below the link. Defaults to `false`. */
    showNotePath?: boolean;
    /** Whether the note's icon shows before the link. Defaults to `false`. */
    showNoteIcon?: boolean;
    /** Whether the link is styled as a reference link, as in text notes. Defaults to `false`. */
    referenceLink?: boolean;
    /**
     * Whether an image, canvas or Mermaid note shows as its picture instead of a link. Defaults to
     * `false`.
     */
    autoConvertToImage?: boolean;
    /** Text shown right after the link's title. */
    titleSuffix?: string;
}

/**
 * The `api` global available inside **frontend** script notes
 * (`application/javascript;env=frontend`).
 */
export interface FrontendApi {
    /**
     * The element a render note's script renders into: the script of a note that a `~renderNote`
     * relation points to. It is `null` for scripts that run any other way.
     */
    $container: ScriptJQuery | null;
    /**
     * Note where the script execution started — the entry point of the current script bundle
     * (in C terms, the file containing `main()`). When a script is spread across multiple code
     * notes (descendant code notes loaded as modules via `require()`), every note in the
     * bundle shares the same `startNote`, while {@link currentNote} differs per note.
     * Messages from `api.log()` are grouped under this note.
     */
    startNote: ScriptFNote;
    /**
     * Note containing the source code that is currently executing (in C terms, `__FILE__`).
     * Equal to {@link startNote} unless execution has moved into a descendant module note
     * loaded via `require()`. Don't confuse this with the note open in the UI — use
     * `api.getActiveContextNote()` for that.
     */
    currentNote: ScriptFNote;
    /**
     * Entity whose event triggered this execution, or `null`.
     *
     * Most frontend scripts are started by the user or by the UI (startup scripts, widgets),
     * so this is usually `null`. It is set to a note when:
     * - the script runs through a `~renderNote` relation — then it's the note being rendered
     *   (the one carrying the relation), not the script note;
     * - a backend script calls `api.runOnFrontend()` — then it's the backend execution's
     *   `originEntity`, provided that entity was a note.
     */
    originEntity: ScriptFNote | null;
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
     * Whether backend script execution is enabled on the server (the
     * `[Security] backendScriptingEnabled` config toggle). When it's disabled,
     * `api.runOnBackend()` / `api.runAsyncOnBackendWithManualTransactionHandling()`
     * reject with a "Backend script execution is disabled" error, so check this
     * first to let a script degrade gracefully instead of throwing.
     */
    isBackendScriptingEnabled(): boolean;
    /**
     * Whether the SQL console is enabled on the server (the
     * `[Security] sqlConsoleEnabled` config toggle). When it's disabled, backend
     * scripts that run raw SQL (`api.sql.*`) fail, so check this before invoking
     * SQL-backed logic via `api.runOnBackend()`.
     */
    isSqlConsoleEnabled(): boolean;

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
     * Creates a new note as a child of the given parent, entirely on the frontend — no backend
     * scripting required (unlike `api.runOnBackend(() => api.createTextNote(...))`). By default the
     * new note is activated in the current tab with its title focused for editing; pass
     * `{ activate: false }` to create it silently.
     *
     * @param parentNotePath note path (or noteId) of the parent under which to create the note
     * @param opts creation options — e.g. `{ title, content, type, mime, activate }`
     * @returns the created note and its branch, resolved from the frontend cache
     */
    createNote(parentNotePath: string, opts?: ScriptCreateNoteOpts): Promise<{ note: ScriptFNote | null; branch: ScriptFBranch | undefined }>;
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
     * Returns the editor of the text note in the active tab or split. Resolves to `null` if it
     * shows no editable text note within 200 ms, and throws an error when no tab is active.
     */
    getActiveContextTextEditor(): Promise<ScriptTextEditor | null>;
    /**
     * Returns the editor of the code note in the active tab or split. Resolves to `null` if it
     * shows no code editor within 200 ms, and throws an error when no tab is active.
     */
    getActiveContextCodeEditor(): Promise<ScriptCodeEditor | null>;
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
     * Show a dialog for picking one item out of many, grouped and searchable.
     *
     * `items` are either the items themselves or groups of them, never the two mixed. Named for the
     * one thing it does now: picking several at once will be a method of its own beside this.
     *
     * @returns promise resolving to the item picked, or null where the user backed out.
     */
    pickSingleItem(props: {
        title?: string;
        items: PickerItem[] | PickerItemGroup[];
        placeholder?: string;
    }): Promise<PickerItem | null>;

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
    createLink(notePath: string, params?: ScriptLinkOptions): Promise<ScriptJQuery>;
    /** @deprecated - use api.createLink() instead */
    createNoteLink(notePath: string, params?: ScriptLinkOptions): Promise<ScriptJQuery>;

    /**
     * Trigger command. This is a very low-level API which should be avoided if possible.
     */
    triggerCommand(name: string, data?: Record<string, unknown>): Promise<unknown>;
    /**
     * Trigger event. This is a very low-level API which should be avoided if possible.
     */
    triggerEvent(name: string, data?: Record<string, unknown>): Promise<unknown>;
    /**
     * Shows a preview of the linked note while the mouse pointer rests on the element, as Trilium
     * does for links in note content. The element must be a link whose `href` or `data-href`
     * points to a note, such as `#root/abc123`.
     *
     * @param el The link, as a jQuery object.
     */
    setupElementTooltip(el: ScriptJQuery): void;
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
     * Converts the given HTML string to Markdown.
     *
     * Unlike the backend API, this runs on the server (the HTML→Markdown
     * converter is backend-only), so it returns a promise.
     *
     * @param html - HTML content to convert
     * @returns Markdown representation of the input HTML
     */
    htmlToMarkdown(html: string): Promise<string>;
    /**
     * Converts the given Markdown string to HTML.
     *
     * Runs entirely in the browser; the promise is only needed because the
     * Markdown renderer is loaded on demand.
     *
     * @param markdown - Markdown content to convert
     * @returns HTML representation of the input Markdown
     */
    markdownToHtml(markdown: string): Promise<string>;
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
    preact: ScriptPreact;
}

/** A branch (note→parent placement) as seen by backend scripts (subset of `BBranch`). */
export interface ScriptBBranch {
    /**
     * The ID of the branch. Moving a note to another parent replaces its branch with a new one, so
     * store the note ID rather than the branch ID when you need a stable reference.
     */
    branchId: string;
    /** The ID of the child note this branch places in the tree. */
    noteId: string;
    /** The ID of the parent note. For the root note's branch, it is `"none"`. */
    parentNoteId: string;
    /**
     * The text shown before the note's title in the note tree for this placement only, or `null` if
     * there is none.
     */
    prefix: string | null;
    /**
     * The position of the note among its siblings under this parent; notes with lower values come
     * first.
     */
    notePosition: number;
    /** Whether the note is expanded in the note tree at this placement, showing its children. */
    isExpanded: boolean;
    /** Returns the child note this branch places in the tree. */
    getNote(): ScriptBNote;
    /** Returns the parent note. The root note's branch has no parent note. */
    getParentNote(): ScriptBNote | null;
}

/** A note revision as seen by backend scripts (subset of trilium-core's `BRevision`). */
export interface ScriptBRevision {
    /** The ID of the revision. */
    revisionId?: string;
    /** The ID of the note this revision belongs to. */
    noteId: string;
    /** The note's type at the time of the revision, such as `"text"` or `"code"`. */
    type: string;
    /** The note's MIME type at the time of the revision. */
    mime: string;
    /**
     * The note's title at the time of the revision. For a protected revision outside a protected
     * session, it is `"[protected]"`.
     */
    title: string;
    /**
     * When the note was last edited before the revision was saved, in local time with its UTC
     * offset, formatted as `YYYY-MM-DD HH:mm:ss.SSS+ZZZZ` (for example, `2026-10-22
     * 14:05:09.123+0200`).
     */
    dateLastEdited?: string;
    /**
     * When the note was last edited before the revision was saved, in UTC, formatted as `YYYY-MM-DD
     * HH:mm:ss.SSSZ` (for example, `2026-10-22 12:05:09.123Z`).
     */
    utcDateLastEdited?: string;
    /**
     * The size of the revision's content in bytes, when it was loaded together with the revision.
     * Revisions returned by `note.getRevisions()` and `note.saveRevision()` leave it `undefined`.
     */
    contentLength?: number;
    /**
     * Returns the content of the revision: a string for text-based note types, a `Uint8Array` for
     * binary ones such as images and files. For a protected revision outside a protected session,
     * it returns an empty string.
     */
    getContent(): string | Uint8Array;
    /**
     * Returns the revision's content parsed as JSON. Returns `null` when the content is empty,
     * blank or binary, and throws an error when it is not valid JSON.
     */
    getJsonContent(): unknown;
}

/** An attachment as seen by backend scripts (subset of trilium-core's `BAttachment`). */
export interface ScriptBAttachment {
    /** The ID of the attachment. It is `undefined` until a new attachment is first saved. */
    attachmentId?: string;
    /**
     * The ID of the note the attachment belongs to. For an attachment of a revision, it is the ID
     * of the revision.
     */
    ownerId: string;
    /**
     * The purpose of the attachment: `image` for an image shown in a text note, `file` for an
     * attached file. Trilium also uses roles of its own, such as `viewConfig` for a collection's
     * view settings.
     */
    role: string;
    /** The MIME type of the attachment's content, such as `image/png`. */
    mime: string;
    /**
     * The title of the attachment, usually its file name. For a protected attachment outside a
     * protected session, it holds the encrypted title; use `getTitleOrProtected()` to show it.
     */
    title: string;
    /** The place of the attachment among its owner's attachments, listed by ascending position. */
    position?: number;
    /** Whether the attachment is protected (encrypted). */
    isProtected?: boolean;
    /** The ID of the blob that stores the content. It changes whenever the content changes. */
    blobId?: string;
    /** The date and time, in UTC, that the attachment was last saved. */
    utcDateModified?: string;
    /**
     * The length of the attachment's content, when it was loaded together with the attachment.
     * Attachments returned by `note.getAttachmentsByRole()` leave it `undefined`.
     */
    contentLength?: number;
    /** Returns the note the attachment belongs to, or `undefined` for a revision's attachment. */
    getNote(): ScriptBNote | undefined;
    /**
     * Returns the content: a string for text-based content, a `Uint8Array` for binary content
     * such as images. For a protected attachment outside a protected session, it returns an empty
     * string.
     */
    getContent(): string | Uint8Array;
    /**
     * Replaces the content and saves it immediately. Throws an error for a protected attachment
     * outside a protected session.
     */
    setContent(
        content: string | Uint8Array,
        opts?: { forceSave?: boolean; forceFrontendReload?: boolean }
    ): void;
    /** Returns whether the content is text rather than binary, judged by the MIME type. */
    hasStringContent(): boolean;
    /**
     * Returns whether the title and content can be read: the attachment is not protected, or a
     * protected session is active.
     */
    isContentAvailable(): boolean;
    /** Returns the title, or `[protected]` when the title cannot be read. */
    getTitleOrProtected(): string;
    /** Returns the file name the attachment downloads under: its title with a fitting extension. */
    getFileName(): string;
    /**
     * Turns the attachment into a child note of its owner and deletes the attachment. In a text
     * note, images and links that point to the attachment are rewritten to point to the new note.
     * Throws an error for a revision's attachment, and for a protected one outside a protected
     * session.
     */
    convertToNote(): ScriptNoteAndBranch;
    /** Saves changes made to the attachment's properties, such as `title`. */
    save(): this;
    /**
     * Deletes the attachment. Deleted attachments stay recoverable until they are erased.
     *
     * @param deleteId An ID that groups items deleted together, so that they can be restored
     * together.
     */
    markAsDeleted(deleteId?: string | null): void;
}

/** An option, one of Trilium's settings (subset of trilium-core's `BOption`). */
export interface ScriptBOption {
    /** The name of the option, such as `theme` or `locale`. */
    name: string;
    /** The value of the option. Every value is a string, numbers and booleans included. */
    value: string;
    /** Whether the option syncs to other devices; device-specific options do not. */
    isSynced?: boolean;
    /** The date and time, in UTC, that the option last changed. */
    utcDateModified?: string;
}

/**
 * An ETAPI token, which grants an external program access to the ETAPI (subset of trilium-core's
 * `BEtapiToken`). The token itself is not available, only its hash, which this type leaves out.
 */
export interface ScriptBEtapiToken {
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

/** Options of `api.searchForNotes()` and `api.searchForNote()`. */
export interface ScriptSearchParams {
    /**
     * Whether to search only titles and attributes, leaving out note content, which is faster.
     * Defaults to `false`.
     */
    fastSearch?: boolean;
    /** Whether to include archived notes. Defaults to `true`. */
    includeArchivedNotes?: boolean;
    /**
     * Whether to include the hidden subtree's notes, such as settings and launchers. Defaults to
     * `false`.
     */
    includeHiddenNotes?: boolean;
    /**
     * Whether to search the whole tree even while a note is hoisted. Defaults to `true`; with
     * `false` and no `ancestorNoteId`, only the hoisted note's subtree is searched.
     */
    ignoreHoistedNote?: boolean;
    /** The ID of a note to search under: only its descendants are found. */
    ancestorNoteId?: string;
    /**
     * How deep under `ancestorNoteId` the found notes can lie: `eq`, `gt` or `lt` followed by a
     * depth, such as `eq1` for its children only or `lt4` for less than four levels down.
     */
    ancestorDepth?: string;
    /**
     * What to order the results by: a note property such as `title`, `dateCreated` or
     * `dateModified`, or `relevancy`, the default.
     */
    orderBy?: string;
    /** `asc` or `desc`; the direction of `orderBy`. */
    orderDirection?: string;
    /** The largest number of results to return. */
    limit?: number | null;
    /** Whether to write how the query was parsed to the backend log. */
    debug?: boolean;
    /**
     * Whether attribute conditions match loosely: `#status=done` also matches values that contain
     * `done`, and `#stat` matches attributes whose name starts with `stat`. Defaults to `false`.
     */
    fuzzyAttributeSearch?: boolean;
}

/** Information about the running Trilium, as `api.getAppInfo()` returns it. */
export interface ScriptAppInfo {
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
    /**
     * The directory that holds the database and the other data; absent in the standalone and
     * mobile apps.
     */
    dataDirectory?: string;
    /** The version of the protocol the web clipper speaks with Trilium. */
    clipperProtocolVersion: string;
    /** The date and time, in UTC, that Trilium started, in ISO 8601 form. */
    utcDateTime: string;
}

/**
 * Direct access to Trilium's SQLite database (subset of trilium-core's `SqlService`). Queries mark
 * parameters with `?` and take their values in an array, in order. Changes made here bypass
 * Trilium's own bookkeeping: they do not sync, and Trilium's in-memory copy of the notes does not
 * see them until the next restart. Change notes through the note methods instead.
 */
export interface ScriptSql {
    /**
     * Returns the first row of the result, as an object of column names to values, or `undefined`
     * when the query returns no rows.
     */
    getRow<T>(query: string, params?: unknown[]): T;
    /** Returns the first row of the result, or `null` when the query returns no rows. */
    getRowOrNull<T>(query: string, params?: unknown[]): T | null;
    /**
     * Returns the first column of the first row, such as the count of `SELECT COUNT(*) FROM notes`,
     * or `undefined` when the query returns no rows.
     */
    getValue<T>(query: string, params?: unknown[]): T;
    /** Returns every row of the result, each as an object of column names to values. */
    getRows<T>(query: string, params?: unknown[]): T[];
    /** Returns the first column of every row of the result. */
    getColumn<T>(query: string, params?: unknown[]): T[];
    /** Returns an object that maps the first column of each row to its second column. */
    getMap<K extends string | number | symbol, V>(query: string, params?: unknown[]): Record<K, V>;
    /** Returns the rows of the result one at a time, which keeps a large result out of memory. */
    iterateRows<T>(query: string, params?: unknown[]): IterableIterator<T>;
    /**
     * Runs a statement that changes data, such as `UPDATE` or `INSERT`.
     *
     * @returns `changes`, the number of rows changed, and `lastInsertRowid`, the ID of the row an
     * `INSERT` added.
     */
    execute(query: string, params?: unknown[]): { changes: number; lastInsertRowid: number };
    /** Runs several statements separated by semicolons, without parameters. */
    executeScript(query: string): void;
    /**
     * Calls `func` in a transaction: when it throws, every change it made is undone. Inside a
     * transaction already running, it runs as a nested savepoint.
     *
     * @returns What `func` returns.
     */
    transactional<T>(func: () => T): T;
}

/** Result of a clone operation ({@link ScriptBNote.cloneTo}); mirrors `CloneResponse`. */
export interface ScriptCloneResponse {
    /** Whether the note was cloned. */
    success: boolean;
    /**
     * Why the clone failed, such as the note already being in that parent. Present only when
     * `success` is `false`.
     */
    message?: string;
    /**
     * The ID of the new branch that places the note under the new parent. Present only when
     * `success` is `true`.
     */
    branchId?: string;
    /**
     * The path of the clone, as note IDs from `root` joined by `/`, ending in the note's ID.
     * Present only when `success` is `true`.
     */
    notePath?: string;
}

/** A single parent→child link in a subtree ({@link ScriptBNote.getSubtree}). */
export interface ScriptSubtreeRelationship {
    /**
     * The ID of the parent note. With `resolveSearch`, it can be a search note and the child one of
     * its results.
     */
    parentNoteId: string;
    /**
     * The ID of the child note. With `includeArchived: false`, it can name an archived note that
     * the list of notes leaves out.
     */
    childNoteId: string;
}

/** Options accepted by the subtree traversal helpers on {@link ScriptBNote}. */
export interface ScriptSubtreeOpts {
    /** Whether to include archived notes and their descendants. Defaults to `true`. */
    includeArchived?: boolean;
    /**
     * Whether to descend into the hidden subtree, `_hidden`, which holds Trilium's system notes.
     * Defaults to `false`.
     */
    includeHidden?: boolean;
    /**
     * Whether to run each search note and include its results as its children. Defaults to `false`,
     * which includes the search note but none of its results.
     */
    resolveSearch?: boolean;
}

/** Input accepted by {@link ScriptBNote.saveAttachment}. */
export interface ScriptSaveAttachmentInput {
    /**
     * The ID of the attachment to update. Omit it to create a new attachment, which gets an ID of
     * its own.
     */
    attachmentId?: string;
    /**
     * The purpose of the attachment, such as `image` or `file`. Used only when a new attachment is
     * created.
     */
    role: string;
    /**
     * The MIME type of the content, such as `image/png`. Used only when a new attachment is
     * created.
     */
    mime: string;
    /**
     * The title of the attachment, usually its file name. Used when a new attachment is created,
     * and to find the attachment to update when `matchBy` is `"title"`.
     */
    title: string;
    /**
     * The content of the attachment: a string, or bytes for binary content. Defaults to an empty
     * string.
     */
    content?: string | Uint8Array;
    /**
     * The place of the attachment among the note's attachments, which `getAttachments()` lists by
     * ascending `position`. Used only when a new attachment is created.
     */
    position?: number;
}

/** A note as seen by backend scripts (subset of trilium-core's `BNote`). */
export interface ScriptBNote {
    /**
     * The ID of the note. The root note's ID is `root`. System notes have IDs that start with `_`,
     * such as `_hidden`.
     */
    noteId: string;
    /**
     * The title of the note. For a protected note read outside a protected session, this holds the
     * encrypted title. Use `getTitleOrProtected()` to show a title safely.
     */
    title: string;
    /**
     * The note type, such as `text`, `code`, `file`, `image`, `search` or `book`. Together with
     * `mime`, it decides how Trilium renders the content.
     */
    type: string;
    /**
     * The MIME type of the note's content, such as `text/html` for a text note or
     * `application/javascript;env=backend` for a backend script.
     */
    mime: string;
    /**
     * Whether the note is protected. The title and content of a protected note are encrypted, and
     * can be read or changed only while a protected session is active.
     */
    isProtected: boolean;
    /**
     * Whether the note is archived: it has an `archived` label of its own or inherits one. A
     * non-inheritable `archived` label on an ancestor does not count; see
     * `areAllNotePathsArchived()`.
     */
    isArchived: boolean;
    /**
     * Whether the note has been deleted, or its deletion is in progress. It becomes `true` on an
     * object a script still holds after the note is deleted.
     */
    isDeleted: boolean;
    /** Share root ID this note is published under, if any. */
    shareId: string;
    /**
     * The ID of the blob that stores the note's content. It changes whenever the content changes,
     * and notes with identical content share a blob.
     */
    blobId: string;
    /**
     * The date and time the note was created, in local time with its UTC offset, for example
     * `2026-10-22 14:03:05.123+0200`.
     */
    dateCreated: string;
    /**
     * The date and time the note was last modified, in local time with its UTC offset, for example
     * `2026-10-22 14:03:05.123+0200`. It changes when the content changes or the note itself is
     * saved, such as after a title change.
     */
    dateModified: string;
    /** The date and time the note was created, in UTC, for example `2026-10-22 12:03:05.123Z`. */
    utcDateCreated: string;
    /**
     * The date and time the note was last modified, in UTC, for example `2026-10-22 12:03:05.123Z`.
     * It changes when the content changes or the note itself is saved.
     */
    utcDateModified: string;

    // --- Content -----------------------------------------------------------
    /**
     * Returns the content of the note: a string for text-based notes (see `hasStringContent()`), a
     * `Uint8Array` for binary ones such as images and files. The content is read from the database
     * on each call. For a protected note outside a protected session, it returns an empty string.
     */
    getContent(): string | Uint8Array;
    /**
     * Replaces the content of the note and saves it immediately; there is no need to call `save()`
     * afterwards. If the content is unchanged, nothing is saved and `dateModified` stays the same.
     *
     * The call throws an error when `content` is `null` or `undefined`, when the note is protected
     * and no protected session is active, and when the note is read-only, such as a page of the
     * in-app help.
     *
     * @param content The new content: a string for text-based notes, or a `Uint8Array` for binary
     * ones such as images and files.
     * @param opts.forceFrontendReload Whether open editors showing this note reload the new
     * content, even when the change appears to come from them.
     */
    setContent(content: string | Uint8Array, opts?: { forceFrontendReload?: boolean }): void;
    /**
     * Returns the note's content parsed as JSON. Returns `null` when the content is empty, blank or
     * binary, and throws an error when it is not valid JSON.
     */
    getJsonContent<T = unknown>(): T | null;
    /**
     * Returns the note's content parsed as JSON, like `getJsonContent()`, but returns `null`
     * instead of throwing an error when the content is not valid JSON.
     */
    getJsonContentSafely(): unknown;
    /**
     * Serializes `content` to JSON, indented with tabs, and saves it as the note's content through
     * `setContent()`, with the same errors.
     */
    setJsonContent(content: unknown): void;
    /**
     * Returns whether `getContent()` returns a string rather than a `Uint8Array`. This holds for
     * text, code, canvas, Mermaid and other text-based note types, and for MIME types such as
     * `text/*`, `application/json`, `application/javascript` and `image/svg+xml`.
     */
    hasStringContent(): boolean;
    /**
     * Returns a file name for the note, as used when it is downloaded or exported: the title with
     * characters invalid in file names removed (`untitled` when the title is empty), plus an
     * extension. The extension is `.html` for text notes, `.json` for relation maps, canvases and
     * saved searches, and otherwise comes from the MIME type, unless the title already ends in a
     * matching one.
     */
    getFileName(): string;
    /**
     * Returns a single line of text that Trilium searches when matching notes: the note ID, type,
     * MIME type, branch prefixes, title and attributes (as `#name=value` and `~name=value`,
     * inherited ones included), lowercased and with diacritics removed. The content is not
     * included.
     */
    getFlatText(): string;
    /** Plain serialisable representation of the note (the real return type is `NotePojo`). */
    getPojo(): Record<string, unknown>;
    /**
     * Returns the note's title, or the literal string `[protected]` when the note is protected and
     * no protected session is active.
     */
    getTitleOrProtected(): string;
    /**
     * Returns the CSS classes of the note's icon, for example `tn-icon bx bx-note`. The icon comes
     * from the note's `iconClass` label (its own or inherited) when it has one, and otherwise from
     * its type.
     */
    getIcon(): string;

    // --- Hierarchy ---------------------------------------------------------
    /**
     * The parent notes of this note: one per place the note appears in the tree, so a cloned note
     * has several. Parents that are not archived come first. This is the same array
     * `getParentNotes()` returns; don't modify it.
     */
    parents: ScriptBNote[];
    /**
     * The child notes of this note, in their order in the tree. This is the same array
     * `getChildNotes()` returns; don't modify it.
     */
    children: ScriptBNote[];
    /**
     * The branches that place this note under each of its parents, in the same order as `parents`.
     * This is the same array `getParentBranches()` returns; don't modify it.
     */
    parentBranches: ScriptBBranch[];
    /** The number of parent notes, which is greater than 1 for a cloned note. */
    parentCount: number;
    /** The number of child notes, including hidden and system notes. */
    childrenCount: number;
    /**
     * Returns the parent notes of this note, one per place the note appears in the tree. Parents
     * that are not archived come first. The result is the `parents` array itself; don't modify it.
     */
    getParentNotes(): ScriptBNote[];
    /**
     * Returns the child notes of this note, in their order in the tree. The result is the
     * `children` array itself; don't modify it.
     */
    getChildNotes(): ScriptBNote[];
    /**
     * Returns the child notes that are shown in a shared note's navigation tree, in tree order. It
     * leaves out system notes, whose IDs start with `_`, and notes with a `shareHiddenFromTree`
     * label, their own or inherited. Archived notes are included.
     */
    getVisibleChildNotes(): ScriptBNote[];
    /**
     * Returns the branches that place this note under each of its parents. The result is the
     * `parentBranches` array itself; don't modify it.
     */
    getParentBranches(): ScriptBBranch[];
    /**
     * Returns the branches that connect this note to each of its children, in their order in the
     * tree. A branch holds the child's position and prefix.
     */
    getChildBranches(): ScriptBBranch[];
    /**
     * Returns the child branches whose notes are shown in a shared note's navigation tree, in tree
     * order. It leaves out system notes, whose IDs start with `_`, and notes with a
     * `shareHiddenFromTree` label, their own or inherited. Archived notes are included.
     */
    getVisibleChildBranches(): ScriptBBranch[];
    /**
     * Returns the parent branches the user created, leaving out the automatic placements under the
     * shared notes (`_share`) and the bookmarks (`_lbBookmarks`). A note whose last such branch is
     * deleted is deleted too.
     */
    getStrongParentBranches(): ScriptBBranch[];
    /**
     * Returns the same branches as `getChildBranches()`. Despite its name, it filters nothing:
     * archived and hidden children are included.
     */
    getFilteredChildBranches(): ScriptBBranch[];
    /**
     * Returns the branches that place this note under each of its parents.
     *
     * @deprecated Use `getParentBranches()` instead.
     */
    getBranches(): ScriptBBranch[];
    /** Returns whether the note has at least one child note, including hidden and system notes. */
    hasChildren(): boolean;
    /** Returns whether `getVisibleChildNotes()` returns at least one note. */
    hasVisibleChildren(): boolean;
    /**
     * Returns every ancestor of the note across all of its paths in the tree, each note once, up to
     * and including the root note. The note itself is not included. The order follows the parents:
     * each parent comes first, followed by its own ancestors.
     */
    getAncestors(): ScriptBNote[];
    /** Returns the IDs of the notes `getAncestors()` returns, in the same order. */
    getAncestorNoteIds(): string[];
    /**
     * Returns the IDs of this note and all its descendants.
     *
     * @deprecated Use `getSubtreeNoteIds()` instead.
     */
    getDescendantNoteIds(): string[];
    /**
     * Returns the number of levels between this note and the given ancestor along the shortest
     * path: `1` for a parent, `2` for a grandparent, and `0` for the note itself. If the note is
     * not a descendant of the given note, it returns `999999`.
     *
     * @param ancestorNoteId The ID of the ancestor note to measure the distance to.
     */
    getDistanceToAncestor(ancestorNoteId: string): number;
    /**
     * Returns whether the given note is an ancestor of this note on any of its paths. It returns
     * `false` for the note's own ID.
     *
     * @param ancestorNoteId The ID of the note to look for among the ancestors.
     */
    hasAncestor(ancestorNoteId: string): boolean;
    /**
     * Returns whether the given note lies on at least one of this note's paths from the root.
     * Unlike `hasAncestor()`, it returns `true` for the note's own ID.
     */
    isDescendantOfNote(ancestorNoteId: string): boolean;
    /** Returns whether this note is the root of the note tree, whose ID is `root`. */
    isRoot(): boolean;
    /**
     * Returns the note and all its descendants, each note once, together with every parent-child
     * relationship among them, including those of cloned notes.
     *
     * @param opts.includeArchived Whether archived notes, and the subtrees below them, are
     * included. Defaults to `true`.
     * @param opts.includeHidden Whether the hidden subtree (`_hidden`) is included when it lies
     * within the subtree. Defaults to `false`.
     * @param opts.resolveSearch Whether the results of saved search notes are included as their
     * children. Defaults to `false`.
     * @returns An object with `notes`, the notes of the subtree including this note, and
     * `relationships`, the `{ parentNoteId, childNoteId }` pairs connecting them.
     */
    getSubtree(opts?: ScriptSubtreeOpts): {
        notes: ScriptBNote[];
        relationships: ScriptSubtreeRelationship[];
    };
    /**
     * Returns the IDs of this note and all its descendants, each once. Takes the same options as
     * `getSubtree()`.
     */
    getSubtreeNoteIds(opts?: ScriptSubtreeOpts): string[];
    /**
     * Returns the notes that this note's inheritable attributes reach: the note itself, its
     * descendants, and every note that uses one of them as a `template` or `inherit` relation
     * target, along with that note's descendants. Each note appears once; the hidden subtree
     * (`_hidden`) is skipped.
     */
    getSubtreeNotesIncludingTemplated(): ScriptBNote[];
    /**
     * Returns the notes that this note's non-inheritable attributes apply to: the note itself and
     * every note that uses it as a `template` or `inherit` relation target. Their descendants are
     * not included.
     */
    getInheritingNotes(): ScriptBNote[];

    // --- Note paths --------------------------------------------------------
    /**
     * Returns every path from the root note to this note, one per placement in the tree. Each path
     * is an array of note IDs that starts with `root` and ends with this note's ID.
     */
    getAllNotePaths(): string[][];
    /**
     * Returns the best path from the root note to this note as an array of note IDs, ranked as in
     * `getSortedNotePathRecords()`.
     *
     * @param hoistedNoteId The ID of the note whose subtree is preferred. Defaults to `root`.
     */
    getBestNotePath(hoistedNoteId?: string): string[];
    /**
     * Returns the best path from the root note to this note as a string of note IDs joined by `/`,
     * for example `root/a1h315/js725h`.
     *
     * @param hoistedNoteId The ID of the note whose subtree is preferred. Defaults to `root`.
     */
    getBestNotePathString(hoistedNoteId?: string): string;
    /**
     * Returns a record for every path from the root note to this note, best path first. Paths
     * within the hoisted note's subtree come first, then paths without archived notes, then paths
     * outside the hidden subtree, then shorter paths.
     *
     * @param hoistedNoteId The ID of the note whose subtree is preferred. Defaults to `root`.
     * @returns Records whose `notePath` holds the note IDs from the root to this note, with flags
     * telling whether the path lies within the hoisted subtree (`isInHoistedSubTree`), passes
     * through an archived note, the note itself included (`isArchived`), or lies within the hidden
     * subtree (`isHidden`).
     */
    getSortedNotePathRecords(hoistedNoteId?: string): ScriptNotePathRecord[];
    /**
     * Returns whether every path to this note passes through an archived note. Unlike `isArchived`,
     * this also counts a non-inheritable `archived` label on an ancestor. It throws an error if the
     * note has no path from the root.
     */
    areAllNotePathsArchived(): boolean;

    // --- Attributes (read) -------------------------------------------------
    /** The labels and relations defined directly on this note, without inherited ones. */
    ownedAttributes: ScriptAttribute[];
    /**
     * The relations in other notes (or this one) that point to this note. This includes the link
     * relations Trilium creates automatically for links in note content, such as `internalLink` and
     * `imageLink`.
     */
    targetRelations: ScriptAttribute[];
    /**
     * The number of labels and relations on this note, inherited ones and automatic link relations
     * included.
     */
    attributeCount: number;
    /**
     * The number of labels and relations defined directly on this note, automatic link relations
     * included.
     */
    ownedAttributeCount: number;
    /** The number of labels on this note, inherited ones included. */
    labelCount: number;
    /** The number of labels defined directly on this note. */
    ownedLabelCount: number;
    /**
     * The number of relations on this note, inherited ones included. Excludes the link relations
     * Trilium creates automatically for links in note content (`internalLink`, `imageLink`,
     * `relationMapLink`, `includeNoteLink`).
     */
    relationCount: number;
    /**
     * The number of relations on this note, inherited ones included, together with the link
     * relations Trilium creates automatically for links in note content.
     */
    relationCountIncludingLinks: number;
    /**
     * The number of relations defined directly on this note, excluding the link relations Trilium
     * creates automatically for links in note content.
     */
    ownedRelationCount: number;
    /**
     * The number of relations defined directly on this note, together with the link relations
     * Trilium creates automatically for links in note content.
     */
    ownedRelationCountIncludingLinks: number;
    /**
     * The number of relations in other notes that point to this note, excluding the link relations
     * Trilium creates automatically for links in note content.
     */
    targetRelationCount: number;
    /**
     * The number of relations in other notes that point to this note, together with the link
     * relations Trilium creates automatically for links in note content.
     */
    targetRelationCountIncludingLinks: number;
    /**
     * Returns the labels and relations of this note, inherited ones included, optionally filtered
     * by type and name. Without a filter, the result is the note's own cached array; don't modify
     * it.
     *
     * @param type `"label"` or `"relation"`; any other value throws an error.
     * @param name The attribute name, without the leading `#` or `~`.
     */
    getAttributes(type?: string, name?: string): ScriptAttribute[];
    /**
     * Returns the labels and relations defined directly on this note, optionally filtered by type
     * and name. Without a filter, the result is the `ownedAttributes` array itself; don't modify
     * it.
     *
     * @param type `"label"` or `"relation"`; any other value throws an error.
     * @param name The attribute name, without the leading `#` or `~`.
     */
    getOwnedAttributes(type?: string, name?: string): ScriptAttribute[];
    /**
     * Returns the first attribute of the given type and name, inherited ones included, or `null` if
     * there is none.
     *
     * @param type `"label"` or `"relation"`.
     */
    getAttribute(type: string, name: string): ScriptAttribute | null;
    /**
     * Returns the first attribute of the given type and name defined directly on this note, or
     * `null` if there is none. It skips inheritance, so it can be much faster than
     * `getAttribute()`.
     *
     * @param type `"label"` or `"relation"`.
     * @param value The value to match; when omitted, any value matches.
     */
    getOwnedAttribute(type: string, name: string, value?: string | null): ScriptAttribute | null;
    /**
     * Returns the value of the first attribute of the given type and name, inherited ones
     * included, or `null` if there is none. For a relation, the value is the target note's ID.
     *
     * @param type `"label"` or `"relation"`.
     */
    getAttributeValue(type: string, name: string): string | null;
    /**
     * Returns the value of the first attribute of the given type and name defined directly on this
     * note, or `null` if there is none. For a relation, the value is the target note's ID.
     *
     * @param type `"label"` or `"relation"`.
     */
    getOwnedAttributeValue(type: string, name: string): string | null;
    /**
     * Returns the attribute of this note with the given ID, inherited ones included, or `undefined`
     * if there is none.
     */
    getAttributeById(attributeId: string): ScriptAttribute | undefined;
    /**
     * Returns the first attribute of the given type whose name, and optionally value, matches
     * regardless of letter case, or `undefined` if none does. Inherited attributes are included.
     *
     * @param type `"label"` or `"relation"`.
     * @param value The value to match; an empty or omitted value matches any value.
     */
    getAttributeCaseInsensitive(
        type: string,
        name: string,
        value?: string | null
    ): ScriptAttribute | undefined;
    /**
     * Returns `true` if the note has a label or relation of the given type and name, inherited ones
     * included.
     *
     * @param type `"label"` or `"relation"`.
     */
    hasAttribute(type: string, name: string): boolean;
    /**
     * Returns whether the note has a label or relation of the given type and name defined directly
     * on it. Inherited attributes don't count.
     *
     * @param type `"label"` or `"relation"`.
     * @param value The value to match; when omitted, any value matches.
     */
    hasOwnedAttribute(type: string, name: string, value?: string): boolean;
    /**
     * Returns the attribute definitions on this note, inherited ones included. Currently returns
     * the same `#relation:*` definitions as `getRelationDefinitions()`, not the `#label:*` ones; to
     * read label definitions, filter `getLabels()` by names that start with `label:`.
     */
    getLabelDefinitions(): ScriptAttribute[];
    /**
     * Returns the relation definitions on this note, inherited ones included: the `#relation:*`
     * labels that declare promoted relations, such as `#relation:author="promoted,single"`.
     */
    getRelationDefinitions(): ScriptAttribute[];
    /**
     * Returns the relations in other notes (or this one) that point to this note, the automatic
     * link relations included. Same as `targetRelations`.
     */
    getTargetRelations(): ScriptAttribute[];

    // --- Labels ------------------------------------------------------------
    /**
     * Returns the first label with the given name, inherited ones included, or `null` if there is
     * none. Pass the name without the leading `#`.
     */
    getLabel(name: string): ScriptAttribute | null;
    /**
     * Returns the first label with the given name defined directly on this note, or `null` if there
     * is none.
     */
    getOwnedLabel(name: string): ScriptAttribute | null;
    /**
     * Returns the labels of this note, inherited ones included. When `name` is given, only labels
     * with that name are returned.
     */
    getLabels(name?: string): ScriptAttribute[];
    /** Returns the labels with the given name defined directly on this note. */
    getOwnedLabels(name: string): ScriptAttribute[];
    /**
     * Returns the value of the first label with the given name, inherited ones included, or `null`
     * if there is none. A label without a value returns an empty string.
     */
    getLabelValue(name: string): string | null;
    /**
     * Returns the value of the first label with the given name defined directly on this note, or
     * `null` if there is none.
     */
    getOwnedLabelValue(name: string): string | null;
    /**
     * Returns the values of all labels with the given name, inherited ones included, for labels
     * that can occur more than once.
     */
    getLabelValues(name: string): string[];
    /** Returns the values of all labels with the given name defined directly on this note. */
    getOwnedLabelValues(name: string): string[];
    /** Returns whether the note has a label with the given name, inherited ones included. */
    hasLabel(name: string): boolean;
    /**
     * Returns whether the note has a label with the given name defined directly on it.
     *
     * @param value The value to match; when omitted, any value matches.
     */
    hasOwnedLabel(name: string, value?: string): boolean;
    /**
     * Returns whether the note has a label with the given name, inherited ones included, whose
     * value is not `"false"`. A label without a value counts as `true`.
     */
    isLabelTruthy(name: string): boolean;
    /**
     * Returns `true` if the note has an inheritable `#archived` label, owned or inherited, so that
     * the note's descendants are archived too.
     */
    hasInheritableArchivedLabel(): boolean;

    // --- Relations ---------------------------------------------------------
    /**
     * Returns the first relation with the given name, inherited ones included, or `null` if there
     * is none. Pass the name without the leading `~`.
     */
    getRelation(name: string): ScriptAttribute | null;
    /**
     * Returns the first relation with the given name defined directly on this note, or `null` if
     * there is none.
     */
    getOwnedRelation(name: string): ScriptAttribute | null;
    /**
     * Returns the relations of this note, inherited ones included. When `name` is given, only
     * relations with that name are returned.
     */
    getRelations(name?: string): ScriptAttribute[];
    /**
     * Returns the relations defined directly on this note. When `name` is given, only relations
     * with that name are returned.
     */
    getOwnedRelations(name?: string | null): ScriptAttribute[];
    /**
     * Returns the ID of the note that the first relation with the given name points to, inherited
     * relations included, or `null` if there is none. To get the note itself, use
     * `getRelationTarget()`.
     */
    getRelationValue(name: string): string | null;
    /**
     * Returns the ID of the note that the first relation with the given name defined directly on
     * this note points to, or `null` if there is none.
     */
    getOwnedRelationValue(name: string): string | null;
    /**
     * Returns the note that the first relation with the given name points to, or `null` if the note
     * has no such relation. Inherited relations are included.
     */
    getRelationTarget(name: string): ScriptBNote | null;
    /**
     * Returns whether the note has a relation with the given name, inherited ones included.
     *
     * @param value The ID of the target note to match; when omitted, any target matches.
     */
    hasRelation(name: string, value?: string): boolean;
    /**
     * Returns whether the note has a relation with the given name defined directly on it.
     *
     * @param value The ID of the target note to match; when omitted, any target matches.
     */
    hasOwnedRelation(name: string, value?: string): boolean;

    // --- Attributes (write) ------------------------------------------------
    /**
     * Adds a label to this note, saves it and returns it. It adds a new label even when the note
     * already has one with that name; to change an existing label instead, use `setLabel()`.
     *
     * @param name The label name, without the leading `#`.
     * @param value The label value. Defaults to an empty string.
     * @param isInheritable Whether the note's descendants inherit the label. Defaults to `false`.
     */
    addLabel(name: string, value?: string, isInheritable?: boolean): ScriptAttribute;
    /**
     * Adds a relation from this note to another note, saves it and returns it. It adds a new
     * relation even when the note already has one with that name; to change an existing relation
     * instead, use `setRelation()`.
     *
     * @param name The relation name, without the leading `~`.
     * @param isInheritable Whether the note's descendants inherit the relation. Defaults to
     * `false`.
     */
    addRelation(name: string, targetNoteId: string, isInheritable?: boolean): ScriptAttribute;
    /**
     * Adds a label or relation to this note, saves it and returns it. `addLabel()` and
     * `addRelation()` do the same for one type.
     *
     * @param type `"label"` or `"relation"`.
     * @param name The attribute name, without the leading `#` or `~`.
     * @param value The label's text, or the relation's target note ID. Defaults to an empty string.
     * @param isInheritable Whether the note's descendants inherit the attribute. Defaults to
     * `false`.
     */
    addAttribute(
        type: string,
        name: string,
        value?: string,
        isInheritable?: boolean
    ): ScriptAttribute;
    /**
     * Sets the value of the first label with the given name defined directly on this note, or adds
     * a non-inheritable label if the note has none of its own. Inherited labels are left alone. The
     * change is saved immediately.
     *
     * @param value The new value. Defaults to an empty string.
     */
    setLabel(name: string, value?: string): void;
    /**
     * Points the first relation with the given name defined directly on this note to another note,
     * or adds a non-inheritable relation if the note has none of its own. Inherited relations are
     * left alone. The change is saved immediately.
     *
     * @param value The ID of the target note.
     */
    setRelation(name: string, value?: string): void;
    /**
     * Sets the value of the first attribute of the given type and name defined directly on this
     * note, or adds a non-inheritable one if the note has none of its own. `setLabel()` and
     * `setRelation()` do the same for one type. The change is saved immediately.
     *
     * @param type `"label"` or `"relation"`.
     * @param value The label's text, or the relation's target note ID. Defaults to an empty string.
     */
    setAttribute(type: string, name: string, value?: string): void;
    /**
     * Sets the value of the attribute with the given ID, which must be defined directly on this
     * note, and saves it. Throws an error if the note has no such attribute of its own.
     *
     * @param value The new value. Defaults to an empty string.
     */
    setAttributeValueById(attributeId: string, value?: string): void;
    /**
     * Sets the label like `setLabel()` when `enabled` is `true`, and removes it like
     * `removeLabel()` when it is `false`.
     */
    toggleLabel(enabled: boolean, name: string, value?: string): void;
    /**
     * Sets the relation like `setRelation()` when `enabled` is `true`, and removes it like
     * `removeRelation()` when it is `false`.
     *
     * @param value The ID of the target note.
     */
    toggleRelation(enabled: boolean, name: string, value?: string): void;
    /**
     * Sets the attribute like `setAttribute()` when `enabled` is `true`, and removes it like
     * `removeAttribute()` when it is `false`.
     *
     * @param type `"label"` or `"relation"`.
     */
    toggleAttribute(type: string, enabled: boolean, name: string, value?: string): void;
    /**
     * Removes every label with the given name defined directly on this note. Inherited labels are
     * not affected.
     *
     * @param value The value to match; when omitted, labels with any value are removed.
     */
    removeLabel(name: string, value?: string): void;
    /**
     * Removes every relation with the given name defined directly on this note. Inherited
     * relations are not affected.
     *
     * @param value The ID of the target note to match; when omitted, relations to any note are
     * removed.
     */
    removeRelation(name: string, value?: string): void;
    /**
     * Removes every attribute of the given type and name defined directly on this note. Inherited
     * attributes are not affected.
     *
     * @param type `"label"` or `"relation"`.
     * @param value The value to match; when omitted, attributes with any value are removed.
     */
    removeAttribute(type: string, name: string, value?: string): void;
    /**
     * Returns `true` if another note uses this note as its template or inheritance source, through
     * a `~template` or `~inherit` relation. Despite the name, it does not tell whether this note
     * inherits attributes itself.
     */
    isInherited(): boolean;

    // --- Revisions & attachments -------------------------------------------
    /**
     * The number of revisions of this note. It is `null` until a search that filters or sorts by
     * `revisionCount` or one of the size properties has run; `getRevisions().length` always works.
     */
    revisionCount: number | null;
    /** Returns the saved revisions of this note, oldest first. */
    getRevisions(): ScriptBRevision[];
    /**
     * Saves a revision that snapshots the note's current title, content and attachments, and
     * returns it. Afterwards, Trilium erases the oldest revisions beyond the number the revision
     * settings keep.
     *
     * @param opts `description` names the revision; `source` records what created it: `"auto"` (the
     * default), `"manual"`, `"etapi"`, `"llm"` or `"restore"`.
     */
    saveRevision(opts?: { description?: string; source?: string }): ScriptBRevision;
    /**
     * Returns the attachments of this note, ordered by position. Deleted attachments are excluded.
     */
    getAttachments(): ScriptBAttachment[];
    /**
     * Returns the attachment of this note with the given ID. Returns `undefined` if this note has
     * no such attachment, although the type does not say so.
     */
    getAttachmentById(attachmentId: string): ScriptBAttachment;
    /**
     * Returns the first attachment of this note whose title matches exactly, or `undefined` if none
     * does.
     */
    getAttachmentByTitle(title: string): ScriptBAttachment | undefined;
    /**
     * Returns the attachments of this note with the given role, such as `"image"` or `"file"`,
     * ordered by position.
     */
    getAttachmentsByRole(role: string): ScriptBAttachment[];
    /**
     * Saves an attachment of this note and returns it. If an existing attachment matches, only its
     * content is replaced; otherwise a new attachment is created from `attachment`, protected if
     * the note is. Missing content is saved as an empty string.
     *
     * @param matchBy How to find an existing attachment to update: `"attachmentId"` (the default)
     * by `attachment.attachmentId`, which throws an error if no attachment has that ID, or
     * `"title"` by `attachment.title` among this note's attachments.
     */
    saveAttachment(
        attachment: ScriptSaveAttachmentInput,
        matchBy?: "attachmentId" | "title"
    ): ScriptBAttachment;
    /**
     * Converts this image note into an image attachment of its parent text note, points the
     * parent's content at the attachment, deletes this note and returns the attachment. Returns
     * `null` and changes nothing when `isEligibleForConversionToAttachment()` returns `false`.
     *
     * @param opts Pass `{ autoConversion: true }` to also require that the parent links the image.
     */
    convertToParentAttachment(opts?: { autoConversion?: boolean }): ScriptBAttachment | null;
    /**
     * Returns `true` if this note can be converted into an attachment of its parent: it is an image
     * note with no children and a single parent, the parent is a text note, both are readable in
     * the current session, and at most one `~imageLink` relation points to the image, from the
     * parent.
     *
     * @param opts Pass `{ autoConversion: true }` to also require that the parent links the image.
     */
    isEligibleForConversionToAttachment(opts?: { autoConversion?: boolean }): boolean;

    // --- Sizes -------------------------------------------------------------
    /**
     * The size of the note's content in bytes. Like the other size properties, it is `null` until a
     * search that filters or sorts by one of them, or by `revisionCount`, has run.
     */
    contentSize: number | null;
    /**
     * The size in bytes of the note's content together with its attachments, counting content
     * that several of them share once. It is `null` until a search that uses it has run.
     */
    contentAndAttachmentsSize: number | null;
    /**
     * The size in bytes of the note's content together with its attachments and its revisions and
     * their attachments, counting shared content once. It is `null` until a search that uses it has
     * run.
     */
    contentAndAttachmentsAndRevisionsSize: number | null;

    // --- Tree operations ---------------------------------------------------
    /**
     * Places this note under another parent note as well, keeping its existing placements, and
     * expands the new parent in the note tree. The result does not throw on failure; check
     * `success`, and read `message` for why it failed (for example, the note is already in that
     * parent, the target is a search note, or the clone would create a cycle).
     *
     * @param parentNoteId The ID of the note to clone into.
     * @returns On success, `branchId` of the new branch and `notePath` of the clone.
     */
    cloneTo(parentNoteId: string): ScriptCloneResponse;
    /**
     * Deletes the note from every place in the tree, together with its descendants that have no
     * other placement, and runs its `runOnNoteDeletion` relations first. Deleted notes stay
     * recoverable until they are erased. Does nothing if the note is already deleted.
     *
     * @param deleteId An ID that groups the deleted notes, branches and attributes so that they can
     * be restored together. Defaults to a new random ID.
     */
    deleteNote(deleteId?: string | null): void;
    /**
     * Reorders this note's `parents` and `parentBranches` in memory so that archived and hidden
     * parents come last, which makes Trilium prefer the other paths when it picks a note path.
     * Saves nothing.
     */
    sortParents(): void;
    /**
     * Reorders this note's `children` array in memory by each child's `notePosition`. Saves nothing
     * and does not change the order shown in the note tree.
     */
    sortChildren(): void;

    // --- Search ------------------------------------------------------------
    /**
     * Returns the notes that match a search query. Despite the name, the search covers the whole
     * tree, not only this note's subtree, and leaves out archived and hidden notes; to limit it to
     * this note's subtree, call `api.searchForNotes(query, { ancestorNoteId: note.noteId })`.
     */
    searchNotesInSubtree(searchString: string): ScriptBNote[];
    /**
     * Returns the first note that matches a search query, or `undefined` if none does. Like
     * `searchNotesInSubtree()`, the search covers the whole tree, not only this note's subtree.
     */
    searchNoteInSubtree(searchString: string): ScriptBNote | null;
    /**
     * Runs the saved search of a search note and returns the notes it finds. Returns an empty array
     * for other note types, and when the search fails (the error goes to the backend log).
     */
    getSearchResultNotes(): ScriptBNote[];

    // --- Type & state predicates -------------------------------------------
    /**
     * Returns `true` if this note is a search note or has at least one child, archived children
     * included.
     */
    isFolder(): boolean;
    /**
     * Returns `true` if the note's title and content can be read: the note is not protected, or a
     * protected session is open. Otherwise the content reads as an empty string and the title as
     * `"[protected]"`.
     */
    isContentAvailable(): boolean;
    /**
     * Returns whether `getContent()` returns a string rather than a `Uint8Array`.
     *
     * @deprecated Use `hasStringContent()` instead.
     */
    isStringNote(): boolean;
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
    /**
     * Returns `true` if this note is one of the settings pages in the hidden subtree, whose IDs
     * start with `_options`.
     */
    isOptions(): boolean;
    /**
     * Returns `true` if this note is a launcher or one of the containers that configure the desktop
     * or mobile launch bar.
     */
    isLaunchBarConfig(): boolean;
    /**
     * Returns whether every path to this note passes through the hidden subtree (`_hidden`), so
     * that the note has no placement in the visible tree. Returns `false` for the root note and for
     * `_hidden` itself.
     */
    isHiddenCompletely(): boolean;
    /**
     * Returns `true` if this note is the hidden root note (`_hidden`) or lies under it in any of
     * its placements. The hidden subtree holds Trilium's system notes, such as settings, launchers
     * and templates.
     */
    isInHiddenSubtree(): boolean;

    // --- Scripting runtime -------------------------------------------------
    /**
     * Returns where the note runs as a script: `"backend"` for JavaScript with `env=backend` in its
     * MIME type, `"frontend"` for frontend JavaScript, JSX, HTML and render notes, and `null` for
     * notes that are not scripts.
     */
    getScriptEnv(): "frontend" | "backend" | null;
    /**
     * Runs this note as a backend script and returns the script's return value, which is a promise
     * for an async script. The note must be a backend JavaScript code note; for any other note it
     * runs nothing and returns `undefined`. Throws an error if the note is protected and no
     * protected session is active, or if backend scripting is disabled.
     */
    executeScript(): unknown;
}

/** Result of the backend note-creation helpers. */
export interface ScriptNoteAndBranch {
    /** The new note. For `duplicateSubtree()`, it is the copy of the original note. */
    note: ScriptBNote;
    /** The branch that places the new note under its parent. */
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
     * Note where the script execution started — the entry point of the current script bundle
     * (in C terms, the file containing `main()`). When a script is spread across multiple code
     * notes (descendant code notes loaded as modules via `require()`), every note in the
     * bundle shares the same `startNote`, while {@link currentNote} differs per note.
     * Messages from `api.log()` are grouped under this note.
     *
     * When a frontend script calls `api.runOnBackend()`, the frontend's `startNote` is
     * preserved here; since that note may not be resolvable on the backend, this can be null.
     */
    startNote?: ScriptBNote | null;
    /**
     * Note containing the source code that is currently executing (in C terms, `__FILE__`).
     * Equal to {@link startNote} unless execution has moved into a descendant module note
     * loaded via `require()`. Don't confuse this with the concept of the active note in
     * the UI.
     */
    currentNote: ScriptBNote;
    /**
     * Entity whose event triggered this execution; `undefined` when the run was not
     * event-driven (e.g. started manually via "Execute script" or `note.executeScript()`).
     *
     * What it holds depends on the trigger:
     * - `~runOnNoteCreation`, `~runOnNoteChange`, `~runOnNoteTitleChange`,
     *   `~runOnNoteContentChange` — the affected note;
     * - `~runOnChildNoteCreation` — the newly created child note;
     * - `~runOnAttributeCreation`, `~runOnAttributeChange` — the attribute;
     * - `~runOnBranchCreation`, `~runOnBranchChange`, `~runOnBranchDeletion` — the branch;
     * - scheduled scripts (`#run=backendStartup` / `#run=hourly` / `#run=daily`) — the
     *   script note itself;
     * - search scripts (`~searchScript`) — the search note.
     */
    originEntity?: ScriptBNote | ScriptBBranch | ScriptAttribute | null;

    /**
     * The HTTP request, present only when the script runs as a custom request handler: a note
     * with the `#customRequestHandler` label, invoked through a `/custom/...` URL. It is
     * `undefined` in every other backend script. The object is Express's own request, so it has
     * more members than `ScriptRequest` lists.
     */
    req: ScriptRequest;
    /**
     * The HTTP response to write the reply to, such as `api.res.status(200).json({ ok: true })`.
     * Like `req`, it is present only in custom request handlers, and is Express's own response.
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
    /** The xml2js library, which converts between XML and JavaScript objects. */
    xml2js: ScriptXml2js;
    /** The node-html-parser library, which parses HTML into elements that can be queried. */
    htmlParser: ScriptHtmlParser;

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
    getAttachment(attachmentId: string): ScriptBAttachment | null;
    /** Returns a revision by its ID, or null. */
    getRevision(revisionId: string): ScriptBRevision | null;
    /** Returns an ETAPI token by its ID, or null. */
    getEtapiToken(etapiTokenId: string): ScriptBEtapiToken | null;
    /** Returns all ETAPI tokens. */
    getEtapiTokens(): ScriptBEtapiToken[];
    /** Returns an option by name, or null. */
    getOption(optionName: string): ScriptBOption | null;
    /** Returns all options. */
    getOptions(): ScriptBOption[];

    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See {@link https://triliumnext.github.io/Docs/Wiki/search.html} for full documentation for all options
     */
    searchForNotes(query: string, searchParams?: ScriptSearchParams): ScriptBNote[];
    /**
     * This is a powerful search method - you can search by attributes and their values, e.g.:
     * "#dateModified =* MONTH AND #log". See {@link https://triliumnext.github.io/Docs/Wiki/search.html} for full documentation for all options
     */
    searchForNote(query: string, searchParams?: ScriptSearchParams): ScriptBNote | null;
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
     * Sort child notes of a given note. `sortBy` takes the `#sorted` grammar — comma-separated
     * levels of `title`, `dateCreated`, `dateModified` or a label name, each optionally followed by
     * `asc` or `desc` (`priority desc, dueDate`); `reverse` is the direction of the levels without
     * their own, of the folders grouping and of ties.
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
    /** Direct access to Trilium's SQLite database. */
    sql: ScriptSql;
    /** Application info (version, build date, etc.). */
    getAppInfo(): ScriptAppInfo;

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
