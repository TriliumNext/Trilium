import { LINK_TARGET_PARAMS } from "@triliumnext/commons";

import { NoteMeta } from "../../meta";

/**
 * Rewrites Trilium-internal links in markdown content to use relative file paths
 * suitable for export. This handles code notes with markdown MIME type, where
 * the content is already in markdown format (unlike text notes which store HTML).
 * `getAttachmentTargetUrl` finds the file of an attachment through its owner.
 *
 * Counterpart to `rewriteLinks` in `zip.ts` which handles HTML-style patterns.
 */
export function rewriteMarkdownContentLinks(
    content: string,
    noteMeta: NoteMeta,
    getNoteTargetUrl: (targetNoteId: string, sourceMeta: NoteMeta) => string | null,
    getAttachmentTargetUrl: (
        ownerId: string, attachmentId: string, sourceMeta: NoteMeta
    ) => string | null
): string {
    // Attachment images: ![alt](api/attachments/{id}/image/{filename})
    content = content.replace(
        /!\[([^\]]*)\]\([^)]*?api\/attachments\/([a-zA-Z0-9_]+)\/image\/[^)]*\)/g,
        (match, alt, attachmentId) => {
            const url = findAttachmentUrl(noteMeta, attachmentId);
            return url ? `![${alt}](${url})` : match;
        }
    );

    // Image notes: ![alt](api/images/{id}/{filename})
    content = content.replace(
        /!\[([^\]]*)\]\([^)]*?api\/images\/([a-zA-Z0-9_]+)\/[^)]*\)/g,
        (match, alt, noteId) => {
            const url = getNoteTargetUrl(noteId, noteMeta);
            return url ? `![${alt}](${url})` : match;
        }
    );

    // Links to notes and to attachments: [text](#root/.../noteId?block=…). The last note of the
    // path of a link to an attachment is the owner of the attachment.
    content = content.replace(
        /\[([^\]]*)\]\(#root[a-zA-Z0-9_\/]*\/([a-zA-Z0-9_]+)([^)]*)\)/g,
        (match, text, noteId, suffix) => {
            const attachmentId = getLinkAttachmentId(suffix);
            const url = attachmentId
                ? getAttachmentTargetUrl(noteId, attachmentId, noteMeta)
                : getNoteTargetUrl(noteId, noteMeta);
            return url ? `[${text}](${url}${getArchivedLinkSuffix(suffix, "markdown")})` : match;
        }
    );

    return content;
}

/** Where an archived link is written: an HTML attribute or Markdown. */
export type ArchivedLinkContext = "attribute" | "markdown";

/** The separator between the parameters of a query, in each context. */
const QUERY_SEPARATORS: Record<ArchivedLinkContext, string> = { attribute: "&amp;", markdown: "&" };

/**
 * The query an archive writes after the file of a link: the `LINK_TARGET_PARAMS` of `suffix`, in
 * order and as written.
 */
export function getArchivedLinkSuffix(suffix: string, context: ArchivedLinkContext) {
    const parameters = Array.from(readLinkTargetValues(suffix),
        ([ name, value ]) => `${name}=${value}`);
    return parameters.length ? `?${parameters.join(QUERY_SEPARATORS[context])}` : "";
}

/**
 * The `LINK_TARGET_PARAMS` of `suffix` as {@link getArchivedLinkSuffix} reads them, each after the
 * separator of `context`, to append to a query that has begun.
 */
export function getLinkTargetParameters(suffix: string, context: ArchivedLinkContext) {
    return Array.from(readLinkTargetValues(suffix),
        ([ name, value ]) => `${QUERY_SEPARATORS[context]}${name}=${value}`).join("");
}

/** The attachment that `suffix`, the query of a link, names with `attachmentId`. */
export function getLinkAttachmentId(suffix: string) {
    return /[?&]attachmentId=([a-zA-Z0-9_]+)/.exec(suffix.replaceAll("&amp;", "&"))?.[1];
}

/**
 * The `LINK_TARGET_PARAMS` of `suffix` by name, in their order: the first value of each that is
 * not empty, where the fragment is the first value of the bookmark.
 */
function readLinkTargetValues(suffix: string) {
    const text = suffix.replaceAll("&amp;", "&");
    const hashIndex = text.indexOf("#");
    const query = hashIndex < 0 ? text : text.slice(0, hashIndex);
    const written = new Map([ [ "bookmark", hashIndex < 0 ? "" : text.slice(hashIndex + 1) ] ]);
    for (const parameter of query.replace(/^\?/, "").split("&")) {
        const separatorIndex = parameter.indexOf("=");
        const name = parameter.slice(0, separatorIndex);
        if (separatorIndex > 0 && !written.get(name)) {
            written.set(name, parameter.slice(separatorIndex + 1));
        }
    }

    const values = new Map<string, string>();
    for (const name of LINK_TARGET_PARAMS) {
        const value = written.get(name);
        if (value) {
            values.set(name, value);
        }
    }
    return values;
}

function findAttachmentUrl(noteMeta: NoteMeta, attachmentId: string): string | undefined {
    return (noteMeta.attachments || [])
        .find((a) => a.attachmentId === attachmentId)
        ?.dataFileName;
}
