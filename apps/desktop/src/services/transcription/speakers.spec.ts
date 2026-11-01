import { describe, expect, it } from "vitest";

import { findSpeakerChanges, SpeakerClusterer, snapToWordBoundary } from "./speakers";

const options = {
    threshold: 0.5,
    minDurationSeconds: 1.5,
    newSpeakerMinDurationSeconds: 5,
    shortThreshold: 0.3
};

describe("SpeakerClusterer", () => {
    it("joins similar embeddings and starts a speaker for a distant one", () => {
        const clusterer = new SpeakerClusterer(options);

        expect(clusterer.assign(new Float32Array([ 1, 0, 0 ]), 6)).toBe(1);
        // Scale does not matter, only direction.
        expect(clusterer.assign(new Float32Array([ 9, 1, 0 ]), 6)).toBe(1);
        expect(clusterer.assign(new Float32Array([ 0, 1, 0 ]), 6)).toBe(2);
        expect(clusterer.assign(new Float32Array([ 0.1, 1, 0 ]), 6)).toBe(2);
        expect(clusterer.assign(new Float32Array([ 0, 0, 1 ]), 6)).toBe(3);
    });

    it("takes a silent, all-zero embedding as a speaker of its own rather than dividing by zero", () => {
        const clusterer = new SpeakerClusterer(options);
        expect(clusterer.assign(new Float32Array([ 0, 0, 0 ]), 6)).toBe(1);
        expect(clusterer.assign(new Float32Array([ 1, 0, 0 ]), 6)).toBe(2);
    });

    it("lets a short utterance join a speaker but never start one or move a centroid", () => {
        const clusterer = new SpeakerClusterer(options);
        expect(clusterer.assign(new Float32Array([ 0, 1 ]), 1)).toBeNull();
        expect(clusterer.assign(new Float32Array([ 1, 0 ]), 6)).toBe(1);

        // Cosine 0.71 joins speaker 1; a centroid moved by it would let [0, 1] join too.
        expect(clusterer.assign(new Float32Array([ 1, 1 ]), 1)).toBe(1);
        expect(clusterer.assign(new Float32Array([ 0.2, 1 ]), 1)).toBeNull();
        expect(clusterer.assign(new Float32Array([ 0.2, 1 ]), 6)).toBe(2);
    });

    it("gives an utterance too short to start a speaker the nearest one, without moving it", () => {
        const clusterer = new SpeakerClusterer(options);
        expect(clusterer.assign(new Float32Array([ 0, 0, 1 ]), 3)).toBeNull();
        clusterer.assign(new Float32Array([ 1, 0, 0 ]), 6);
        clusterer.assign(new Float32Array([ 0, 1, 0 ]), 6);

        // Cosine 0.37 with speaker 1 and 0.18 with speaker 2: under the threshold, nearest to 1.
        expect(clusterer.assign(new Float32Array([ 0.4, 0.2, 1 ]), 3)).toBe(1);
        // A short utterance takes it from the short threshold, 0.3, on.
        expect(clusterer.assign(new Float32Array([ 0.4, 0.2, 1 ]), 1)).toBe(1);
        // Cosine 0.20: too far for a short utterance, but not for a 3 s one.
        expect(clusterer.assign(new Float32Array([ 0.2, 0.1, 1 ]), 1)).toBeNull();
        expect(clusterer.assign(new Float32Array([ 0.2, 0.1, 1 ]), 3)).toBe(1);
        // Cosine 0.77 with a speaker 1 moved by the joins above; 0 with the unmoved one.
        expect(clusterer.assign(new Float32Array([ 0, 0, 1 ]), 6)).toBe(3);
    });

    it("moves a centroid with every long utterance it takes", () => {
        const clusterer = new SpeakerClusterer(options);
        clusterer.assign(new Float32Array([ 1, 0 ]), 6);
        // Cosine 0.6 with [1, 0] joins, and pulls the centroid toward [0.6, 0.8].
        expect(clusterer.assign(new Float32Array([ 0.6, 0.8 ]), 3)).toBe(1);
        // Cosine 0.28 with [1, 0] alone; 0.68 with the moved centroid.
        expect(clusterer.assign(new Float32Array([ 0.28, 0.96 ]), 6)).toBe(1);
    });

    it("matches an embedding to a known speaker without changing any", () => {
        const clusterer = new SpeakerClusterer(options);
        expect(clusterer.match(new Float32Array([ 1, 0 ]))).toBeNull();
        clusterer.assign(new Float32Array([ 1, 0 ]), 6);

        expect(clusterer.match(new Float32Array([ 0.6, 0.8 ]))).toBe(1);
        expect(clusterer.match(new Float32Array([ 0.28, 0.96 ]))).toBeNull();
        // The match above left the centroid at [1, 0], so a new speaker starts here.
        expect(clusterer.assign(new Float32Array([ 0.28, 0.96 ]), 6)).toBe(2);
    });
});

describe("findSpeakerChanges", () => {
    it("returns where a different label starts a run of at least two windows", () => {
        expect(findSpeakerChanges([ 1, 1, 1, 1 ])).toEqual([]);
        expect(findSpeakerChanges([ 1, 1, 2, 2, 2 ])).toEqual([ 2 ]);
        expect(findSpeakerChanges([ 1, 2, 2, 1, 1 ])).toEqual([ 1, 3 ]);
        expect(findSpeakerChanges([ 1, null, null, 1 ])).toEqual([ 1 ]);
    });

    it("ignores a different label that holds for one window only", () => {
        expect(findSpeakerChanges([ 1, 2, 1, 1, null, 1 ])).toEqual([]);
        expect(findSpeakerChanges([ 1, 1, 2, 1, 2, 2 ])).toEqual([ 4 ]);
    });
});

describe("snapToWordBoundary", () => {
    const words = [
        { text: "Yeah,", startSeconds: 0 },
        { text: "for", startSeconds: 1.44 },
        { text: "us?", startSeconds: 1.6 },
        { text: "Yes,", startSeconds: 1.84 },
        { text: "but", startSeconds: 2.16 },
        { text: "in", startSeconds: 2.32 },
        { text: "the", startSeconds: 2.48 },
        { text: "test", startSeconds: 2.8 },
        { text: "what", startSeconds: 5 }
    ];

    it("prefers the start of a sentence within reach to a nearer word", () => {
        expect(snapToWordBoundary(2.5, words)).toBe(1.84);
    });

    it("takes the nearest word start when no sentence starts within reach", () => {
        expect(snapToWordBoundary(4.2, words)).toBe(5);
        expect(snapToWordBoundary(3.7, words)).toBe(2.8);
    });

    it("keeps a word start that falls exactly on the cut over a farther one", () => {
        const exact = [
            { text: "so", startSeconds: 0 },
            { text: "we", startSeconds: 2 },
            { text: "go", startSeconds: 2.5 }
        ];
        expect(snapToWordBoundary(2, exact)).toBe(2);
    });

    it("keeps the cut where no word starts within reach", () => {
        expect(snapToWordBoundary(10, words)).toBe(10);
        // The first word's start is no boundary: nothing precedes it.
        expect(snapToWordBoundary(0.3, words)).toBe(0.3);
    });
});
