import { NoteMeta } from "../../meta";

const MARKDOWN_MIMES = new Set(["text/x-markdown", "text/markdown", "text/x-gfm"]);

export function isMarkdownCodeNote(mime: string | undefined): boolean {
    return !!mime && MARKDOWN_MIMES.has(mime);
}

/**
 * Rewrites Trilium-internal links in markdown content to use relative file paths
 * suitable for export. This handles code notes with markdown MIME type, where
 * the content is already in markdown format (unlike text notes which store HTML).
 *
 * Counterpart to `rewriteLinks` in `zip.ts` which handles HTML-style patterns.
 */
export function rewriteMarkdownContentLinks(
    content: string,
    noteMeta: NoteMeta,
    getNoteTargetUrl: (targetNoteId: string, sourceMeta: NoteMeta) => string | null
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

    // Attachment download links: [text](#root/...?attachmentId={id})
    // Must be matched before internal note links to avoid partial matches.
    content = content.replace(
        /\[([^\]]*)\]\([^)]*#root[^)]*attachmentId=([a-zA-Z0-9_]+)[^)]*\)/g,
        (match, text, attachmentId) => {
            const url = findAttachmentUrl(noteMeta, attachmentId);
            return url ? `[${text}](${url})` : match;
        }
    );

    // Internal note links: [text](#root/.../noteId?block=…)
    content = content.replace(
        /\[([^\]]*)\]\(#root[a-zA-Z0-9_\/]*\/([a-zA-Z0-9_]+)([^)]*)\)/g,
        (match, text, noteId, suffix) => {
            const url = getNoteTargetUrl(noteId, noteMeta);
            return url ? `[${text}](${url}${getArchivedLinkSuffix(suffix, "markdown")})` : match;
        }
    );

    return content;
}

/** Where an archived link is written: an HTML attribute, Markdown, or a page of the share theme. */
export type ArchivedLinkContext = "attribute" | "markdown" | "share";

/**
 * The part of a link to a note that an archive keeps after the note's file: its `block` and
 * `bookmark` parameters, read from `suffix`, the query and fragment that follow the note path.
 * The values stay encoded as written. In `share`, a page of the share theme, the bookmark is a
 * fragment, which the share theme reveals; elsewhere it stays in the query, which an import reads.
 */
export function getArchivedLinkSuffix(suffix: string, context: ArchivedLinkContext) {
    const text = suffix.replaceAll("&amp;", "&");
    const hashIndex = text.indexOf("#");
    const query = hashIndex < 0 ? text : text.slice(0, hashIndex);
    let bookmark = hashIndex < 0 ? "" : text.slice(hashIndex + 1);
    let block = "";
    for (const parameter of query.replace(/^\?/, "").split("&")) {
        if (parameter.startsWith("block=")) {
            block ||= parameter.slice("block=".length);
        } else if (parameter.startsWith("bookmark=")) {
            bookmark ||= parameter.slice("bookmark=".length);
        }
    }

    if (context === "share") {
        return (block ? `?block=${block}` : "") + (bookmark ? `#${bookmark}` : "");
    }
    const parameters = [ block && `block=${block}`, bookmark && `bookmark=${bookmark}` ]
        .filter(Boolean);
    const separator = context === "attribute" ? "&amp;" : "&";
    return parameters.length ? `?${parameters.join(separator)}` : "";
}

function findAttachmentUrl(noteMeta: NoteMeta, attachmentId: string): string | undefined {
    return (noteMeta.attachments || [])
        .find((a) => a.attachmentId === attachmentId)
        ?.dataFileName;
}
