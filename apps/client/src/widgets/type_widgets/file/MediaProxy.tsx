import "./MediaProxy.css";

import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import Icon from "../../react/Icon";
import type { MediaSource } from "./media_source";

/**
 * Stands in for the player in a lazy preview: a play button over the media's icon, or over the poster of a
 * video that has one. No media element exists until it is clicked, which is the point — a collection of
 * media notes would otherwise have every one of them streaming from the server at once, just to show a tile.
 */
export default function MediaProxy({ source, onActivate }: { source: MediaSource, onActivate: () => void }) {
    const isVideo = source.kind === "video";

    return (
        <div className={`media-proxy no-link-navigation ${source.poster ? "has-poster" : ""}`}>
            {source.poster
                ? <img className="media-proxy-poster" src={source.poster} alt="" draggable={false} />
                // Not bx-movie-play: its play glyph would double up with the button in front of it.
                : <Icon icon={isVideo ? "bx bx-movie" : "bx bx-music"} className="media-proxy-icon" />}
            <ActionButton
                className="media-proxy-play"
                icon="bx bx-play"
                text={t("media.activate", { title: source.title })}
                onClick={onActivate}
            />
        </div>
    );
}
