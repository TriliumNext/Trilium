import type { LabelType, Multiplicity } from "@triliumnext/commons";

/** A database column value lifted from a page's Notion properties table, destined for a Trilium attribute. */
export interface NotionProperty {
    /** The column name, taken verbatim from the property row's `<th>` (sanitized only when made an attribute). */
    name: string;
    /** A label's final value, or — for a relation — the target page's Notion id (resolved to a note on import). */
    value: string;
    /** Trilium promoted-attribute type for a label column; omitted for a relation (it has no value type). */
    labelType?: LabelType;
    /** Whether the column holds one value or many (e.g. multi-select); sets the definition's multiplicity. */
    multiplicity: Multiplicity;
    /**
     * For a relation column, `value` is a target Notion id mapped to a `~relation` in the second pass; for a
     * file column, `value` is a zip-relative href saved as a `role:"file"` attachment. A plain label has neither.
     */
    kind?: "relation" | "file";
}

/** A parsed Notion export page: its identity and folder placement, body HTML and database properties. */
export interface ParsedPage {
    /** The page's own Notion id, used to resolve cross-page links pointing at it. */
    id: string;
    title: string;
    /** Path of the .html entry inside the zip; drives both image resolution and folder-based parenting. */
    path: string;
    /** The page's body HTML, sanitized; empty when the body could not be located. */
    content: string;
    /**
     * Notion ids this page references as subpages — from its `link-to-page` blocks and rendered collection
     * table. These survive a "Create folders for subpages"-disabled export even though the folder structure
     * that conveys nesting does not, so they let the importer detect that flattened export.
     */
    linkedPageIds: string[];
    /** Database properties from the page's Notion properties table, mapped to Trilium labels on import. */
    properties: NotionProperty[];
    /**
     * Whether this page is a Notion database (collection) rather than an ordinary page. Set by
     * `resolveDatabaseContainers`: such a page's body is the rendered collection table — dropped on import,
     * since a collection note is empty — and it is the note its database's rows nest under.
     */
    isDatabase?: boolean;
    utcDateCreated?: string;
    utcDateModified?: string;
}

/** A resolved import target: the note created for a Notion page, plus that page's title. */
export interface LinkTarget {
    noteId: string;
    title: string;
}
