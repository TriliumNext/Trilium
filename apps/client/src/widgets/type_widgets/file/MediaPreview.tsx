import { useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { ViewScope } from "../../../services/link";
import AudioPreview from "./Audio";
import { loadsEagerly, type MediaEnvironment } from "./media_environment";
import { getMediaSource } from "./media_source";
import MediaProxy from "./MediaProxy";
import VideoPreview from "./Video";

interface MediaPreviewProps {
    /** The media to play: an audio/video file note, or an attachment with such a mime type. */
    entity: FNote | FAttachment;
    environment?: MediaEnvironment;
    /** The tab showing the media; only a detail view has one. Enables siblings, play mode and the OS session. */
    noteContext?: NoteContext;
    /** For an attachment: the note owning it, and the tab's view scope — together they enable sibling navigation. */
    ownerNote?: FNote;
    viewScope?: ViewScope;
    isVisible?: boolean;
}

/**
 * The single entry point for rendering audio and video, in every environment. In a lazy one (a `preview`,
 * i.e. a collection tile or an attachment list) the player is replaced by a {@link MediaProxy} placeholder
 * until the user clicks its play button — only then is a media element created, and it starts playing right
 * away. Everywhere else the player mounts immediately, ready to play.
 */
export default function MediaPreview({ entity, environment = "standalone", noteContext, ownerNote, viewScope, isVisible }: MediaPreviewProps) {
    const eager = loadsEagerly(environment);
    const [ activated, setActivated ] = useState(eager);
    const source = getMediaSource(entity);

    if (!activated) {
        return <MediaProxy source={source} onActivate={() => setActivated(true)} />;
    }

    const props = {
        entity,
        source,
        environment,
        noteContext,
        ownerNote,
        viewScope,
        isVisible,
        // We only got here from the user pressing play on the placeholder, so honour that press.
        autoPlay: !eager
    };

    return source.mime.startsWith("video/")
        ? <VideoPreview {...props} />
        : <AudioPreview {...props} />;
}
