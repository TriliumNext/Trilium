/**
 * Shared types for the Anytype importer: the shape of an exported object's JSON ("any-block") and the
 * intermediate `Parsed*` values the importer builds from it. Kept in one module so the importer, the content
 * renderer ({@link ./content.js}) and the collection handler ({@link ./collection.js}) all depend on the
 * types without depending on each other — mirroring the Notion importer's `model.ts`.
 */

// #region Export shape
/** A `[from, to)` character range a mark applies to. Offsets are UTF-16 code units (Anytype's editor is
 * JS/Electron), so they line up with JavaScript string indexing. */
export interface AnytypeMarkRange {
    from?: number;
    to?: number;
}

/** An inline formatting span over a text block's `text`. `type` is the kind (Bold, Italic, Strikethrough,
 * Underscored, Keyboard, TextColor, Mention, …); `param` carries extra data for some kinds (a colour name, a
 * link URL, or — for a `Mention` — the linked object's id). Marks may overlap freely and are not pre-sorted. */
export interface AnytypeMark {
    range?: AnytypeMarkRange;
    type?: string;
    param?: string;
}

/** The text payload of a text block: its `text`, `style` (Paragraph, Header1, Marked, Checkbox, Callout, …),
 * a `marks.marks` list of inline formatting spans over `text`, and per-style extras (`checked`, `iconEmoji`). */
export interface AnytypeText {
    text?: string;
    style?: string;
    marks?: {
        marks?: AnytypeMark[];
    };
    /** Whether a `Checkbox`-style list item is ticked. */
    checked?: boolean;
    /** A `Callout`'s icon; empty for the default icon, otherwise a custom emoji. */
    iconEmoji?: string;
}

/** A single block in an object's `snapshot.data.blocks`. Non-text blocks (dataviews, …) carry other keys
 * this importer doesn't read yet; only `id`, `childrenIds`, `text`, `div`, `link`, `file`, `latex`,
 * `bookmark`, `table`/`tableRow` and (for code blocks) `fields.lang` are needed to pull out the page's
 * content in document order. */
export interface AnytypeBlock {
    id: string;
    childrenIds?: string[];
    text?: AnytypeText;
    /** Per-block extras. For a `Code`-style text block, `lang` holds the PrismJS language id. */
    fields?: {
        lang?: string;
    };
    /** A divider block (`style` is "Line" or "Dots"); both become a horizontal rule. */
    div?: {
        style?: string;
    };
    /** A block-level "link to object". `targetBlockId` is the linked object's id (CID); `style` is "Page"
     * for a page link. Rendered as a reference link to the imported target note. */
    link?: {
        targetBlockId?: string;
        style?: string;
    };
    /** A file/media block — an embedded image, PDF or other attached file. `type` is the kind ("Image",
     * "PDF", "File", "Audio", "Video"); `targetObjectId` is the linked `FileObject`'s id (resolved to its
     * bytes via the `filesObjects/` metadata + `files/` bytes); `name` is the original filename. Rendered as
     * an inline `<img>` (Image) or an attachment reference link (other types) pointing at the saved
     * attachment. `state` is "Done" once the upload finished — a still-uploading file has no bytes. */
    file?: {
        name?: string;
        type?: string;
        mime?: string;
        targetObjectId?: string;
        state?: string;
        style?: string;
    };
    /** A "latex" block — Anytype's embed for code-rendered diagrams and math. `processor` picks the renderer
     * ("Mermaid" for a Mermaid diagram; otherwise the `text` is LaTeX math). */
    latex?: {
        text?: string;
        processor?: string;
    };
    /** A "bookmark" block — Anytype's web-link card. It carries the target site's `url`, `title` and
     * `description` inline (fetched by Anytype when the card was created); `faviconHash`/`imageHash` are the
     * CIDs of the fetched icon/preview `FileObject`s (content-addressed, not URLs — the importer resolves them
     * to inline base64 `data:` URIs), and `targetObjectId` is the separate `ot-bookmark` object the card
     * mirrors (a non-page layout, so not imported). Rendered as a Trilium link-embed (open-graph preview),
     * like the Notion importer's bookmark cards. */
    bookmark?: {
        url?: string;
        title?: string;
        description?: string;
        imageHash?: string;
        faviconHash?: string;
        type?: string;
        targetObjectId?: string;
        state?: string;
    };
    /** A table block (an empty marker object). Its two children are a `TableColumns` and a `TableRows`
     * layout block; each row's cells are text blocks whose id is `${rowId}-${columnId}`. */
    table?: Record<string, unknown>;
    /** A table-row block (child of the `TableRows` layout); `isHeader` marks a header row. */
    tableRow?: {
        isHeader?: boolean;
    };
    /** A dataview block — a set (query) or collection (manual list). `isCollection` distinguishes the two;
     * `views[]` are its views (the first is the active one): `type` is the layout (Table/List/Gallery/
     * Calendar/Kanban), `groupRelationKey` is the relation the view organizes by (a Kanban's grouping
     * column, a Calendar's date field — empty for layouts that don't group) and `relations` the ordered,
     * per-column display config (a column's `key` is a `relationKey`). */
    dataview?: {
        isCollection?: boolean;
        views?: {
            type?: string;
            groupRelationKey?: string;
            relations?: {
                key?: string;
                isVisible?: boolean;
            }[];
        }[];
    };
}

/** The object's `snapshot.data.details` — its metadata map. `layout` distinguishes a basic page (0) from
 * a set/collection (3) and other system layouts; `name` is the title; `id` matches the root block's id.
 * `layout` is omitted when it's the default (0), so `resolvedLayout` (always present) is the reliable
 * source of the effective layout. Custom property values are carried under their relation's hex
 * `relationKey`, hence the index signature. */
export interface AnytypeDetails {
    id?: string;
    name?: string;
    layout?: number;
    resolvedLayout?: number;
    /** Page creation time as a Unix timestamp in seconds. Omitted/`0` for system objects. */
    createdDate?: number;
    /** Page last-modification time as a Unix timestamp in seconds. */
    lastModifiedDate?: number;
    /** Outgoing object links; for a collection, this is its membership. */
    links?: string[];
    /** The id of the object (e.g. a collection) this object was created inside. A collection-scoped export
     * omits the collection itself, so its members all point at the same absent id — the signal that the
     * export is a single collection's contents. */
    createdInContext?: string;
    /** On a relation-definition object: the key objects carry the value under, the format code, and (for a
     * date format) whether the value includes a time component. */
    relationKey?: string;
    relationFormat?: number;
    relationFormatIncludeTime?: boolean;
    /** On a `FileObject`: the display name, file extension, MIME type and the export path of the raw bytes
     * (e.g. `files\name.ext`). */
    fileExt?: string;
    fileMimeType?: string;
    source?: string;
    /** A custom property value, keyed by its relation's hex `relationKey`. */
    [key: string]: unknown;
}

/** One exported object file: `sbType` is the smartblock kind ("Page", "Participant", "Workspace", …) and
 * `snapshot.data` holds the blocks and details. */
export interface AnytypeSnapshot {
    sbType?: string;
    snapshot?: {
        data?: {
            blocks?: AnytypeBlock[];
            details?: AnytypeDetails;
            objectTypes?: string[];
        };
    };
}
// #endregion

// #region Parsed values
/** A page parsed down to what the importer needs to create a Trilium note. */
export interface ParsedObject {
    /** The object's id (the root block's id); used later to resolve cross-object links. */
    id: string;
    title: string;
    /** Body HTML built from the page's blocks. */
    content: string;
    /** De-duplicated Trilium note ids this page links to, for recording `internalLink` relations. */
    linkTargetIds: string[];
    /** Creation time as a Trilium UTC datetime string (from Anytype's `createdDate`), if available. */
    dateCreated?: string;
    /** Last-modification time as a Trilium UTC datetime string (from `lastModifiedDate`), if available. */
    dateModified?: string;
    /** The object's custom property values, applied to its note as labels. */
    properties: ParsedProperty[];
    /** File-object ids from the object's file properties; resolved to `role:"file"` attachments at import. */
    fileRefs: string[];
    /** File-object ids the body embeds inline (image/file blocks). Tracks which exported files a page already
     * references, so a collection-scoped export can tell its unreferenced file members apart from these. */
    inlineFileIds: string[];
    /** Present when the object is a collection: its table schema and membership. */
    collection?: ParsedCollection;
}

/** The imported note a linked-to Anytype object resolved to: its Trilium id and (fallback) title. */
export interface ResolvedLink {
    noteId: string;
    title: string;
}

/** Resolves an Anytype object id (CID) to the Trilium note it was imported as, or undefined when the
 * target wasn't imported (a set/collection, or an object missing from the export). */
export type LinkResolver = (targetCid: string) => ResolvedLink | undefined;

/** A relation definition resolved from the `relations/` folder: its display name, Anytype format code and
 * (for date formats) whether the value carries a time component. */
export interface RelationInfo {
    name: string;
    format: number;
    includeTime?: boolean;
}

/** A file object resolved from the `filesObjects/` folder: the attachment title, MIME and the `files/` path
 * its raw bytes live at. */
export interface FileObjectInfo {
    title: string;
    mime: string;
    source: string;
}

/** The Trilium label types a supported Anytype property maps to (email/phone reuse `url`). */
export type PropertyLabelType = "text" | "number" | "url" | "date" | "datetime" | "boolean";

/** Whether a property holds a single value or several (a multi-select). */
export type Multiplicity = "single" | "multi";

/** One custom property value on an object: the Trilium attribute name and its (already formatted) value. */
export interface ParsedProperty {
    name: string;
    value: string;
}

/** One collection table column: its attribute name, Trilium label type, original (alias) name and value count. */
export interface ParsedColumn {
    name: string;
    labelType: PropertyLabelType;
    alias: string;
    multiplicity: Multiplicity;
}

/** The Trilium collection view types an Anytype dataview layout maps to. */
export type CollectionViewType = "table" | "list" | "grid" | "calendar" | "board";

/** A collection's view type, table schema and membership. `viewType` is the Trilium view its Anytype
 * layout maps to; `memberIds` are Anytype object ids (its `details.links`); `columns` are the visible,
 * supported columns from its dataview, in order. `groupByAttribute` is the Trilium attribute name the
 * view's `groupRelationKey` resolved to — driving `#board:groupBy` for a board or `#calendar:startDate`
 * for a calendar; absent when the view doesn't group by a (resolvable) relation. */
export interface ParsedCollection {
    viewType: CollectionViewType;
    groupByAttribute?: string;
    memberIds: string[];
    columns: ParsedColumn[];
}
// #endregion
