import "./MediaPlayer.css";

import { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import Dropdown from "../../react/Dropdown";
import Icon from "../../react/Icon";

export function SeekBar({ mediaRef }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement> }) {
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        const onTimeUpdate = () => setCurrentTime(media.currentTime);
        const onDurationChange = () => setDuration(media.duration);

        media.addEventListener("timeupdate", onTimeUpdate);
        media.addEventListener("durationchange", onDurationChange);
        return () => {
            media.removeEventListener("timeupdate", onTimeUpdate);
            media.removeEventListener("durationchange", onDurationChange);
        };
    }, [ mediaRef ]);

    const onSeek = (e: Event) => {
        const media = mediaRef.current;
        if (!media) return;
        media.currentTime = parseFloat((e.target as HTMLInputElement).value);
    };

    return (
        <div class="media-seekbar-row">
            <span class="media-time">{formatTime(currentTime)}</span>
            <input
                type="range"
                class="media-trackbar"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onInput={onSeek}
            />
            <span class="media-time">-{formatTime(Math.max(0, duration - currentTime))}</span>
        </div>
    );
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function PlayPauseButton({ playing, togglePlayback }: {    
    playing: boolean,
    togglePlayback: () => void
}) {
    return (
        <ActionButton
            className="play-button"
            icon={playing ? "bx bx-pause" : "bx bx-play"}
            text={playing ? t("media.pause") : t("media.play")}
            onClick={togglePlayback}
        />
    );
}

export function VolumeControl({ mediaRef }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement> }) {
    const [volume, setVolume] = useState(() => mediaRef.current?.volume ?? 1);
    const [muted, setMuted] = useState(() => mediaRef.current?.muted ?? false);

    // Sync state when the media element changes volume externally.
    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        setVolume(media.volume);
        setMuted(media.muted);

        const onVolumeChange = () => {
            setVolume(media.volume);
            setMuted(media.muted);
        };
        media.addEventListener("volumechange", onVolumeChange);
        return () => media.removeEventListener("volumechange", onVolumeChange);
    }, [ mediaRef ]);

    const onVolumeChange = (e: Event) => {
        const media = mediaRef.current;
        if (!media) return;
        const val = parseFloat((e.target as HTMLInputElement).value);
        media.volume = val;
        setVolume(val);
        if (val > 0 && media.muted) {
            media.muted = false;
            setMuted(false);
        }
    };

    const toggleMute = () => {
        const media = mediaRef.current;
        if (!media) return;
        media.muted = !media.muted;
        setMuted(media.muted);
    };

    return (
        <div class="media-volume-row">
            <ActionButton
                icon={muted || volume === 0 ? "bx bx-volume-mute" : volume < 0.5 ? "bx bx-volume-low" : "bx bx-volume-full"}
                text={muted ? t("media.unmute") : t("media.mute")}
                onClick={toggleMute}
            />
            <input
                type="range"
                class="media-volume-slider"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onInput={onVolumeChange}
            />
        </div>
    );
}

export function SkipButton({ mediaRef, seconds, icon, text }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement>, seconds: number, icon: string, text: string }) {
    const skip = () => {
        const media = mediaRef.current;
        if (!media) return;
        media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + seconds));
    };

    return (
        <ActionButton icon={icon} text={text} onClick={skip} />
    );
}

export function LoopButton({ mediaRef }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement> }) {
    const [loop, setLoop] = useState(() => mediaRef.current?.loop ?? false);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;
        setLoop(media.loop);

        const observer = new MutationObserver(() => setLoop(media.loop));
        observer.observe(media, { attributes: true, attributeFilter: ["loop"] });
        return () => observer.disconnect();
    }, [ mediaRef ]);

    const toggle = () => {
        const media = mediaRef.current;
        if (!media) return;
        media.loop = !media.loop;
        setLoop(media.loop);
    };

    return (
        <ActionButton
            className={loop ? "active" : ""}
            icon="bx bx-repeat"
            text={loop ? t("media.disable-loop") : t("media.loop")}
            onClick={toggle}
        />
    );
}

const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export function PlaybackSpeed({ mediaRef }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement> }) {
    const [speed, setSpeed] = useState(() => mediaRef.current?.playbackRate ?? 1);

    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        setSpeed(media.playbackRate);

        const onRateChange = () => setSpeed(media.playbackRate);
        media.addEventListener("ratechange", onRateChange);
        return () => media.removeEventListener("ratechange", onRateChange);
    }, [ mediaRef ]);

    const selectSpeed = (rate: number) => {
        const media = mediaRef.current;
        if (!media) return;
        media.playbackRate = rate;
        setSpeed(rate);
    };

    return (
        <Dropdown
            iconAction
            hideToggleArrow
            buttonClassName="speed-dropdown"
            text={<>
                <Icon icon="bx bx-tachometer" />
                <span class="media-speed-label">{speed}x</span>
            </>}
            title={t("media.playback-speed")}
        >
            {PLAYBACK_SPEEDS.map((rate) => (
                <li key={rate}>
                    <button
                        class={`dropdown-item ${rate === speed ? "active" : ""}`}
                        onClick={() => selectSpeed(rate)}
                    >
                        {rate}x
                    </button>
                </li>
            ))}
        </Dropdown>
    );
}
