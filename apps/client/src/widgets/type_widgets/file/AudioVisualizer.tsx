import "./AudioVisualizer.css";

import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { useTriliumEvent } from "../../react/hooks";
import { buildRowColors, cellIntensity, computeColumnAmplitudes, computeGrid, hasMotion, resizePreserving, smoothAmplitudes, type VisualizerGrid } from "./audio_visualizer";
import { resolveCssColor } from "./css_color";
import { useAudioAnalyser } from "./useAudioAnalyser";

/** Cell geometry, in CSS pixels. The grid fits as many of these as the canvas allows. */
const CELL_SIZE = 8;
const CELL_GAP = 2;
/** Slice of the spectrum spread across the bars — broad (not voice-specific). The very top bins are usually
 *  silent, so the top quarter is dropped to keep the bars lively. */
const LO_FRACTION = 0;
const HI_FRACTION = 0.75;
/** rAF easing: fast attack, slower release, for a snappy but smooth meter. */
const RISE = 0.5;
const FALL = 0.15;

const DEFAULT_LOW_COLOR = "rgb(0, 0, 0)";
const DEFAULT_HIGH_COLOR = "rgb(136, 136, 136)";

/**
 * Realtime frequency visualizer: a bottom-aligned grid of square cells where each column is a frequency bar that
 * lights up from the bottom and each cell takes a single colour from a low→high vertical gradient. Runs an rAF
 * loop only while playing (and briefly after, to animate the decay); when not playing every column rests at zero.
 */
export function AudioVisualizer({ mediaRef, isPlaying }: { mediaRef: RefObject<HTMLAudioElement>; isPlaying: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const getFrequencyData = useAudioAnalyser(mediaRef);
    const [ size, setSize ] = useState({ width: 0, height: 0 });
    const [ colors, setColors ] = useState({ low: DEFAULT_LOW_COLOR, high: DEFAULT_HIGH_COLOR });

    // The render loop reads the latest props/state through refs so it never has to be torn down and restarted.
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;
    const sizeRef = useRef(size);
    sizeRef.current = size;
    const colorsRef = useRef(colors);
    colorsRef.current = colors;
    // Reused per-frame buffers (per column / per row) so the loop allocates nothing once warm.
    const displayRef = useRef<Float32Array>(new Float32Array(0));
    const targetRef = useRef<Float32Array>(new Float32Array(0));
    const rowColorsRef = useRef<{ rows: number; low: string; high: string; colors: string[] }>({ rows: -1, low: "", high: "", colors: [] });
    const rafRef = useRef(0);

    // Track the canvas' CSS size so the loop can render at device-pixel resolution and re-lay-out the grid.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const observer = new ResizeObserver(() => setSize({ width: canvas.clientWidth, height: canvas.clientHeight }));
        observer.observe(canvas);
        setSize({ width: canvas.clientWidth, height: canvas.clientHeight });
        return () => observer.disconnect();
    }, []);

    // Resolve the theme's gradient colours once on mount and on any theme change (cached; never read per frame).
    const refreshColors = useCallback(() => {
        const host = canvasRef.current?.parentElement ?? canvasRef.current;
        if (!host) return;
        setColors({
            low: resolveCssColor(host, "--audio-visualizer-low-color", DEFAULT_LOW_COLOR),
            high: resolveCssColor(host, "--audio-visualizer-high-color", DEFAULT_HIGH_COLOR)
        });
    }, []);
    useEffect(refreshColors, [ refreshColors ]);
    useTriliumEvent("themeChanged", refreshColors);

    const renderFrame = useCallback(() => {
        const canvas = canvasRef.current;
        const { width, height } = sizeRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || width <= 0 || height <= 0) {
            rafRef.current = 0;
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const grid = computeGrid(width, height, CELL_SIZE, CELL_GAP);
        // Keep the per-column buffers sized to the grid, preserving values across resizes to avoid a jump.
        if (displayRef.current.length !== grid.cols) {
            displayRef.current = resizePreserving(displayRef.current, grid.cols);
            targetRef.current = new Float32Array(grid.cols);
        }
        // Rebuild the cached row gradient only when the rows or colours actually change.
        const cache = rowColorsRef.current;
        if (cache.rows !== grid.rows || cache.low !== colorsRef.current.low || cache.high !== colorsRef.current.high) {
            rowColorsRef.current = {
                rows: grid.rows,
                low: colorsRef.current.low,
                high: colorsRef.current.high,
                colors: buildRowColors(colorsRef.current.low, colorsRef.current.high, grid.rows)
            };
        }

        const spectrum = isPlayingRef.current ? getFrequencyData() : null;
        const targets = spectrum ? computeColumnAmplitudes(spectrum, targetRef.current, LO_FRACTION, HI_FRACTION) : null;
        smoothAmplitudes(displayRef.current, targets, RISE, FALL);

        drawGrid(ctx, width, height, grid, displayRef.current, rowColorsRef.current.colors);

        // Keep animating while playing, or while bars are still settling toward zero after a pause.
        rafRef.current = isPlayingRef.current || hasMotion(displayRef.current) ? requestAnimationFrame(renderFrame) : 0;
    }, [ getFrequencyData ]);

    // Start the loop when playback starts; it self-terminates once paused and fully decayed.
    useEffect(() => {
        if (isPlaying && rafRef.current === 0) {
            rafRef.current = requestAnimationFrame(renderFrame);
        }
    }, [ isPlaying, renderFrame ]);

    // While idle (loop stopped), redraw a single frame on size/colour changes so a resize doesn't leave a
    // stretched/stale canvas. When playing, the running loop already picks these up each frame.
    useEffect(() => {
        if (rafRef.current === 0) {
            renderFrame();
        }
    }, [ size, colors, renderFrame ]);

    useEffect(() => () => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
        }
    }, []);

    return <canvas ref={canvasRef} class="audio-visualizer-canvas" aria-hidden="true" />;
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, grid: VisualizerGrid, amplitudes: Float32Array, rowColors: string[]) {
    ctx.clearRect(0, 0, width, height);
    const { cols, rows, offsetX } = grid;
    const stride = CELL_SIZE + CELL_GAP;
    // Iterate row-by-row so the (per-row) fill colour is set once rather than per cell; each cell's alpha is its
    // intensity, fading the leading cell between off and on.
    for (let r = 0; r < rows; r++) {
        ctx.fillStyle = rowColors[r];
        const y = height - CELL_SIZE - r * stride;
        for (let c = 0; c < cols; c++) {
            const intensity = cellIntensity(amplitudes[c], rows, r);
            if (intensity <= 0) continue;
            ctx.globalAlpha = intensity;
            ctx.fillRect(offsetX + c * stride, y, CELL_SIZE, CELL_SIZE);
        }
    }
    ctx.globalAlpha = 1;
}
