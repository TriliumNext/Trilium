import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";

import type FNote from "../../../entities/fnote";
import { parseImageDataUrl } from "../../../services/image_upload";
import type { SavedData } from "../../react/hooks";

/** Maps a canvas image's Excalidraw `fileId` to the attachment it is stored in. */
export interface ImageAttachmentMetadata {
    fileId: string;
    attachmentId: string;
}

/**
 * Attachment role under which both the SVG export and the canvas images are stored. Images are
 * served back via the `api/attachments/:id/image/...` endpoint, which only accepts the `image`
 * role — so they must share it with the export and are told apart by title (see below).
 */
export const IMAGE_ROLE = "image";
/** Fixed title of the SVG export attachment; canvas images are titled with their `fileId` instead. */
export const CANVAS_EXPORT_TITLE = NOTE_TYPE_IMAGE_ATTACHMENTS.canvas;

/**
 * Loads the note's image attachments (every `image`-role attachment except the SVG export) and
 * rebuilds them into Excalidraw {@link BinaryFileData}, keyed by the `fileId` stored as the
 * attachment title. The bytes are fetched from the attachment image endpoint and re-encoded as a
 * data URL, since Excalidraw renders only from inline data URLs (it has no external-URL provider).
 */
export async function loadImageAttachments(note: FNote): Promise<{ files: BinaryFileData[]; metadata: ImageAttachmentMetadata[] }> {
    const attachments = await getCanvasImageAttachments(note);

    const files: BinaryFileData[] = [];
    const metadata: ImageAttachmentMetadata[] = [];

    await Promise.all(attachments.map(async (attachment) => {
        try {
            const response = await fetch(`api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}`);
            if (!response.ok) return;

            const blob = await response.blob();
            const dataURL = await blobToDataURL(blob);
            files.push({
                id: attachment.title,
                dataURL,
                mimeType: blob.type || "image/png",
                created: Date.now()
            } as BinaryFileData);
            metadata.push({ fileId: attachment.title, attachmentId: attachment.attachmentId });
        } catch (e) {
            console.error(`Failed to load canvas image attachment '${attachment.attachmentId}'`, e);
        }
    }));

    return { files, metadata };
}

/**
 * Builds attachment payloads for canvas images not yet persisted. Each is titled with its `fileId`
 * so the server matches and updates it in place across saves (rather than duplicating). The bytes
 * are stored as exact base64 (no compression), preserving PNG transparency.
 */
export function buildNewImageAttachments(activeFiles: Record<string, BinaryFileData>, persistedFileIds: ReadonlySet<string>): NonNullable<SavedData["attachments"]> {
    const attachments: NonNullable<SavedData["attachments"]> = [];
    let position = 10;

    for (const [ fileId, file ] of Object.entries(activeFiles)) {
        if (!file || persistedFileIds.has(fileId)) continue;

        const parsed = parseImageDataUrl(file.dataURL);
        if (!parsed) continue; // not an inline data URL — nothing to upload

        attachments.push({
            role: IMAGE_ROLE,
            title: fileId,
            mime: file.mimeType,
            content: parsed.base64,
            position,
            encoding: "base64"
        });
        position += 10;
    }

    return attachments;
}

/**
 * Returns the note's `image`-role attachments that back canvas images (i.e. excluding the SVG
 * export), used to reload images on open. Orphan cleanup of removed images is handled server-side
 * (saveLinks/checkImageAttachments scanning the scene JSON), not here.
 */
async function getCanvasImageAttachments(note: FNote) {
    return (await note.getAttachmentsByRole(IMAGE_ROLE)).filter((attachment) => attachment.title !== CANVAS_EXPORT_TITLE);
}

/** Reads a blob as a base64 `data:` URL. */
function blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}
