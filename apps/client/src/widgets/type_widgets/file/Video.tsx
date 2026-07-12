import "./Video.css";

import { RefObject } from "preact";
import { MutableRef, useCallback, useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { getUrlForDownload } from "../../../services/open";
import ActionButton from "../../react/ActionButton";
import NoItems from "../../react/NoItems";
import { MediaSiblingButton, PlaybackSpeed, PlayModeButton, PlayPauseButton, SeekBar, SkipButton, useMediaPlayMode, useMediaSessionController, VolumeControl } from "./MediaPlayer";

const AUTO_HIDE_DELAY = 3000;

export default function VideoPreview({ note, noteContext, isVisible = true }: { note: FNote, noteContext?: NoteContext, isVisible?: boolean }) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [error, setError] = useState(false);
    const { visible: controlsVisible, flash: flashControls, toggle: toggleControls } = useAutoHideControls(videoRef, playing);

    useEffect(() => {
        setError(false);
        // The player instance is reused across notes (just a new src), which stops playback but doesn't
        // reliably fire "pause" — reset so the controls don't keep showing the previous note's playing state.
        setPlaying(false);
    }, [note.noteId]);
    const onError = useCallback(() => setError(true), []);
    // Mirror the element's real play state on every transition: "pause" isn't fired reliably when a track
    // ends or its src is swapped, so derive from `paused` rather than assuming play→true / pause→false.
    const syncPlaying = useCallback(() => setPlaying(!!videoRef.current && !videoRef.current.paused), []);

    const togglePlayback = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }, []);

    // Track the pointer type of the current interaction: `click` doesn't reliably expose pointerType across
    // browsers, but the preceding pointerdown always does.
    const lastPointerType = useRef<string>("mouse");
    const onPointerDown = useCallback((e: PointerEvent) => { lastPointerType.current = e.pointerType; }, []);

    // Reveal-on-move is a mouse/pen affordance; a touch drag shouldn't flash the controls (touch uses tap).
    const onPointerMove = useCallback((e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        flashControls();
    }, [flashControls]);

    const onVideoClick = useCallback((e: MouseEvent) => {
        if ((e.target as HTMLElement).closest(".media-preview-controls")) return;
        // On touch there's no hover to reveal the auto-hidden controls, so a tap toggles them instead of
        // playing/pausing (which stays on the play button); otherwise the same tap would do both.
        if (lastPointerType.current === "touch") {
            toggleControls();
            return;
        }
        togglePlayback();
    }, [togglePlayback, toggleControls]);

    const onKeyDown = useKeyboardShortcuts(videoRef, wrapperRef, togglePlayback, flashControls);
    const { mode: playMode, setMode: setPlayMode } = useMediaPlayMode(noteContext, videoRef);
    const siblingNavigation = useMediaSessionController(note, noteContext, "video/", videoRef, isVisible, playMode);

    if (error) {
        return <NoItems icon="bx bx-video-off" text={t("media.unsupported-format", { mime: note.mime.replace("/", "-") })} />;
    }

    return (
        <div ref={wrapperRef} className={`video-preview-wrapper ${controlsVisible ? "" : "controls-hidden"}`} tabIndex={0} onClick={onVideoClick} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
            <video
                ref={videoRef}
                class="video-preview"
                src={getUrlForDownload(`api/notes/${note.noteId}/open-partial`)}
                datatype={note?.mime}
                onPlay={syncPlaying}
                onPause={syncPlaying}
                onEnded={syncPlaying}
                onEmptied={syncPlaying}
                onError={onError}
            />

            <div className="media-preview-controls">
                <SeekBar mediaRef={videoRef} />
                <div class="media-buttons-row">
                    <div className="left">
                        <PlaybackSpeed mediaRef={videoRef} />
                        <PlayModeButton mode={playMode} onSelectMode={setPlayMode} />
                        <RotateButton videoRef={videoRef} />
                    </div>
                    <div className="center">
                        <div className="spacer" />
                        <MediaSiblingButton navigation={siblingNavigation} direction="previous" tooltipI18nKey="media.previous-video" />
                        <SkipButton mediaRef={videoRef} seconds={-10} icon="bx bx-rewind" text={t("media.back-10s")} />
                        <PlayPauseButton playing={playing} togglePlayback={togglePlayback} />
                        <SkipButton mediaRef={videoRef} seconds={10} icon="bx bx-fast-forward" text={t("media.forward-10s")} />
                        <MediaSiblingButton navigation={siblingNavigation} direction="next" tooltipI18nKey="media.next-video" />
                    </div>
                    <div className="right">
                        <VolumeControl mediaRef={videoRef} />
                        <ZoomToFitButton videoRef={videoRef} />
                        <PictureInPictureButton videoRef={videoRef} />
                        <FullscreenButton targetRef={wrapperRef} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function useKeyboardShortcuts(videoRef: MutableRef<HTMLVideoElement | null>, wrapperRef: MutableRef<HTMLDivElement | null>, togglePlayback: () => void, flashControls: () => void) {
    return useCallback((e: KeyboardEvent) => {
        const video = videoRef.current;
        if (!video) return;

        switch (e.key) {
            case " ":
                e.preventDefault();
                togglePlayback();
                flashControls();
                break;
            case "ArrowLeft":
                e.preventDefault();
                video.currentTime = Math.max(0, video.currentTime - (e.ctrlKey ? 60 : 10));
                flashControls();
                break;
            case "ArrowRight":
                e.preventDefault();
                video.currentTime = Math.min(video.duration, video.currentTime + (e.ctrlKey ? 60 : 10));
                flashControls();
                break;
            case "f":
            case "F":
                e.preventDefault();
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    wrapperRef.current?.requestFullscreen();
                }
                break;
            case "m":
            case "M":
                e.preventDefault();
                video.muted = !video.muted;
                flashControls();
                break;
            case "ArrowUp":
                e.preventDefault();
                video.volume = Math.min(1, video.volume + 0.05);
                flashControls();
                break;
            case "ArrowDown":
                e.preventDefault();
                video.volume = Math.max(0, video.volume - 0.05);
                flashControls();
                break;
            case "Home":
                e.preventDefault();
                video.currentTime = 0;
                flashControls();
                break;
            case "End":
                e.preventDefault();
                video.currentTime = video.duration;
                flashControls();
                break;
        }
    }, [ wrapperRef, videoRef, togglePlayback, flashControls ]);
}

function useAutoHideControls(videoRef: RefObject<HTMLVideoElement>, playing: boolean) {
    const [visible, setVisible] = useState(true);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

    const scheduleHide = useCallback(() => {
        clearTimeout(hideTimerRef.current);
        if (videoRef.current && !videoRef.current.paused) {
            hideTimerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_DELAY);
        }
    }, [ videoRef]);

    const reveal = useCallback(() => {
        setVisible(true);
        scheduleHide();
    }, [scheduleHide]);

    // Toggle visibility for touch taps (which have no hover to reveal the controls): hide immediately, or
    // show and re-arm the auto-hide.
    const toggle = useCallback(() => {
        if (visible) {
            clearTimeout(hideTimerRef.current);
            setVisible(false);
        } else {
            reveal();
        }
    }, [visible, reveal]);

    // Hide immediately when playback starts, show when paused.
    useEffect(() => {
        if (playing) {
            setVisible(false);
        } else {
            clearTimeout(hideTimerRef.current);
            setVisible(true);
        }
        return () => clearTimeout(hideTimerRef.current);
    }, [playing, scheduleHide]);

    return { visible, flash: reveal, toggle };
}

function RotateButton({ videoRef }: { videoRef: RefObject<HTMLVideoElement> }) {
    const [rotation, setRotation] = useState(0);

    const rotate = () => {
        const video = videoRef.current;
        if (!video) return;
        const next = (rotation + 90) % 360;
        setRotation(next);

        const isSideways = next === 90 || next === 270;
        if (isSideways) {
            // Scale down so the rotated video fits within its container.
            const container = video.parentElement;
            if (container) {
                const ratio = container.clientWidth / container.clientHeight;
                video.style.transform = `rotate(${next}deg) scale(${1 / ratio})`;
            } else {
                video.style.transform = `rotate(${next}deg)`;
            }
        } else {
            video.style.transform = next === 0 ? "" : `rotate(${next}deg)`;
        }
    };

    return (
        <ActionButton
            icon="bx bx-rotate-right"
            text={t("media.rotate")}
            onClick={rotate}
        />
    );
}

function ZoomToFitButton({ videoRef }: { videoRef: RefObject<HTMLVideoElement> }) {
    const [fitted, setFitted] = useState(false);

    const toggle = () => {
        const video = videoRef.current;
        if (!video) return;
        const next = !fitted;
        video.style.objectFit = next ? "cover" : "";
        setFitted(next);
    };

    return (
        <ActionButton
            className={fitted ? "active" : ""}
            icon={fitted ? "bx bx-collapse" : "bx bx-expand"}
            text={fitted ? t("media.zoom-reset") : t("media.zoom-to-fit")}
            onClick={toggle}
        />
    );
}

function PictureInPictureButton({ videoRef }: { videoRef: RefObject<HTMLVideoElement> }) {
    const [active, setActive] = useState(false);
    // The standard PiP API is only supported in Chromium-based browsers.
    // Firefox uses its own proprietary PiP implementation.
    const supported = "requestPictureInPicture" in HTMLVideoElement.prototype;

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !supported) return;

        const onEnter = () => setActive(true);
        const onLeave = () => setActive(false);

        video.addEventListener("enterpictureinpicture", onEnter);
        video.addEventListener("leavepictureinpicture", onLeave);
        return () => {
            video.removeEventListener("enterpictureinpicture", onEnter);
            video.removeEventListener("leavepictureinpicture", onLeave);
        };
    }, [ videoRef, supported ]);

    if (!supported) return null;

    const toggle = () => {
        const video = videoRef.current;
        if (!video) return;

        if (document.pictureInPictureElement) {
            document.exitPictureInPicture();
        } else {
            video.requestPictureInPicture();
        }
    };

    return (
        <ActionButton
            icon={active ? "bx bx-exit" : "bx bx-window-open"}
            text={active ? t("media.exit-picture-in-picture") : t("media.picture-in-picture")}
            onClick={toggle}
        />
    );
}

function FullscreenButton({ targetRef }: { targetRef: RefObject<HTMLElement> }) {
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, []);

    const toggleFullscreen = () => {
        const target = targetRef.current;
        if (!target) return;

        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            target.requestFullscreen();
        }
    };

    return (
        <ActionButton
            icon={isFullscreen ? "bx bx-exit-fullscreen" : "bx bx-fullscreen"}
            text={isFullscreen ? t("media.exit-fullscreen") : t("media.fullscreen")}
            onClick={toggleFullscreen}
        />
    );
}
