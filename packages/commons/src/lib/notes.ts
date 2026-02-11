/**
 * @module notes Common logic for notes (across front-end and back-end)
 */

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
    mindMap: "bx bx-sitemap"
};

const FILE_MIME_MAPPINGS = {
    "application/pdf": "bx bxs-file-pdf",
    "application/vnd.oasis.opendocument.text": "bx bxs-file-doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "bx bxs-file-doc",
};

const IMAGE_MIME_MAPPINGS = {
    "image/gif": "bx bxs-file-gif",
};

export function getNoteIcon({ noteId, type, mime, iconClass, workspaceIconClass, isFolder }: {
    noteId: string;
    type: NoteType;
    mime: string;
    iconClass: string | undefined;
    workspaceIconClass: string | undefined;
    isFolder: () => boolean;
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
        if (isFolder()) {
            return "bx bx-folder";
        }
        return "bx bx-note";
    } else if (type === "code") {
        const correspondingMimeType = MIME_TYPES_DICT.find(m => m.mime === mime);
        return correspondingMimeType?.icon ?? NOTE_TYPE_ICONS.code;
    } else if (type === "file") {
        return FILE_MIME_MAPPINGS[mime] ?? NOTE_TYPE_ICONS.file;
    } else if (type === "image") {
        return IMAGE_MIME_MAPPINGS[mime] ?? NOTE_TYPE_ICONS.image;
    }

    return NOTE_TYPE_ICONS[type];
}
