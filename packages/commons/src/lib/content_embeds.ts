import { encodeBlockParameter } from "./block_reference.js";

/**
 * Where an embed sits: what has been rendered on the path down to it, and how deep embedding goes.
 * The app's read-only renderer and the share renderer pass these down when they render the content
 * an embed shows.
 */
export interface ContentEmbedContext {
    /** The notes and blocks rendered on the path to this embed, by {@link getEmbedKey}. */
    seenNoteIds: ReadonlySet<string>;
    /** Embeds become reference links: the content is itself an embed below the first level. */
    embedsAsReferenceLinks?: boolean;
    /** Embeds keep expanding at every depth, as printing and the static export do. */
    expandNestedEmbeds?: boolean;
}

/** What an `.include-note` element stands for, and whether it shows the content or links to it. */
export type ContentEmbed =
    | { kind: "attachment"; attachmentId: string; asLink: boolean }
    | { kind: "note"; noteId: string; block: string | undefined; asLink: boolean };

/** The options the content an embed shows is rendered with. */
export interface NestedEmbedOptions {
    seenNoteIds: Set<string>;
    block: string | undefined;
    expandNestedEmbeds?: true;
    embedsAsReferenceLinks?: true;
}

const ENTITY_ID = /^[a-zA-Z0-9_]+$/;

/** The key of an embed in `seenNoteIds`. A note can embed blocks of itself. */
export function getEmbedKey(noteId: string, block: string | null | undefined) {
    return block ? `${noteId}:${block}` : noteId;
}

/**
 * Reads an `.include-note` element and decides what it becomes, or `null` when it names nothing
 * valid. The IDs come from note HTML, so only an ID of the shape Trilium generates gets through.
 *
 * It becomes a link to what it shows rather than the content itself when it is a Tiny embed, which
 * shows only a title; when the content around it is itself an embed below the first level; and,
 * for a note, when the note is already being rendered on the path to it, which would otherwise
 * never end.
 */
export function resolveContentEmbed(
    getAttribute: (name: string) => string | null | undefined,
    context: ContentEmbedContext
): ContentEmbed | null {
    const asLink = !!context.embedsAsReferenceLinks || getAttribute("data-box-size") === "tiny";

    const attachmentId = getAttribute("data-attachment-id");
    if (attachmentId) {
        return ENTITY_ID.test(attachmentId) ? { kind: "attachment", attachmentId, asLink } : null;
    }

    const noteId = getAttribute("data-note-id");
    if (!noteId || !ENTITY_ID.test(noteId)) {
        return null;
    }

    const block = getAttribute("data-block") || undefined;
    const isCycle = context.seenNoteIds.has(getEmbedKey(noteId, block));
    return { kind: "note", noteId, block, asLink: asLink || isCycle };
}

/**
 * The options to render an embedded note with. Each descent gets its own copy of `seenNoteIds`, so
 * it tracks the current path only: a note embedded in two sibling sub-trees is not a cycle.
 */
export function getNestedEmbedOptions(
    context: ContentEmbedContext,
    block: string | undefined
): NestedEmbedOptions {
    const seenNoteIds = new Set(context.seenNoteIds);
    return context.expandNestedEmbeds
        ? { seenNoteIds, block, expandNestedEmbeds: true }
        : { seenNoteIds, block, embedsAsReferenceLinks: true };
}

/** The `href` of the reference link an embed of a note, or of one of its blocks, becomes. */
export function getNoteEmbedHref(noteId: string, block: string | undefined) {
    return block ? `#root/${noteId}?block=${encodeBlockParameter(block)}` : `#root/${noteId}`;
}

/** The `href` of the reference link an embed of an attachment becomes. */
export function getAttachmentEmbedHref(ownerId: string, attachmentId: string) {
    return `#root/${ownerId}?viewMode=attachments&attachmentId=${attachmentId}`;
}
