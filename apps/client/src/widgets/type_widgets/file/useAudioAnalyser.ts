import { RefObject } from "preact";
import { useCallback, useEffect } from "preact/hooks";

interface AnalyserBundle {
    context: AudioContext;
    analyser: AnalyserNode;
    data: Uint8Array<ArrayBuffer>;
}

/**
 * One AudioContext/analyser graph per media element. `createMediaElementSource` may be called only once per
 * element, and the element is reused across notes, so the graph is built once and cached for the element's
 * lifetime (a `null` entry records a failed/unsupported attempt so we don't retry it).
 */
const analyserCache = new WeakMap<HTMLMediaElement, AnalyserBundle | null>();

const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

/**
 * Taps a media element's audio for frequency analysis and returns a getter for the current byte spectrum (or
 * null before the graph exists / when unsupported). The graph is built lazily on first `play` — both because an
 * AudioContext needs a user gesture to start, and because routing the element through the context means it only
 * outputs while the context runs, so we resume it then.
 *
 * Caveat: once tapped, the element's audio flows through the AudioContext. On the desktop custom protocol the
 * element is cross-origin, so the tap is blocked (tainted) — audio still plays, the spectrum just reads zero.
 */
export function useAudioAnalyser(mediaRef: RefObject<HTMLMediaElement>): () => Uint8Array | null {
    useEffect(() => {
        const media = mediaRef.current;
        if (!media) return;
        const onPlay = () => {
            const bundle = ensureAnalyser(media);
            if (bundle && bundle.context.state === "suspended") {
                void bundle.context.resume();
            }
        };
        media.addEventListener("play", onPlay);
        return () => {
            media.removeEventListener("play", onPlay);
            // Release the audio resources on unmount: AudioContexts are limited (Chromium throws once too many
            // are open), and a WeakMap entry alone never frees the underlying context.
            const bundle = analyserCache.get(media);
            if (bundle) {
                void bundle.context.close();
            }
            analyserCache.delete(media);
        };
    }, [ mediaRef ]);

    return useCallback(() => {
        const media = mediaRef.current;
        if (!media) return null;
        const bundle = analyserCache.get(media);
        if (!bundle) return null;
        bundle.analyser.getByteFrequencyData(bundle.data);
        return bundle.data;
    }, [ mediaRef ]);
}

function ensureAnalyser(media: HTMLMediaElement): AnalyserBundle | null {
    const cached = analyserCache.get(media);
    if (cached !== undefined) {
        return cached; // already built, or a recorded failure we shouldn't retry
    }

    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
        analyserCache.set(media, null);
        return null;
    }
    try {
        const context = new AudioContextCtor();
        const source = context.createMediaElementSource(media);
        const analyser = context.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING;
        source.connect(analyser);
        analyser.connect(context.destination);
        const bundle: AnalyserBundle = { context, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
        analyserCache.set(media, bundle);
        return bundle;
    } catch {
        // createMediaElementSource throws when the element's source is cross-origin/tainted; record the failure.
        analyserCache.set(media, null);
        return null;
    }
}
