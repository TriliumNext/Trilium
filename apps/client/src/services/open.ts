import Component from "../components/component.js";
import FNote from "../entities/fnote.js";
import options from "./options.js";
import server from "./server.js";
import utils from "./utils.js";


interface TmpResponse {
    tmpFilePath: string;
}

export function checkType(type: string) {
    if (type !== "notes" && type !== "attachments") {
        throw new Error(`Unrecognized type '${type}', should be 'notes' or 'attachments'`);
    }
}

function getFileUrl(type: string, noteId?: string) {
    checkType(type);

    return getUrlForDownload(`api/${type}/${noteId}/download`);
}

function getOpenFileUrl(type: string, noteId: string) {
    checkType(type);

    return getUrlForDownload(`api/${type}/${noteId}/open`);
}

function download(url: string) {
    if (window.electronApi) {
        window.electronApi.shell.downloadURL(url);
    } else {
        window.location.href = url;
    }
}

export function downloadFileNote(note: FNote, parentComponent: Component | null, ntxId: string | null | undefined) {
    if (parentComponent && (
        (note.type === "file" && note.mime === "application/pdf")
        || note.noteId === "_backendLog"
    )) {
        // Special handling, manages its own downloading process.
        parentComponent.triggerEvent("customDownload", { ntxId });
        return;
    }

    const url = `${getFileUrl("notes", note.noteId)}?${Date.now()}`; // don't use cache
    download(url);
}

function downloadAttachment(attachmentId: string) {
    const url = `${getFileUrl("attachments", attachmentId)}?${Date.now()}`; // don't use cache

    download(url);
}

async function openCustom(type: string, entityId: string, mime: string) {
    checkType(type);
    if (!window.electronApi || utils.isMac()) {
        return;
    }

    const resp = await server.post<TmpResponse>(`${type}/${entityId}/save-to-tmp-dir`);
    window.electronApi.shell.openCustom(resp.tmpFilePath);
}

const openNoteCustom = async (noteId: string, mime: string) => await openCustom("notes", noteId, mime);
const openAttachmentCustom = async (attachmentId: string, mime: string) => await openCustom("attachments", attachmentId, mime);

function downloadRevision(noteId: string, revisionId: string) {
    const url = getUrlForDownload(`api/revisions/${revisionId}/download`);

    download(url);
}

/**
 * @param url - should be without initial slash!!!
 */
export function getUrlForDownload(url: string) {
    if (utils.isElectron()) {
        // electron needs absolute URL, so we extract current host, port, protocol
        return `${getHost()}/${url}`;
    }
    // web server can be deployed on subdomain, so we need to use a relative path
    return url;

}

function canOpenInBrowser(mime: string) {
    return mime === "application/pdf" || mime.startsWith("image") || mime.startsWith("audio") || mime.startsWith("video");
}

async function openExternally(type: string, entityId: string, mime: string) {
    checkType(type);

    if (utils.isElectron()) {
        const resp = await server.post<TmpResponse>(`${type}/${entityId}/save-to-tmp-dir`);

        const res = await window.electronApi?.shell.openPath(resp.tmpFilePath);

        if (res) {
            // fallback in case there's no default application for this file
            window.open(getFileUrl(type, entityId));
        }
    } else {
        // allow browser to handle opening common file
        if (canOpenInBrowser(mime)) {
            window.open(getOpenFileUrl(type, entityId));
        } else {
            window.location.href = getFileUrl(type, entityId);
        }
    }
}

export const openNoteExternally = async (noteId: string, mime: string) => await openExternally("notes", noteId, mime);
const openAttachmentExternally = async (attachmentId: string, mime: string) => await openExternally("attachments", attachmentId, mime);

function getHost() {
    const url = new URL(window.location.href);
    return `${url.protocol}//${url.hostname}:${url.port}`;
}

async function openNoteOnServer(noteId: string) {
    // Get the sync server host from options
    const syncServerHost = options.get("syncServerHost");

    if (!syncServerHost) {
        console.error("No sync server host configured");
        return;
    }

    const url = new URL(`#root/${noteId}`, syncServerHost).toString();

    // Use window.open to ensure link opens in external browser in Electron
    window.open(url, '_blank', 'noopener,noreferrer');
}

async function openDirectory(directory: string) {
    try {
        if (utils.isElectron()) {
            const res = await window.electronApi?.shell.openPath(directory);
            if (res) {
                console.error("Failed to open directory:", res);
            }
        } else {
            console.error("Not running in an Electron environment.");
        }
    } catch (err: any) {
        // Handle file system errors (e.g. path does not exist or is inaccessible)
        console.error("Error:", err.message);
    }
}

export default {
    download,
    downloadFileNote,
    downloadRevision,
    downloadAttachment,
    getUrlForDownload,
    openNoteExternally,
    openAttachmentExternally,
    openNoteCustom,
    openAttachmentCustom,
    openNoteOnServer,
    openDirectory
};
