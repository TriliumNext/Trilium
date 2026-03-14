import "./Video.css";

import { RefObject } from "preact";
import { MutableRef, useCallback, useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { getUrlForDownload } from "../../../services/open";
import ActionButton from "../../react/ActionButton";
import NoItems from "../../react/NoItems";
import { LoopButton, PlaybackSpeed, PlayPauseButton, SeekBar, SkipButton, VolumeControl } from "./MediaPlayer";

const AUTO_HIDE_DELAY = 3000;

export default function VideoPreview({ note }: { note: FNote }) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [error, setError] = useState(false);
    const { visible: controlsVisible, onMouseMove, flash: flashControls } = useAutoHideControls(videoRef, playing);

    useEffect(() => setError(false), [note.noteId]);
    const onError = useCallback(() => setError(true), []);

    const togglePlayback = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }, []);

    const onVideoClick = useCallback((e: MouseEvent) => {
        if ((e.target as HTMLElement).closest(".media-preview-controls")) return;
        togglePlayback();
    }, [togglePlayback]);

    const onKeyDown = useKeyboardShortcuts(videoRef, wrapperRef, togglePlayback, flashControls);

    if (error) {
        return <NoItems icon="bx bx-video-off" text={t("media.unsupported-format", { mime: note.mime.replace("/", "-") })} />;
    }

    return (
        <div ref={wrapperRef} className={`video-preview-wrapper ${controlsVisible ? "" : "controls-hidden"}`} tabIndex={0} onClick={onVideoClick} onKeyDown={onKeyDown} onMouseMove={onMouseMove}>
            <video
                ref={videoRef}
                class="video-preview"
                src={getUrlForDownload(`api/notes/${note.noteId}/open-partial`)}
                datatype={note?.mime}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={onError}
            />

            <div className="media-preview-controls">
                <SeekBar mediaRef={videoRef} />
                <div class="media-buttons-row">
                    <div className="left">
                        <PlaybackSpeed mediaRef={videoRef} />
                        <RotateButton videoRef={videoRef} />
                    </div>
                    <div className="center">
                        <div className="spacer" />
                        <SkipButton mediaRef={videoRef} seconds={-10} icon="bx bx-rewind" text={t("media.back-10s")} />
                        <PlayPauseButton playing={playing} togglePlayback={togglePlayback} />
                        <SkipButton mediaRef={videoRef} seconds={30} icon="bx bx-fast-forward" text={t("media.forward-30s")} />
                        <LoopButton mediaRef={videoRef} />
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

    const onMouseMove = useCallback(() => {
        setVisible(true);
        scheduleHide();
    }, [scheduleHide]);

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

    return { visible, onMouseMove, flash: onMouseMove };
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
