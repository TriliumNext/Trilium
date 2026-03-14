import { MutableRef, useCallback, useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { getUrlForDownload } from "../../../services/open";
import Icon from "../../react/Icon";
import NoItems from "../../react/NoItems";
import { LoopButton, PlaybackSpeed, PlayPauseButton, SeekBar, SkipButton, VolumeControl } from "./MediaPlayer";

export default function AudioPreview({ note }: { note: FNote }) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [error, setError] = useState(false);
    const togglePlayback = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    }, []);
    const onKeyDown = useKeyboardShortcuts(audioRef, togglePlayback);

    useEffect(() => setError(false), [note.noteId]);
    const onError = useCallback(() => setError(true), []);

    if (error) {
        return <NoItems icon="bx bx-volume-mute" text={t("media.unsupported-format", { mime: note.mime.replace("/", "-") })} />;
    }

    return (
        <div ref={wrapperRef} className="audio-preview-wrapper" onKeyDown={onKeyDown} tabIndex={0}>
            <audio
                class="audio-preview"
                src={getUrlForDownload(`api/notes/${note.noteId}/open-partial`)}
                ref={audioRef}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={onError}
            />
            <div className="audio-preview-icon-wrapper">
                <Icon icon="bx bx-music" className="audio-preview-icon" />
            </div>
            <div className="media-preview-controls">
                <SeekBar mediaRef={audioRef} />

                <div class="media-buttons-row">
                    <div className="left">
                        <PlaybackSpeed mediaRef={audioRef} />
                    </div>

                    <div className="center">
                        <div className="spacer" />
                        <SkipButton mediaRef={audioRef} seconds={-10} icon="bx bx-rewind" text={t("media.back-10s")} />
                        <PlayPauseButton playing={playing} togglePlayback={togglePlayback} />
                        <SkipButton mediaRef={audioRef} seconds={30} icon="bx bx-fast-forward" text={t("media.forward-30s")} />
                        <LoopButton mediaRef={audioRef} />
                    </div>

                    <div className="right">
                        <VolumeControl mediaRef={audioRef} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function useKeyboardShortcuts(audioRef: MutableRef<HTMLAudioElement | null>, togglePlayback: () => void) {
    return useCallback((e: KeyboardEvent) => {
        const audio = audioRef.current;
        if (!audio) return;

        switch (e.key) {
            case " ":
                e.preventDefault();
                togglePlayback();
                break;
            case "ArrowLeft":
                e.preventDefault();
                audio.currentTime = Math.max(0, audio.currentTime - (e.ctrlKey ? 60 : 10));
                break;
            case "ArrowRight":
                e.preventDefault();
                audio.currentTime = Math.min(audio.duration, audio.currentTime + (e.ctrlKey ? 60 : 10));
                break;
            case "m":
            case "M":
                e.preventDefault();
                audio.muted = !audio.muted;
                break;
            case "ArrowUp":
                e.preventDefault();
                audio.volume = Math.min(1, audio.volume + 0.05);
                break;
            case "ArrowDown":
                e.preventDefault();
                audio.volume = Math.max(0, audio.volume - 0.05);
                break;
            case "Home":
                e.preventDefault();
                audio.currentTime = 0;
                break;
            case "End":
                e.preventDefault();
                audio.currentTime = audio.duration;
                break;
        }
    }, [ audioRef, togglePlayback ]);
}
