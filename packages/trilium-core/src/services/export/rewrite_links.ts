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

    // Internal note links: [text](#root/.../noteId)
    content = content.replace(
        /\[([^\]]*)\]\(#root[a-zA-Z0-9_\/]*\/([a-zA-Z0-9_]+)[^)]*\)/g,
        (match, text, noteId) => {
            const url = getNoteTargetUrl(noteId, noteMeta);
            return url ? `[${text}](${url})` : match;
        }
    );

    return content;
}

function findAttachmentUrl(noteMeta: NoteMeta, attachmentId: string): string | undefined {
    return (noteMeta.attachments || [])
        .find((a) => a.attachmentId === attachmentId)
        ?.dataFileName;
}
