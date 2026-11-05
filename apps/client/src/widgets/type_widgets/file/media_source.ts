import {
    getMediaFileTitle, type LinkPreviewData, type MediaFileEmbedType, safeLinkPreviewImageSrc
} from "@triliumnext/commons";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import { getUrlForDownload } from "../../../services/open";

/**
 * The media a player plays, resolved from a file note, an attachment, or the media file at the URL
 * of a link preview.
 */
export interface MediaSource {
    /** Identifies the media across every mounted player (a noteId, an attachmentId or a URL). */
    id: string;
    title: string;
    /** The MIME type of a note or an attachment, empty for a file at a URL. */
    mime: string;
    /** Whether the player plays a video or audio. */
    kind: MediaFileEmbedType;
    /** Range-request endpoint the media element streams from. */
    streamUrl: string;
    /** Whole-file endpoint, used to decode the audio waveform. */
    fullUrl: string;
    /**
     * Whether the media is a file on another site rather than a note or an attachment. Its host
     * sends no CORS headers in general, so nothing reads its audio or its bytes besides the media
     * element, and nothing loads it before the reader plays it.
     */
    isExternal?: boolean;
    /** The picture a video shows before it plays. */
    poster?: string;
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
        kind: entity.mime.startsWith("video/") ? "video" : "audio",
        streamUrl: getUrlForDownload(`${path}/open-partial?v=${version}`),
        fullUrl: getUrlForDownload(`${path}/open?v=${version}`)
    };
}

/** The media file of `kind` at the URL of `preview`, with the thumbnail the preview stores. */
export function getExternalMediaSource(
    { url, title, image }: LinkPreviewData, kind: MediaFileEmbedType
): MediaSource {
    return {
        id: url,
        title: title || getMediaFileTitle(url),
        mime: "",
        kind,
        streamUrl: url,
        fullUrl: url,
        isExternal: true,
        poster: safeLinkPreviewImageSrc(image)
    };
}
