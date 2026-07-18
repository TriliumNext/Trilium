import "./WaveformSeekBar.css";

import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { useTriliumEvent } from "../../react/hooks";
import { resolveCssColor } from "./css_color";
import { formatTime } from "./MediaPlayer";

/** Below this normalized amplitude a bucket is considered silence and painted with the silence color. */
const SILENCE_THRESHOLD = 0.06;
/** Bar + gap geometry, in CSS pixels. The renderer fits as many bars as the width allows. */
const BAR_WIDTH = 2;
const BAR_GAP = 2;
const MIN_BAR_HEIGHT = 2;
/** Flat amplitude shown before the waveform is analyzed; the bars morph up/down from this to the real values. */
const FLAT_LEVEL = 0.1;
/** Duration of the flat → analyzed morph, in milliseconds. */
const MORPH_DURATION = 1000;
/** Keyboard seek step, as a fraction of the total duration; Home/End jump to the ends. */
const KEYBOARD_STEP = 0.05;

/**
 * Waveform seek bar: shown from the very start. Until the amplitude envelope is decoded it renders a flat
 * placeholder band; when {@link peaks} arrives the bars animate from flat to their real heights. Scrubbing works
 * throughout (it only needs the media element's duration), by mouse, touch (Pointer Events), or keyboard.
 */
export function WaveformSeekBar({ mediaRef, peaks }: { mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement>; peaks: number[] | null }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [morph, setMorph] = useState(0);
    const [colors, setColors] = useState<WaveformColors>(DEFAULT_COLORS);

    // Mirror the media element's clock — same seeding pattern as SeekBar: read the element now in case its
    // metadata already loaded before this passive effect attached the listeners.
    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;

        const onTimeUpdate = () => setCurrentTime(media.currentTime);
        const onDurationChange = () => setDuration(media.duration);
        onTimeUpdate();
        onDurationChange();

        media.addEventListener("timeupdate", onTimeUpdate);
        media.addEventListener("durationchange", onDurationChange);
        return () => {
            media.removeEventListener("timeupdate", onTimeUpdate);
            media.removeEventListener("durationchange", onDurationChange);
        };
    }, [ mediaRef ]);

    // Track the canvas' CSS size so the draw effect can run at device-pixel resolution.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const observer = new ResizeObserver(() => setSize({ width: canvas.clientWidth, height: canvas.clientHeight }));
        observer.observe(canvas);
        setSize({ width: canvas.clientWidth, height: canvas.clientHeight });
        return () => observer.disconnect();
    }, []);

    // Resolve the theme's waveform colors and cache them — the draw runs up to ~60 times/second during the
    // morph, so it must not force a style recalculation each frame. Re-resolved on mount and whenever the theme
    // changes (option swap or OS light/dark flip).
    const refreshColors = useCallback(() => {
        const canvas = canvasRef.current;
        if (canvas) setColors(readColors(canvas));
    }, []);
    useEffect(refreshColors, [ refreshColors ]);
    useTriliumEvent("themeChanged", refreshColors);

    // Animate flat → analyzed once the peaks are available. While they are null (loading or undecodable) morph
    // stays at 0 and the bars hold the flat placeholder.
    useEffect(() => {
        if (!peaks || peaks.length === 0) {
            setMorph(0);
            return;
        }
        let raf = 0;
        let startTs = 0;
        const tick = (ts: number) => {
            if (startTs === 0) startTs = ts;
            const linear = Math.min(1, (ts - startTs) / MORPH_DURATION);
            setMorph(1 - Math.pow(1 - linear, 3)); // ease-out cubic
            if (linear < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [ peaks ]);

    const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

    useEffect(() => {
        drawWaveform(canvasRef.current, peaks, progress, size, morph, colors);
    }, [ peaks, progress, size, morph, colors ]);

    const seekToFraction = useCallback((fraction: number) => {
        const media = mediaRef.current;
        if (!media || !media.duration) return;
        media.currentTime = Math.max(0, Math.min(1, fraction)) * media.duration;
    }, [ mediaRef ]);

    const seekToClientX = useCallback((clientX: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0) return;
        seekToFraction((clientX - rect.left) / rect.width);
    }, [ seekToFraction ]);

    // Pointer Events unify mouse and touch. Capturing the pointer keeps scrubbing live even when the finger or
    // cursor strays outside the canvas mid-drag.
    const onPointerDown = useCallback((e: PointerEvent) => {
        e.preventDefault();
        // preventDefault suppresses the default focus-on-click, so focus explicitly to keep keyboard seeking
        // reachable after a mouse/touch interaction.
        canvasRef.current?.focus();
        canvasRef.current?.setPointerCapture(e.pointerId);
        seekToClientX(e.clientX);
    }, [ seekToClientX ]);

    const onPointerMove = useCallback((e: PointerEvent) => {
        const canvas = canvasRef.current;
        if (!canvas?.hasPointerCapture(e.pointerId)) return;
        seekToClientX(e.clientX);
    }, [ seekToClientX ]);

    const onKeyDown = useCallback((e: KeyboardEvent) => {
        switch (e.key) {
            case "ArrowLeft":
                e.preventDefault();
                seekToFraction(progress - KEYBOARD_STEP);
                break;
            case "ArrowRight":
                e.preventDefault();
                seekToFraction(progress + KEYBOARD_STEP);
                break;
            case "Home":
                e.preventDefault();
                seekToFraction(0);
                break;
            case "End":
                e.preventDefault();
                seekToFraction(1);
                break;
        }
    }, [ progress, seekToFraction ]);

    return (
        <div class="media-seekbar-row waveform-seekbar">
            <span class="media-time">{formatTime(currentTime)}</span>
            <canvas
                ref={canvasRef}
                class="waveform-canvas"
                role="slider"
                tabIndex={0}
                aria-label={t("media.seek")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onKeyDown={onKeyDown}
            />
            <span class="media-time">-{formatTime(Math.max(0, duration - currentTime))}</span>
        </div>
    );
}

function drawWaveform(canvas: HTMLCanvasElement | null, peaks: number[] | null, progress: number, size: { width: number; height: number }, morph: number, colors: WaveformColors) {
    if (!canvas || size.width <= 0 || size.height <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const analyzed = !!peaks && peaks.length > 0;
    const barStride = BAR_WIDTH + BAR_GAP;
    const barCount = Math.max(1, Math.floor(width / barStride));
    const playX = progress * width;
    const mid = height / 2;
    const maxBarHeight = Math.max(MIN_BAR_HEIGHT, height - 2);

    for (let bar = 0; bar < barCount; bar++) {
        // Loudest sample in this bar's slice of the stored envelope, so brief peaks are not averaged away.
        let target = FLAT_LEVEL;
        if (analyzed && peaks) {
            target = 0;
            const start = Math.floor((bar / barCount) * peaks.length);
            const end = Math.max(start + 1, Math.floor(((bar + 1) / barCount) * peaks.length));
            for (let i = start; i < end && i < peaks.length; i++) {
                if (peaks[i] > target) target = peaks[i];
            }
        }

        // Morph from the flat placeholder to the analyzed height. Color is classified from the final target so
        // it stays stable during the animation rather than flickering as the height crosses the threshold.
        const amplitude = FLAT_LEVEL + (target - FLAT_LEVEL) * morph;
        const x = bar * barStride;
        const barHeight = Math.max(MIN_BAR_HEIGHT, amplitude * maxBarHeight);
        // Played bars always take the played color (so silence gaps fill as the playhead passes); the silence
        // color only distinguishes still-unplayed gaps. Silence is classified from the final target so the
        // colour stays stable during the morph rather than flickering as the height crosses the threshold.
        const silent = analyzed && target < SILENCE_THRESHOLD;
        ctx.fillStyle = x < playX ? colors.played : (silent ? colors.silence : colors.unplayed);
        ctx.fillRect(x, mid - barHeight / 2, BAR_WIDTH, barHeight);
    }
}

interface WaveformColors {
    played: string;
    unplayed: string;
    silence: string;
}

/** Fallback colors used until the theme's values are resolved (and if a custom property is left unset). */
const DEFAULT_COLORS: WaveformColors = { played: "#4caf9d", unplayed: "#5a5a5a", silence: "#333333" };

function readColors(canvas: HTMLCanvasElement): WaveformColors {
    const host = canvas.parentElement ?? canvas;
    return {
        played: resolveCssColor(host, "--waveform-played-color", DEFAULT_COLORS.played),
        unplayed: resolveCssColor(host, "--waveform-unplayed-color", DEFAULT_COLORS.unplayed),
        silence: resolveCssColor(host, "--waveform-silence-color", DEFAULT_COLORS.silence)
    };
}
