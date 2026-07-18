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

    return {
        id: isNote ? entity.noteId : entity.attachmentId,
        title: entity.title,
        mime: entity.mime,
        streamUrl: getUrlForDownload(`${path}/open-partial`),
        fullUrl: getUrlForDownload(`${path}/open`)
    };
}
