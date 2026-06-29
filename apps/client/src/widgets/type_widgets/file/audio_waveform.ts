/**
 * Waveform extraction for the audio seek bar.
 *
 * The seek bar renders the recording's amplitude envelope as vertical bars so the listener can see where
 * speech sits and where the silences are. We compute that envelope once per note by decoding the whole file
 * client-side — independent of the streaming `<audio>` element, so it is unaffected by range requests or any
 * cross-origin tainting of the media element.
 *
 * {@link computePeaks} is the pure, testable core; {@link loadWaveform} wraps it with the fetch + decode that
 * can only run in a browser with the Web Audio API.
 */

/** Resolution of the stored envelope. The renderer downsamples this to the available pixel width, so this is
 *  just an upper bound on detail — high enough to stay crisp on a wide player, cheap enough to decode fast. */
export const WAVEFORM_BUCKETS = 1000;

/** Files larger than this are not decoded (decoding loads the whole thing into memory and is CPU-heavy);
 *  the caller falls back to the plain seek bar. */
export const MAX_WAVEFORM_BYTES = 60 * 1024 * 1024;

/** Buckets quieter than this fraction of the loudest one are treated as silence and excluded when locating the
 *  noise floor, so a few dead-air gaps can't drag the floor down to zero and defeat the contrast stretch. */
const ACTIVE_FRACTION = 0.05;
/** The noise floor is this percentile of the audible buckets — low enough to keep nearly all speech above it,
 *  high enough to sit above background hiss. The quietest few percent of speech clip to the baseline. */
const FLOOR_PERCENTILE = 0.05;

export interface Waveform {
    /** Normalized 0..1 amplitude per bucket. */
    peaks: number[];
    /** Decoded duration in seconds. */
    duration: number;
}

/**
 * Reduce raw PCM samples to `buckets` normalized amplitudes using per-bucket RMS energy.
 *
 * RMS (rather than peak) is deliberate: it tracks perceived loudness, so sustained speech reads as tall bars
 * and silence/room-tone collapses to near-zero — which is exactly the "speech vs. silence" overview the seek
 * bar is for.
 *
 * The envelope is then contrast-stretched: the audible range `[noise-floor, loudest]` is mapped onto `[0, 1]`,
 * rather than `[0, loudest]`. Voice recordings (meetings especially) sit on a constant noise floor with fairly
 * even speech energy, so a plain max-normalization leaves every bar in a narrow high band — a flat-looking
 * block. Subtracting the floor spreads the speech across the full height and lets pauses drop to the baseline.
 *
 * Pure and synchronous so it can be unit-tested without the Web Audio API.
 */
export function computePeaks(samples: Float32Array, buckets: number): number[] {
    if (buckets <= 0) {
        return [];
    }
    if (samples.length === 0) {
        return new Array(buckets).fill(0);
    }

    const rms = new Array<number>(buckets);
    const bucketSize = samples.length / buckets;
    let max = 0;

    for (let b = 0; b < buckets; b++) {
        const start = Math.floor(b * bucketSize);
        const end = Math.min(samples.length, Math.floor((b + 1) * bucketSize));
        let sumSquares = 0;
        let count = 0;
        for (let i = start; i < end; i++) {
            const s = samples[i];
            sumSquares += s * s;
            count++;
        }
        rms[b] = count > 0 ? Math.sqrt(sumSquares / count) : 0;
        if (rms[b] > max) {
            max = rms[b];
        }
    }

    if (max <= 0) {
        return new Array(buckets).fill(0);
    }

    const floor = noiseFloor(rms, max);
    const range = max - floor;
    return rms.map((value) => (range > 0 ? Math.max(0, Math.min(1, (value - floor) / range)) : value / max));
}

/** Estimate the noise floor as a low percentile of the audible buckets (those carrying real sound), so dead-air
 *  gaps don't drag it to zero. Returns 0 when nothing is audible, which makes the stretch a plain max-normalize. */
function noiseFloor(rms: readonly number[], max: number): number {
    const audible = rms.filter((value) => value > max * ACTIVE_FRACTION).sort((a, b) => a - b);
    if (audible.length === 0) {
        return 0;
    }
    return audible[Math.floor((audible.length - 1) * FLOOR_PERCENTILE)];
}

/**
 * Fetch the full audio file and decode it into a normalized waveform.
 *
 * Returns `null` (rather than throwing) for any condition the caller should treat as "no waveform, fall back
 * to the plain bar": oversized file, failed request, undecodable/unsupported format, or aborted navigation.
 */
export async function loadWaveform(url: string, { signal, buckets = WAVEFORM_BUCKETS }: { signal?: AbortSignal; buckets?: number } = {}): Promise<Waveform | null> {
    try {
        const response = await fetch(url, { signal, credentials: "include" });
        if (!response.ok) {
            return null;
        }

        // Bail on oversized files from the header before downloading the body, when the server reports it.
        const contentLength = Number(response.headers.get("Content-Length"));
        if (contentLength > MAX_WAVEFORM_BYTES) {
            return null;
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0 || buffer.byteLength > MAX_WAVEFORM_BYTES) {
            return null;
        }

        // Decoding is CPU-heavy; if navigation already moved on while the body was downloading, don't start it.
        if (signal?.aborted) {
            return null;
        }

        // A 1-frame OfflineAudioContext is only used as a decoder here; its own sample rate is irrelevant to
        // decodeAudioData, which decodes at the file's native rate.
        const decoder = new OfflineAudioContext(1, 1, 44100);
        const audioBuffer = await decoder.decodeAudioData(buffer);
        const peaks = computePeaks(audioBuffer.getChannelData(0), buckets);
        return { peaks, duration: audioBuffer.duration };
    } catch {
        // Aborted fetch, network error, or decode failure — all mean "no waveform".
        return null;
    }
}
