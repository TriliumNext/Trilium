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

/**
 * Marks the images of the notes `noteIds` as changed, so that {@link getNoteImageSourceToLoad}
 * returns a URL the browser has not loaded yet. Within one page, the browser reuses an image it
 * loaded before for the same URL and ignores `Cache-Control: no-store`.
 */
export function invalidateNoteImages(noteIds: Iterable<string>) {
    for (const noteId of noteIds) {
        lastNoteImageVersion++;
        noteImageVersions.set(noteId, lastNoteImageVersion);
    }
}

/**
 * Returns the URL to load the image `src` from: for the image of a note that changed since the page
 * loaded, `src` with the current version in a `v` parameter, otherwise `src` itself.
 */
export function getNoteImageSourceToLoad(src: string) {
    const storedSrc = stripNoteImageVersion(src);
    const noteId = storedSrc.match(NOTE_IMAGE_URL)?.[1];
    const version = noteId ? noteImageVersions.get(noteId) : undefined;
    if (version === undefined) {
        return storedSrc;
    }

    return `${storedSrc}${storedSrc.includes("?") ? "&" : "?"}v=${version}`;
}

/** Returns `src` without the version that {@link getNoteImageSourceToLoad} adds. */
export function stripNoteImageVersion(src: string) {
    return NOTE_IMAGE_URL.test(src) ? src.replace(NOTE_IMAGE_VERSION, "") : src;
}

/** Points each note image under `container` at the URL {@link getNoteImageSourceToLoad} returns. */
export function applyNoteImageVersions(container: ParentNode) {
    for (const img of container.querySelectorAll("img")) {
        const src = img.getAttribute("src");
        if (!src) {
            continue;
        }

        const url = getNoteImageSourceToLoad(src);
        if (url !== src) {
            img.setAttribute("src", url);
        }
    }
}

const noteImageVersions = new Map<string, number>();
let lastNoteImageVersion = 0;

/** The image of a note on the API, capturing the `noteId`. */
const NOTE_IMAGE_URL = /(?:^|\/)api\/images\/(\w+)\//;
const NOTE_IMAGE_VERSION = /[?&]v=\d+$/;

/** An image of the API in an attribute of a note's HTML, naming a note or an attachment. */
const CONTENT_IMAGE_URL =
    /(src|data-image|data-favicon)="[^"]*?api\/(?:images\/(\w+)\/|attachments\/(\w+)\/image\/)[^"]*"/g;

function toQuery(query: string | undefined) {
    return query === undefined ? "" : `?${query}`;
}
