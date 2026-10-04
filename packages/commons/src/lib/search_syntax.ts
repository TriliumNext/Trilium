/**
 * The property path a search query walks from a note: `note.title`, `note.parents.title`,
 * `~author.relations.son.title`. The segments are the ones `parseNoteProperty()` accepts.
 *
 * The search engine keeps the same property names in its own `PROP_MAPPING` tables; a spec in
 * `trilium-core` holds this list against what the engine actually accepts.
 */
export const SEARCH_NOTE_PATH = {
    /** Compared against a value, so an operator follows: `note.title = x`. */
    properties: [
        "noteId",
        "title",
        "type",
        "mime",
        "isProtected",
        "isArchived",
        "dateCreated",
        "dateModified",
        "utcDateCreated",
        "utcDateModified",
        "parentCount",
        "childrenCount",
        "attributeCount",
        "labelCount",
        "ownedLabelCount",
        "relationCount",
        "ownedRelationCount",
        "relationCountIncludingLinks",
        "ownedRelationCountIncludingLinks",
        "targetRelationCount",
        "targetRelationCountIncludingLinks",
        "contentSize",
        "contentAndAttachmentsSize",
        "contentAndAttachmentsAndRevisionsSize",
        "revisionCount"
    ],
    /** Matched against the note's text through a full-text expression rather than a property. */
    contentProperties: [ "content", "rawContent", "text" ],
    /** Step onto another note, so a further segment follows: `note.parents.title`. */
    traversals: [ "parents", "children", "ancestors" ],
    /** Expect an attribute name next, which nothing can enumerate ahead of time. */
    attributeSegments: [ "labels", "relations" ]
} as const;

/** Every segment that can stand directly after a `.` in a property path. */
export const SEARCH_NOTE_PATH_SEGMENTS: readonly string[] = [
    ...SEARCH_NOTE_PATH.properties,
    ...SEARCH_NOTE_PATH.contentProperties,
    ...SEARCH_NOTE_PATH.traversals,
    ...SEARCH_NOTE_PATH.attributeSegments
];

/** Every comparison operator the grammar spells, in the order a reader meets them. */
export const SEARCH_OPERATORS: readonly string[] = [
    "=", "!=", "*=*", "=*", "*=", ">", ">=", "<", "<=", "%=", "~=", "~*"
];

/** A relation names a note; only a `.`, walking into a property of that note, continues it. */
export const NO_SEARCH_OPERATORS: ReadonlySet<string> = new Set();
/** `parseNoteProperty()` matches `note.text` and rejects every other operator outright. */
export const TEXT_SEARCH_OPERATORS: ReadonlySet<string> = new Set([ "*=*" ]);
/** `ALLOWED_OPERATORS` in `note_content_fulltext.ts`: content is matched, never ordered. */
export const CONTENT_SEARCH_OPERATORS: ReadonlySet<string> = new Set([
    "=", "!=", "*=*", "*=", "=*", "%=", "~=", "~*"
]);

/**
 * The operators `operand` can be compared with, `undefined` standing for no restriction. Shared by
 * the completion, which offers only these, and the linter, which marks the ones outside them.
 *
 * `operand` is the attribute or property path as it is written: `#book`, `~author`, `note.text`.
 */
export function allowedSearchOperators(operand: string): ReadonlySet<string> | undefined {
    const segments = operand.split(".");
    // `split` always yields a last segment, where a path of one segment yields no previous one.
    const property = segments[segments.length - 1].toLowerCase();
    const previous = (segments[segments.length - 2] ?? "").toLowerCase();

    // The name after `labels.` is the user's own, and says nothing about the comparison.
    if (previous === "labels") {
        return undefined;
    }

    if (previous === "relations" || (operand.startsWith("~") && segments.length === 1)) {
        return NO_SEARCH_OPERATORS;
    }

    if (property === "text") {
        return TEXT_SEARCH_OPERATORS;
    }

    if (property === "content" || property === "rawcontent") {
        return CONTENT_SEARCH_OPERATORS;
    }

    return undefined;
}
