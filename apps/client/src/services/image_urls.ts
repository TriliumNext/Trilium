/** What an image URL points at: the image of a note, or an image attachment. */
export type ImageTarget = { noteId: string } | { attachmentId: string };

/** Finds the URL of an image somewhere other than the API, or returns `null` to keep the API's. */
export type ImageUrlResolver = (target: ImageTarget) => string | null;

let resolveImageUrl: ImageUrlResolver | undefined;

/**
 * Sets where the views find images, which only a page hosting them outside the app knows, such as
 * a page of the static export, which holds the images as files.
 */
export function setImageUrlResolver(resolver: ImageUrlResolver | undefined) {
    resolveImageUrl = resolver;
}

/**
 * Returns the URL of the image of the note `noteId`, titled `title`: `api/images/<noteId>/<title>`
 * with `query`, which keeps a browser from showing a cached copy, unless the resolver has another.
 */
export function getNoteImageUrl(noteId: string, title: string, query?: string) {
    return resolveImageUrl?.({ noteId })
        ?? `api/images/${noteId}/${encodeURIComponent(title)}${toQuery(query)}`;
}

/**
 * Returns the URL of the image attachment `attachmentId`, titled `title`:
 * `api/attachments/<attachmentId>/image/<title>` with `query`, unless the resolver has another.
 */
export function getAttachmentImageUrl(attachmentId: string, title: string, query?: string) {
    return resolveImageUrl?.({ attachmentId })
        ?? `api/attachments/${attachmentId}/image/${encodeURIComponent(title)}${toQuery(query)}`;
}

/**
 * Points the images a note's HTML embeds from the API, in `src` and in a link preview's
 * `data-image` and `data-favicon`, where the resolver finds them. Runs on the HTML before it is
 * parsed into the page, which loads an image as soon as it parses its element.
 */
export function resolveContentImageUrls(html: string) {
    if (!resolveImageUrl) {
        return html;
    }

    return html.replace(CONTENT_IMAGE_URL, (match, attribute: string, noteId?: string,
        attachmentId?: string) => {
        const target = noteId ? { noteId } : { attachmentId: attachmentId ?? "" };
        const url = resolveImageUrl?.(target);
        return url ? `${attribute}="${url}"` : match;
    });
}

/** An image of the API in an attribute of a note's HTML, naming a note or an attachment. */
const CONTENT_IMAGE_URL =
    /(src|data-image|data-favicon)="[^"]*?api\/(?:images\/(\w+)\/|attachments\/(\w+)\/image\/)[^"]*"/g;

function toQuery(query: string | undefined) {
    return query === undefined ? "" : `?${query}`;
}
