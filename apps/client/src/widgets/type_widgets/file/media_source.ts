import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import { getUrlForDownload } from "../../../services/open";

/** The media a player plays, resolved from either a file note or an attachment. */
export interface MediaSource {
    /** Identifies the media across every mounted player (a noteId or an attachmentId). */
    id: string;
    title: string;
    mime: string;
    /** Range-request endpoint the media element streams from. */
    streamUrl: string;
    /** Whole-file endpoint, used to decode the audio waveform. */
    fullUrl: string;
}

export function getMediaSource(entity: FNote | FAttachment): MediaSource {
    const isNote = "noteId" in entity;
    const path = isNote ? `api/notes/${entity.noteId}` : `api/attachments/${entity.attachmentId}`;
    // Replacing the media leaves its id — and so its endpoints — untouched, which would leave an open player
    // streaming what it already had. Versioning the URLs gives the element (and the waveform fetch) one they
    // haven't loaded, so the new content is picked up in place rather than by rebuilding the player around
    // them. A note carries its content hash; an attachment only exposes a modification stamp, so that one also
    // re-versions on a rename.
    const version = encodeURIComponent(isNote ? entity.blobId : entity.utcDateModified);

    return {
        id: isNote ? entity.noteId : entity.attachmentId,
        title: entity.title,
        mime: entity.mime,
        streamUrl: getUrlForDownload(`${path}/open-partial?v=${version}`),
        fullUrl: getUrlForDownload(`${path}/open?v=${version}`)
    };
}
