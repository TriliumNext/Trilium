import { MutableRef, useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import Icon from "../../react/Icon";
import NoItems from "../../react/NoItems";
import { loadWaveform } from "./audio_waveform";
import { AudioVisualizer } from "./AudioVisualizer";
import MediaFileActions from "./MediaFileActions";
import { playerRootClasses, preloadFor, showsFileActions, usesCompactControls } from "./media_environment";
import { MediaPlayerProps, MediaSiblingButton, PlaybackSpeed, PlayModeButton, PlayPauseButton, SkipButton, useMediaPlayMode, useMediaSessionController, VolumeControl } from "./MediaPlayer";
import { WaveformSeekBar } from "./WaveformSeekBar";

export default function AudioPreview({ source, entity, environment, noteContext, isVisible = true, autoPlay }: MediaPlayerProps) {
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

    useEffect(() => {
        setError(false);
        // The player instance is reused across notes (just a new src), which stops playback but doesn't
        // reliably fire "pause" — reset so the controls don't keep showing the previous note's playing state.
        setPlaying(false);
    }, [source.id]);
    const onError = useCallback(() => setError(true), []);
    // Mirror the element's real play state on every transition: "pause" isn't fired reliably when a track
    // ends or its src is swapped, so derive from `paused` rather than assuming play→true / pause→false.
    const syncPlaying = useCallback(() => setPlaying(!!audioRef.current && !audioRef.current.paused), []);
    const { mode: playMode, setMode: setPlayMode } = useMediaPlayMode(noteContext, audioRef);
    const siblingNavigation = useMediaSessionController({ source, entity, environment, noteContext, isVisible, autoPlay, mimePrefix: "audio/", mediaRef: audioRef, playMode });
    const waveformPeaks = useWaveformPeaks(source.fullUrl);

    if (error) {
        return <NoItems icon="bx bx-volume-mute" text={t("media.unsupported-format", { mime: source.mime.replace("/", "-") })} />;
    }

    const compact = usesCompactControls(environment);

    return (
        <div ref={wrapperRef} className={`audio-preview-wrapper ${playerRootClasses(environment)}`} onKeyDown={onKeyDown} tabIndex={0}>
            <audio
                class="audio-preview"
                src={source.streamUrl}
                preload={preloadFor(environment)}
                ref={audioRef}
                onPlay={syncPlaying}
                onPause={syncPlaying}
                onEnded={syncPlaying}
                onEmptied={syncPlaying}
                onError={onError}
            />
            <div className="audio-preview-visualization-wrapper">
                <AudioVisualizer mediaRef={audioRef} isPlaying={playing} compact={compact} />
                {/* The compact player gives the whole band to the visualizer instead. */}
                {!compact && <Icon icon="bx bx-music" className="audio-preview-icon" />}
            </div>
            <div className="media-preview-controls">
                {compact ? (
                    <div class="media-compact-row">
                        <PlayPauseButton playing={playing} togglePlayback={togglePlayback} />
                        <WaveformSeekBar mediaRef={audioRef} peaks={waveformPeaks} />
                        <VolumeControl mediaRef={audioRef} />
                        {showsFileActions(environment) && <MediaFileActions entity={entity} />}
                    </div>
                ) : (
                    <>
                        <WaveformSeekBar mediaRef={audioRef} peaks={waveformPeaks} />

                        <div class="media-buttons-row">
                            <div className="left">
                                <PlaybackSpeed mediaRef={audioRef} />
                                {/* The play mode lives on the parent folder, which only the note detail knows. */}
                                {noteContext && <PlayModeButton mode={playMode} onSelectMode={setPlayMode} />}
                            </div>

                            <div className="center">
                                <div className="spacer" />
                                <MediaSiblingButton navigation={siblingNavigation} direction="previous" tooltipI18nKey="media.previous-audio" />
                                <SkipButton mediaRef={audioRef} seconds={-10} icon="bx bx-rewind" text={t("media.back-10s")} />
                                <PlayPauseButton playing={playing} togglePlayback={togglePlayback} />
                                <SkipButton mediaRef={audioRef} seconds={10} icon="bx bx-fast-forward" text={t("media.forward-10s")} />
                                <MediaSiblingButton navigation={siblingNavigation} direction="next" tooltipI18nKey="media.next-audio" />
                            </div>

                            <div className="right">
                                <VolumeControl mediaRef={audioRef} />
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

/** Decode the audio into a normalized waveform for the seek bar. Returns `null` while loading or when no
 *  waveform is available (oversized/undecodable file); the seek bar then falls back to a plain track. The fetch
 *  is aborted when the media changes so a slow decode for a previous one can't paint over the current one. */
function useWaveformPeaks(fullUrl: string): number[] | null {
    const [peaks, setPeaks] = useState<number[] | null>(null);

    useEffect(() => {
        setPeaks(null);
        const controller = new AbortController();
        loadWaveform(fullUrl, { signal: controller.signal })
            .then((waveform) => {
                if (!controller.signal.aborted) setPeaks(waveform?.peaks ?? null);
            })
            .catch(() => {});
        return () => controller.abort();
    }, [ fullUrl ]);

    return peaks;
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
