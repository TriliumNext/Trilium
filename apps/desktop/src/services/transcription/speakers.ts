export interface SpeakerClustererOptions {
    /** The cosine similarity to a speaker's centroid from which an utterance joins that speaker. */
    threshold: number;
    /** Utterances shorter than this, in seconds, never move a centroid. */
    minDurationSeconds: number;
    /** Only an utterance at least this long, in seconds, starts a speaker. */
    newSpeakerMinDurationSeconds: number;
    /**
     * The similarity from which an utterance shorter than `minDurationSeconds` joins the nearest
     * speaker when it is under `threshold`.
     */
    shortThreshold: number;
}

/**
 * Assigns embeddings to speakers as they arrive: an embedding joins the speaker whose centroid it
 * is most similar to, when that similarity reaches the threshold. Below it, an utterance of at
 * least `newSpeakerMinDurationSeconds` starts a new speaker, and a shorter one joins the nearest
 * speaker without moving its centroid, so a short or noisy utterance never adds a speaker.
 */
export class SpeakerClusterer {
    /** The sum of each speaker's normalized embeddings; its direction is the centroid. */
    private readonly centroids: Float32Array[] = [];

    constructor(private readonly options: SpeakerClustererOptions) {}

    get hasSpeakers() {
        return this.centroids.length > 0;
    }

    /** Returns the speaker an embedding reaches the threshold with, changing no speaker. */
    match(embedding: Float32Array): number | null {
        const { best, bestSimilarity } = this.nearest(normalize(embedding));
        return best >= 0 && bestSimilarity >= this.options.threshold ? best + 1 : null;
    }

    assign(embedding: Float32Array, durationSeconds: number): number | null {
        const normalized = normalize(embedding);
        const { best, bestSimilarity } = this.nearest(normalized);

        const isLongEnough = durationSeconds >= this.options.minDurationSeconds;
        if (best >= 0 && bestSimilarity >= this.options.threshold) {
            if (isLongEnough) {
                addInto(this.centroids[best], normalized);
            }
            return best + 1;
        }
        if (durationSeconds >= this.options.newSpeakerMinDurationSeconds) {
            this.centroids.push(normalized);
            return this.centroids.length;
        }
        if (best >= 0 && (isLongEnough || bestSimilarity >= this.options.shortThreshold)) {
            return best + 1;
        }
        return null;
    }

    private nearest(normalized: Float32Array) {
        let best = -1;
        let bestSimilarity = -Infinity;
        for (const [ index, centroid ] of this.centroids.entries()) {
            const similarity = dot(normalize(centroid), normalized);
            if (similarity > bestSimilarity) {
                best = index;
                bestSimilarity = similarity;
            }
        }
        return { best, bestSimilarity };
    }
}

/** A word of a transcribed utterance, `startSeconds` counted from the utterance's start. */
export interface TimedWord {
    text: string;
    startSeconds: number;
}

/** A stretch of an utterance spoken by one speaker, `null` when it is too short to tell. */
export interface SpeakerTurn {
    startSeconds: number;
    endSeconds: number;
    speaker: number | null;
}

/**
 * Returns the indexes of the windows at which another label starts a run of `minRun` windows or
 * more. `null` labels a window that matches no known speaker and counts as a label of its own.
 */
export function findSpeakerChanges(labels: (number | null)[], minRun = 2) {
    const changes: number[] = [];
    let current = labels[0];
    let runStart = 0;
    for (const [ index, label ] of labels.entries()) {
        if (label !== labels[runStart]) {
            runStart = index;
        }
        if (index - runStart + 1 === minRun && label !== current) {
            changes.push(runStart);
            current = label;
        }
    }
    return changes;
}

/**
 * Moves a cut to the start of a word within `reachSeconds`: the nearest one that follows a
 * sentence end, else the nearest one. Keeps the cut where no word starts within reach.
 */
export function snapToWordBoundary(cutSeconds: number, words: TimedWord[], reachSeconds = 1) {
    const boundaries = words.slice(1)
        .map((word, index) => ({
            seconds: word.startSeconds,
            followsSentence: /[.?!]$/.test(words[index].text)
        }))
        .filter(({ seconds }) => Math.abs(seconds - cutSeconds) <= reachSeconds);
    const sentenceStarts = boundaries.filter(({ followsSentence }) => followsSentence);
    const candidates = sentenceStarts.length ? sentenceStarts : boundaries;
    let best: number | undefined;
    for (const { seconds } of candidates) {
        if (best === undefined || Math.abs(seconds - cutSeconds) < Math.abs(best - cutSeconds)) {
            best = seconds;
        }
    }
    return best ?? cutSeconds;
}

function normalize(vector: Float32Array) {
    let sumOfSquares = 0;
    for (const value of vector) {
        sumOfSquares += value * value;
    }
    const length = Math.sqrt(sumOfSquares) || 1;
    return vector.map((value) => value / length);
}

function dot(a: Float32Array, b: Float32Array) {
    let sum = 0;
    for (const [ index, value ] of a.entries()) {
        sum += value * b[index];
    }
    return sum;
}

function addInto(target: Float32Array, vector: Float32Array) {
    for (const [ index, value ] of vector.entries()) {
        target[index] += value;
    }
}
