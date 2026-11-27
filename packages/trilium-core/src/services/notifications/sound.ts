/**
 * @module
 *
 * The custom sound of notifications: the file note `_notificationSound` under `_resources`, which
 * the first upload creates. A reset empties the note, and an empty note plays the default sound.
 * Like `store.ts`, this module reads Becca.
 */
import {
    NOTIFICATION_SOUND_MAX_BYTES, NOTIFICATION_SOUND_NOTE_ID, RESOURCES_NOTE_ID
} from "@triliumnext/commons";
import { t } from "i18next";

import becca from "../../becca/becca.js";
import noteService from "../notes.js";
import { wrapStringOrBuffer } from "../utils/binary.js";
import { NotificationError } from "./model.js";

/** The MIME types of the three formats that a custom sound can have. */
export type NotificationSoundMime = "audio/mpeg" | "audio/ogg" | "audio/wav";

/** A stored custom sound, with the MIME type that its first bytes name. */
export interface CustomSound {
    content: Uint8Array;
    mime: NotificationSoundMime;
    blobId: string;
    fileName: string;
}

/**
 * Stores `content` as the custom sound, under the MIME type that its first bytes name: the type
 * that the upload declares is never read.
 *
 * @throws NotificationError `too-large` over 1 MiB, `unsupported-format` for a file that is not
 *         MP3, OGG or WAV.
 */
export function saveCustomSound(content: string | Uint8Array) {
    const bytes = wrapStringOrBuffer(content);
    if (bytes.length > NOTIFICATION_SOUND_MAX_BYTES) {
        throw new NotificationError("too-large");
    }
    const mime = detectSoundMime(bytes);
    if (!mime) {
        throw new NotificationError("unsupported-format");
    }

    const note = becca.getNote(NOTIFICATION_SOUND_NOTE_ID);
    if (!note) {
        noteService.createNewNote({
            noteId: NOTIFICATION_SOUND_NOTE_ID,
            parentNoteId: RESOURCES_NOTE_ID,
            title: t("hidden-subtree.notification-sound-title"),
            type: "file",
            mime,
            content: bytes
        });
        return;
    }

    note.type = "file";
    note.mime = mime;
    note.save();
    note.setContent(bytes);
}

/** Empties the custom sound, so that notifications play the default sound again. */
export function resetCustomSound() {
    becca.getNote(NOTIFICATION_SOUND_NOTE_ID)?.setContent(new Uint8Array(0));
}

/**
 * The custom sound, when one is stored, readable and still one of the three formats. A peer or the
 * note's own editor can write anything into the note, so the format is read again from its bytes.
 */
export function readCustomSound(): CustomSound | null {
    const note = becca.getNote(NOTIFICATION_SOUND_NOTE_ID);
    if (!note?.isContentAvailable()) {
        return null;
    }

    let content: Uint8Array;
    try {
        content = wrapStringOrBuffer(note.getContent());
    } catch {
        // A blob that sync has not brought yet, or a damaged database.
        return null;
    }
    const mime = detectSoundMime(content);
    return mime ? { content, mime, blobId: note.blobId ?? "", fileName: note.getFileName() } : null;
}

/** The MIME type of a sound by its first bytes, or `null` for a file not MP3, OGG or WAV. */
export function detectSoundMime(bytes: Uint8Array): NotificationSoundMime | null {
    // "OggS" and the stream structure version 0.
    if (hasTextAt(bytes, 0, "OggS") && bytes[4] === 0) {
        return "audio/ogg";
    }
    if (hasTextAt(bytes, 0, "RIFF") && hasTextAt(bytes, 8, "WAVE")) {
        return "audio/wav";
    }
    if (isId3Header(bytes) || isMp3FrameHeader(bytes)) {
        return "audio/mpeg";
    }
    return null;
}

/** An ID3v2 tag, which opens most MP3 files: "ID3", a version of 2 to 4 and a syncsafe size. */
function isId3Header(bytes: Uint8Array) {
    return bytes.length >= 10 && hasTextAt(bytes, 0, "ID3")
        && bytes[3] >= 2 && bytes[3] <= 4 && bytes[4] !== 0xff
        && bytes.subarray(6, 10).every((byte) => byte < 0x80);
}

/** The header of an MPEG-1, MPEG-2 or MPEG-2.5 Layer III frame, which opens an untagged MP3. */
function isMp3FrameHeader(bytes: Uint8Array) {
    if (bytes.length < 4 || bytes[0] !== 0xff) {
        return false;
    }
    // Eleven sync bits, then the version (01 is reserved) and the layer (01 is Layer III).
    const isLayer3 = (bytes[1] & 0xe6) === 0xe2;
    const isVersionReserved = (bytes[1] & 0x18) === 0x08;
    const isBitrateInvalid = (bytes[2] & 0xf0) === 0xf0;
    const isSampleRateReserved = (bytes[2] & 0x0c) === 0x0c;
    return isLayer3 && !isVersionReserved && !isBitrateInvalid && !isSampleRateReserved;
}

function hasTextAt(bytes: Uint8Array, offset: number, text: string) {
    return [ ...text ].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}
