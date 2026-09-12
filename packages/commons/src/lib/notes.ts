/**
 * @module notes Common logic for notes (across front-end and back-end)
 */

import { isFontMimeType } from "./font_mimes.js";
import { MIME_TYPES_DICT } from "./mime_type.js";
import { NoteType } from "./rows.js";

export const NOTE_TYPE_ICONS = {
    file: "bx bx-file",
    image: "bx bx-image",
    code: "bx bx-code",
    render: "bx bx-extension",
    search: "bx bx-file-find",
    relationMap: "bx bxs-network-chart",
    book: "bx bx-book",
    noteMap: "bx bxs-network-chart",
    mermaid: "bx bx-selection",
    canvas: "bx bx-pen",
    webView: "bx bx-globe-alt",
    launcher: "bx bx-link",
    doc: "bx bxs-file-doc",
    contentWidget: "bx bxs-widget",
    mindMap: "bx bx-sitemap",
    spreadsheet: "bx bx-table",
    llmChat: "bx bx-message-square-dots"
};

/**
 * Note types that can be embedded as an image but are not images themselves, mapped to the title of
 * the attachment holding their rendered picture. The type widgets write these attachments, the
 * `api/images/<noteId>` routes serve them in place of the note's own content, the ZIP export writes
 * them out beside the note and the importer resolves them back, and note orphan-erasure exempts
 * them. Everything keys off this one table so those five places cannot drift apart.
 */
export const NOTE_TYPE_IMAGE_ATTACHMENTS = {
    canvas: "canvas-export.svg",
    mermaid: "mermaid-export.svg",
    mindMap: "mindmap-export.svg",
    spreadsheet: "spreadsheet-export.png"
} as const satisfies Partial<Record<NoteType, string>>;

/**
 * The title of the attachment holding the rendered image of the given note type, or `undefined` if
 * notes of that type carry their image as content and are served directly.
 *
 * Prefer indexing {@link NOTE_TYPE_IMAGE_ATTACHMENTS} directly when the note type is known
 * statically — it narrows to the exact title instead of `string | undefined`.
 */
export function getImageAttachmentTitle(type: NoteType | null | undefined): string | undefined {
    if (!type) {
        return undefined;
    }

    return (NOTE_TYPE_IMAGE_ATTACHMENTS as Partial<Record<NoteType, string>>)[type];
}

/**
 * The note a mind map node's link points at, or `null` where it points somewhere else entirely.
 *
 * A node carries one link of its own — Mind Elixir's `hyperLink` — which the editor writes as the
 * in-app address a note link wears everywhere else in Trilium, so that following it is answered by
 * the delegated link handler with nothing else to wire up. The whole value has to be that address:
 * a page whose own address happens to carry `#root/…` is a page, not a link between notes.
 *
 * Shared, so that what writes a link, what follows one, and what relates the two notes to each
 * other all agree on what a link is.
 */
export function parseMindMapNoteLink(link: unknown): { notePath: string; noteId: string } | null {
    if (typeof link !== "string" || !/^#root(\/[a-zA-Z0-9_]+)*$/.test(link)) {
        return null;
    }

    const notePath = link.slice(1);
    const segments = notePath.split("/");
    return {
        notePath,
        noteId: segments[segments.length - 1]
    };
}

const FILE_MIME_MAPPINGS: Record<string, string> = {
    "application/pdf": "bx bxs-file-pdf",
    "application/vnd.oasis.opendocument.text": "bx bxs-file-doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "bx bxs-file-doc",
    "application/gpx+xml": "bx bx-trip",
    // Workbooks kept as file notes or attachments, which `convertOfficeToHtml` previews as a grid.
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "bx bx-spreadsheet",
    "application/vnd.oasis.opendocument.spreadsheet": "bx bx-spreadsheet",
    "application/vnd.ms-excel": "bx bx-spreadsheet",
    "text/csv": "bx bx-spreadsheet",
};

const IMAGE_MIME_MAPPINGS: Record<string, string> = {
    "image/gif": "bx bxs-file-gif",
};

/** The label a note carries to stand on a geo map, read by {@link getNoteIcon}. */
export const GEO_LOCATION_ATTRIBUTE = "geolocation";

/** The icon a note on a geo map is drawn under where it has none of its own. */
export const GEO_MARKER_ICON = "bx bx-pin";

/**
 * The icon a note is drawn under: its own `#iconClass` where it has one, and a default read off
 * what the note is otherwise.
 *
 * A note carrying a non-empty `#geolocation` is drawn as a pin where it has nothing more specific,
 * so the geo map writes no `#iconClass` onto a marker it creates and an icon the map hands down
 * through `#child:iconClass` or a template still applies. `iconClass` stays an argument rather than
 * being read here because the share tree narrows it to the prefixes an icon pack supplies.
 */
export function getNoteIcon({
    noteId, type, mime, iconClass, workspaceIconClass, isFolder, getLabelValue
}: {
    noteId: string;
    type: NoteType;
    mime: string;
    iconClass: string | undefined;
    workspaceIconClass: string | undefined;
    isFolder: () => boolean;
    /** One of the note's labels, inherited ones included, as every note entity resolves them. */
    getLabelValue: (name: string) => string | null;
}) {
    if (iconClass) {
        return iconClass;
    } else if (workspaceIconClass) {
        return workspaceIconClass;
    } else if (noteId === "root") {
        return "bx bx-home-alt-2";
    }
    if (noteId === "_share") {
        return "bx bx-share-alt";
    } else if (type === "text") {
        // A location is written onto a note deliberately, so it outranks the folder icon the note
        // picks up from having children.
        if (getLabelValue(GEO_LOCATION_ATTRIBUTE)) {
            return GEO_MARKER_ICON;
        }
        if (isFolder()) {
            return "bx bx-folder";
        }
        return "bx bx-note";
    } else if (type === "code") {
        const correspondingMimeType = MIME_TYPES_DICT.find(m => m.mime === mime);
        return correspondingMimeType?.icon ?? NOTE_TYPE_ICONS.code;
    } else if (type === "file") {
        return getFileMimeIcon(mime);
    } else if (type === "image") {
        return getImageMimeIcon(mime);
    }

    return NOTE_TYPE_ICONS[type];
}

/**
 * The icon for something known only by its media type — an attachment, or anything else the app holds
 * that is not a note and so has no type to ask about.
 *
 * A note of the same content gets the same icon, which is the point of routing both through here: a PDF
 * is a PDF whether it was uploaded as a note or attached to one.
 */
export function getMimeIcon(mime: string | undefined | null): string {
    if (!mime) {
        return NOTE_TYPE_ICONS.file;
    }

    return mime.startsWith("image/") ? getImageMimeIcon(mime) : getFileMimeIcon(mime);
}

function getFileMimeIcon(mime: string): string {
    if (mime.startsWith("video/")) return "bx bx-video";
    if (mime.startsWith("audio/")) return "bx bx-music";
    if (isFontMimeType(mime)) return "bx bx-font";
    return lookUpMime(FILE_MIME_MAPPINGS, mime) ?? NOTE_TYPE_ICONS.file;
}

function getImageMimeIcon(mime: string): string {
    return lookUpMime(IMAGE_MIME_MAPPINGS, mime) ?? NOTE_TYPE_ICONS.image;
}

/**
 * `hasOwn` rather than a plain lookup: the media type is whatever was stored, so `"constructor"` reaches
 * these tables, and reading it off one would answer with something from its prototype — a function, which
 * survives the `??` and is handed on as an icon class.
 */
function lookUpMime(mappings: Record<string, string>, mime: string): string | undefined {
    return Object.hasOwn(mappings, mime) ? mappings[mime] : undefined;
}
