import { describe, expect, it } from "vitest";

import { computePeaks } from "./audio_waveform";

describe("computePeaks", () => {
    it("returns one normalized value per bucket", () => {
        const samples = new Float32Array([ 0.1, 0.2, 0.3, 0.4, 0.5, 0.6 ]);
        const peaks = computePeaks(samples, 3);

        expect(peaks).toHaveLength(3);
        // Loudest bucket is normalized to exactly 1; every value stays within 0..1.
        expect(Math.max(...peaks)).toBeCloseTo(1);
        expect(peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
    });

    it("ranks louder regions higher than quieter ones", () => {
        // First half quiet, second half loud.
        const samples = new Float32Array(1000);
        for (let i = 0; i < samples.length; i++) {
            samples[i] = i < 500 ? 0.05 : 0.9;
        }
        const peaks = computePeaks(samples, 2);

        expect(peaks[1]).toBeGreaterThan(peaks[0]);
        expect(peaks[1]).toBeCloseTo(1);
    });

    it("contrast-stretches a near-uniform energy band so it isn't flat", () => {
        // A "meeting"-like signal: silent gaps plus continuous speech that only varies between two close levels.
        const bucketLen = 200;
        const samples = new Float32Array(bucketLen * 5);
        const fill = (bucket: number, amp: number) => samples.fill(amp, bucket * bucketLen, (bucket + 1) * bucketLen);
        fill(0, 0); // silent gap
        fill(1, 0.4);
        fill(2, 0.5); // loudest
        fill(3, 0.4);
        fill(4, 0.5);
        const peaks = computePeaks(samples, 5);

        // Loudest stays at 1, the silent gap stays at 0, and the quieter speech is pushed well below the louder
        // speech — a plain max-normalize would have left 0.4/0.5 = 0.8 vs 1.0 (a nearly flat block).
        expect(peaks[2]).toBeCloseTo(1);
        expect(peaks[0]).toBe(0);
        expect(peaks[2] - peaks[1]).toBeGreaterThan(0.5);
    });

    it("treats silence as zero", () => {
        const peaks = computePeaks(new Float32Array(100), 4);
        expect(peaks).toEqual([ 0, 0, 0, 0 ]);
    });

    it("is sign-independent (uses energy, not raw amplitude)", () => {
        const positive = computePeaks(new Float32Array([ 0.5, 0.5, 0.5, 0.5 ]), 2);
        const negative = computePeaks(new Float32Array([ -0.5, -0.5, -0.5, -0.5 ]), 2);
        expect(positive).toEqual(negative);
    });

    it("handles more buckets than samples without gaps", () => {
        const peaks = computePeaks(new Float32Array([ 1, 1 ]), 5);
        expect(peaks).toHaveLength(5);
        expect(peaks.every((p) => Number.isFinite(p))).toBe(true);
    });

    it("guards against empty input and non-positive bucket counts", () => {
        expect(computePeaks(new Float32Array(0), 3)).toEqual([ 0, 0, 0 ]);
        expect(computePeaks(new Float32Array([ 1, 2, 3 ]), 0)).toEqual([]);
        expect(computePeaks(new Float32Array([ 1, 2, 3 ]), -1)).toEqual([]);
    });
});
