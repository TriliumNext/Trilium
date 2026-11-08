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

/**
 * What an `.include-note` element stands for, whether it links to the content because of where it
 * sits (see {@link isEmbedShownAsLink} for its box size), and its box size as the editor reads it.
 */
export type ContentEmbed =
    | { kind: "attachment"; attachmentId: string; asLink: boolean; boxSize: BoxSize | null }
    | {
        kind: "note";
        noteId: string;
        block: string | undefined;
        asLink: boolean;
        boxSize: BoxSize | null;
    };

/**
 * The box sizes of an embed: Compact shows a row, Resizable a box of any size, Full the whole
 * content and Expandable the title until it is expanded.
 */
export const BOX_SIZES = [ "compact", "resizable", "full", "expandable" ] as const;

export type BoxSize = typeof BOX_SIZES[number];

/**
 * The box sizes of an embed that keeps its source in the note, such as a Mermaid diagram, which
 * has no title for Compact and Expandable to show.
 */
export const INLINE_BOX_SIZES: readonly BoxSize[] = [ "resizable", "full" ];

/** The CSS custom property that saves the height an embed was resized to, in `em`. */
export const EMBED_HEIGHT_PROPERTY = "--include-note-height";

/**
 * The box sizes that versions before 0.107 saved: the size each one reads as now and, for a box
 * of a set height, that height, which the embed takes unless it saved a height of its own.
 */
const LEGACY_BOX_SIZES: Record<string, { boxSize: BoxSize; height: string | null }> = {
    tiny: { boxSize: "compact", height: null },
    small: { boxSize: "resizable", height: "10em" },
    medium: { boxSize: "resizable", height: "20em" }
};

/** An element with the attributes of an embed, in the browser or in a parsed document. */
export interface EmbedBoxElement {
    getAttribute(name: string): string | null | undefined;
    setAttribute(name: string, value: string): void;
}

/**
 * The box size that a saved `data-box-size` reads as, among the sizes `allowed` for the embed,
 * and the height an older size implied, `null` for a current size. A missing size, an unknown
 * one and one the embed cannot take read as `fallback`.
 */
export function readBoxSize(
    saved: string | null | undefined,
    allowed: readonly BoxSize[],
    fallback: BoxSize
): { boxSize: BoxSize; height: string | null } {
    const current = allowed.find((size) => size === saved);
    if (current) {
        return { boxSize: current, height: null };
    }
    const legacy = saved ? LEGACY_BOX_SIZES[saved] : undefined;
    return legacy && allowed.includes(legacy.boxSize)
        ? legacy
        : { boxSize: fallback, height: null };
}

/**
 * Rewrites the box size of an `.include-note` saved by an older version as the size it reads as,
 * with the height that size had unless the embed saved one, so that a stylesheet knows only the
 * current sizes. Returns the `data-box-size` the element has afterwards.
 */
export function normalizeEmbedBox(element: EmbedBoxElement): string | null {
    const saved = element.getAttribute("data-box-size") ?? null;
    const legacy = saved ? LEGACY_BOX_SIZES[saved] : undefined;
    if (!legacy) {
        return saved;
    }

    element.setAttribute("data-box-size", legacy.boxSize);
    const style = element.getAttribute("style")?.trim().replace(/;$/, "") ?? "";
    if (legacy.height && !style.includes(EMBED_HEIGHT_PROPERTY)) {
        const declaration = `${EMBED_HEIGHT_PROPERTY}:${legacy.height}`;
        element.setAttribute("style", style ? `${style};${declaration}` : declaration);
    }
    return legacy.boxSize;
}

/**
 * Whether a Compact embed of content of `contentType` renders the content: audio plays in a row
 * of controls. Any other content shows its title row only, and links to the content wherever the
 * row cannot be shown.
 */
export function hasCompactContent(contentType: string) {
    return contentType === "audio";
}

/**
 * Whether `embed` becomes a reference link to content of `contentType` rather than showing it:
 * where it sits asks for a link, or it is Compact and its content shows nothing in Compact.
 */
export function isEmbedShownAsLink(embed: ContentEmbed, contentType: string) {
    return embed.asLink || (embed.boxSize === "compact" && !hasCompactContent(contentType));
}

/** The options the content an embed shows is rendered with. */
export interface NestedEmbedOptions {
    seenNoteIds: Set<string>;
    block: string | undefined;
    expandNestedEmbeds?: true;
    embedsAsReferenceLinks?: true;
}

/**
 * The class of the `<pre>` of an extended code block: a code block of the text note shown in an
 * embed with the code editor, saved as `<pre><code class="language-…">`.
 */
export const EXTENDED_CODE_BLOCK_CLASS = "extended-code-block";

/** The language of an extended code block that names none, as a CKEditor code block language. */
export const EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE = "text-plain";

/** The class of the embed box of media from a URL, in the editor and in read-only views. */
export const MEDIA_EMBED_CLASS = "media-embed";

/** The class of the box of a media embed that plays a video, which takes the shape of the video. */
export const VIDEO_EMBED_CLASS = "video-embed";

/** The class of the box of a media embed that plays an audio file. */
export const AUDIO_EMBED_CLASS = "audio-embed";

/** The classes of the box of a media embed that plays a video, or an audio file if `isAudio`. */
export function getMediaEmbedClasses(isAudio: boolean) {
    return [ MEDIA_EMBED_CLASS, isAudio ? AUDIO_EMBED_CLASS : VIDEO_EMBED_CLASS ];
}

/**
 * The class of the `<figure>` that holds an embed saved as an element other than a `<figure>`,
 * such as the `<section>` of a video, and its `<figcaption>`. An embed without a caption is saved
 * without it.
 */
export const CAPTIONED_CONTENT_EMBED_CLASS = "captioned-content-embed";

/**
 * The attribute that marks a `<section>` as a content embed and names its kind, for kinds added
 * after include notes and source embeds. A version that does not know the kind keeps the section
 * unchanged: its `class` and `data-*` attributes, and its content as a fallback for readers.
 * A kind refers to a note with `data-note-id` on the section, and to an attachment with
 * `data-attachment-id` on any element, so that older versions keep the backlink and the
 * attachment.
 */
export const CONTENT_EMBED_KIND_ATTRIBUTE = "data-trilium-embed";

const ENTITY_ID = /^[a-zA-Z0-9_]+$/;

/** The key of an embed in `seenNoteIds`. A note can embed blocks of itself. */
export function getEmbedKey(noteId: string, block: string | null | undefined) {
    return block ? `${noteId}:${block}` : noteId;
}

/**
 * Reads an `.include-note` element and decides what it becomes, or `null` when it names nothing
 * valid. The IDs come from note HTML, so only an ID of the shape Trilium generates gets through.
 *
 * It becomes a link to what it shows rather than the content itself when the content around it is
 * itself an embed below the first level and, for a note, when the note is already being rendered
 * on the path to it, which would otherwise never end. Whether its box size links as well depends
 * on the content, which {@link isEmbedShownAsLink} decides once the content is known.
 */
export function resolveContentEmbed(
    getAttribute: (name: string) => string | null | undefined,
    context: ContentEmbedContext
): ContentEmbed | null {
    const asLink = !!context.embedsAsReferenceLinks;
    const saved = getAttribute("data-box-size");
    const boxSize = saved ? readBoxSize(saved, BOX_SIZES, "resizable").boxSize : null;

    const attachmentId = getAttribute("data-attachment-id");
    if (attachmentId) {
        return ENTITY_ID.test(attachmentId)
            ? { kind: "attachment", attachmentId, asLink, boxSize }
            : null;
    }

    const noteId = getAttribute("data-note-id");
    if (!noteId || !ENTITY_ID.test(noteId)) {
        return null;
    }

    const block = getAttribute("data-block") || undefined;
    const isCycle = context.seenNoteIds.has(getEmbedKey(noteId, block));
    return { kind: "note", noteId, block, asLink: asLink || isCycle, boxSize };
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
