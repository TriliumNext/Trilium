/**
 * @module
 *
 * The sound of notifications: the default one, or the custom one, a file note that the settings
 * page uploads and resets. A reset empties the note, and an empty note plays the default sound.
 */
import {
    NOTIFICATION_SOUND_MAX_BYTES, NOTIFICATION_SOUND_NOTE_ID, RESOURCES_NOTE_ID
} from "@triliumnext/commons/src/lib/notifications.js";

import defaultSoundUrl from "../assets/notification-sound.mp3?url";
import froca from "./froca.js";
import { getErrorCode, NotificationRequestError, SILENT_REFUSALS } from "./notifications.js";
import { getUrlForDownload } from "./open.js";
import server from "./server.js";

export { defaultSoundUrl };

/** The URL of the custom sound. `version`, the ID of its blob, changes the URL with the sound. */
export function getCustomSoundUrl(version?: string) {
    const query = version ? `?v=${encodeURIComponent(version)}` : "";
    return getUrlForDownload(`api/notifications/sound${query}`);
}

/** The URL of the sound that an alert plays: the custom one while one is set. */
export async function getAlertSoundUrl() {
    // Froca keeps `_resources` with its children, so a database without a custom sound costs one
    // request at the first alert and none after it.
    const resources = await froca.getNote(RESOURCES_NOTE_ID, true);
    if (!resources?.getChildNoteIds().includes(NOTIFICATION_SOUND_NOTE_ID)) {
        return defaultSoundUrl;
    }

    const blob = await (await froca.getNote(NOTIFICATION_SOUND_NOTE_ID, true))?.getBlob();
    return blob?.contentLength ? getCustomSoundUrl(blob.blobId) : defaultSoundUrl;
}

/**
 * Stores `file` as the custom sound. A file over the limit is refused here, before its upload.
 *
 * @throws NotificationRequestError with the code of a refusal.
 */
export async function uploadCustomSound(file: File) {
    if (file.size > NOTIFICATION_SOUND_MAX_BYTES) {
        throw new NotificationRequestError("too-large");
    }

    try {
        await server.upload("notifications/sound", file, undefined, "POST");
    } catch (e) {
        // `uploadForm()` rejects with the fields of the response, whose text is the code.
        const responseText = (e as { responseText?: unknown } | null)?.responseText;
        throw new NotificationRequestError(getErrorCode(responseText ?? e));
    }
}

/**
 * Empties the custom sound, so that notifications play the default sound again.
 *
 * @throws NotificationRequestError with the code of a refusal.
 */
export async function resetCustomSound() {
    try {
        await server.remove("notifications/sound", undefined, undefined, SILENT_REFUSALS);
    } catch (e) {
        throw new NotificationRequestError(getErrorCode(e));
    }
}
