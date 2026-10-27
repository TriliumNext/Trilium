/**
 * Where an utterance was heard: the local speaker's microphone, or everyone else on the system
 * output.
 */
export type TranscriptSource = "microphone" | "system";

/** One transcribed stretch of speech. */
export interface TranscriptUtterance {
    source: TranscriptSource;
    /** Milliseconds from the start of the recording to the start of the utterance. */
    offsetMs: number;
    /** Length of the utterance in milliseconds. Absent from transcripts recorded before it was kept. */
    durationMs?: number;
    /**
     * Who spoke, numbered from 1 within the source in the order the speakers were first heard.
     * Absent when the speaker could not be told, and on the microphone.
     */
    speaker?: number;
    text: string;
}

/**
 * The content of a `transcript` attachment: a meeting recording as it is transcribed. The recording
 * rewrites it after every utterance.
 */
export interface Transcript {
    version: 1;
    /** When the recording started, as an ISO 8601 timestamp; the offsets count from here. */
    startedAt: string;
    /**
     * Names given to speakers, by {@link getSpeakerKey}. A speaker without one keeps its default
     * name.
     */
    speakers?: Record<string, string>;
    utterances: TranscriptUtterance[];
}

export const TRANSCRIPT_MIME = "application/json";

/** The longest speaker name a transcript accepts. */
export const MAX_SPEAKER_NAME_LENGTH = 100;

/** The resources every recording needs besides its recognizer, defined in the desktop app. */
export const TRANSCRIPTION_RESOURCES = {
    vad: "transcription.silero-vad",
    speaker: "transcription.titanet"
} as const;

/** `fp32` is a full-precision model, `int8` a quantized one: smaller, faster and less accurate. */
export type TranscriptionPrecision = "fp32" | "int8";

/** A speech recognition model the `transcriptionModel` option can select. */
export interface TranscriptionModel {
    id: string;
    /** The resource holding the model's files. */
    resourceId: string;
    precision: TranscriptionPrecision;
}

/** The selectable models, by ID: both are Parakeet TDT 0.6B v3, for 25 European languages. */
export const TRANSCRIPTION_MODELS = {
    "parakeet-int8": { id: "parakeet-int8", resourceId: "transcription.parakeet", precision: "int8" },
    "parakeet-fp32": { id: "parakeet-fp32", resourceId: "transcription.parakeet-fp32", precision: "fp32" }
} as const satisfies Record<string, TranscriptionModel>;

export type TranscriptionModelId = keyof typeof TRANSCRIPTION_MODELS;

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId = "parakeet-int8";

/** Returns the model `id` names, or the default model when `id` names none. */
export function getTranscriptionModel(id: string | null | undefined): TranscriptionModel {
    return Object.hasOwn(TRANSCRIPTION_MODELS, id ?? "")
        ? TRANSCRIPTION_MODELS[id as TranscriptionModelId]
        : TRANSCRIPTION_MODELS[DEFAULT_TRANSCRIPTION_MODEL];
}

/**
 * Returns the resources a recording with the model `modelId` needs: the speaker model only when it
 * identifies speakers.
 */
export function getTranscriptionResources(modelId: string | null | undefined, identifySpeakers: boolean) {
    return [
        getTranscriptionModel(modelId).resourceId,
        TRANSCRIPTION_RESOURCES.vad,
        ...(identifySpeakers ? [ TRANSCRIPTION_RESOURCES.speaker ] : [])
    ];
}

/** Reads a transcript attachment's content, or returns `null` for content of another shape. */
export function parseTranscript(content: string | null | undefined): Transcript | null {
    if (!content) {
        return null;
    }

    try {
        const parsed = JSON.parse(content) as Partial<Transcript>;
        const isTranscript = parsed.version === 1 && Array.isArray(parsed.utterances);
        return isTranscript ? parsed as Transcript : null;
    } catch {
        return null;
    }
}

/**
 * The key a speaker's name is stored under: `microphone` for the local speaker, `system:<n>` for
 * an identified speaker of the system output, and `null` for system speech no speaker was found
 * for, which can be anyone.
 */
export function getSpeakerKey(source: TranscriptSource, speaker?: number) {
    if (source === "microphone") {
        return "microphone";
    }
    return speaker === undefined ? null : `system:${speaker}`;
}

/** Hesitations removed by {@link cleanUtteranceText}. "oh" and "hmm" carry meaning and stay. */
const FILLER_WORDS = new Set([ "uh", "um", "uhm", "er", "erm", "ah", "eh" ]);

/** English words a speaker stutters on. A repeat of any other word is kept. */
const STUTTER_WORDS = new Set([
    "the", "a", "an", "i", "to", "we", "you", "it", "it's", "that", "this", "on", "in", "and",
    "so", "he", "she", "they", "is", "of", "for", "with", "at", "but", "if", "my", "our", "your",
    "their", "be", "are", "was", "can", "will", "do", "have", "has", "what", "how", "when",
    "where", "i'm", "we're", "you're", "there", "then", "or", "as", "by", "from", "his", "her",
    "its", "me", "us"
]);

/** Stutter words that are often grammatical when doubled ("like that that has"). */
const GRAMMATICAL_DOUBLES = new Set([ "that", "it" ]);

/** The longest repeated phrase that {@link cleanUtteranceText} collapses, in words. */
const MAX_RESTART_WORDS = 3;

const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;

/** Characters {@link toKey} keeps at the end of a word, as in "goin'" or "well-". */
const KEPT_AT_END = "'-";

const NUMBER_WORD = /^(\d|zero$|one$|two$|three$|four$|five$|six$|seven$|eight$|nine$|ten$)/;

/** A word of an utterance as said, and whether {@link cleanUtteranceText} removes it. */
export interface MarkedWord {
    text: string;
    isDisfluency: boolean;
}

interface Word {
    /** The word as the cleaned text shows it, which can take a removed filler's sentence end. */
    text: string;
    /** The word as said. */
    said: string;
    /** The word lowercased, without surrounding punctuation. */
    key: string;
    isDisfluency: boolean;
}

/**
 * Removes disfluencies from the text of one utterance: filler words ("uh", "um"), lowercase
 * single-letter fragments of an abandoned word, and restarts, an immediate repeat of one to three
 * words that begins with a stutter word ("the the", "on the on the"). Numbers ("two two forty"),
 * repeats separated by a comma ("I know, I know") and other repeated words ("okay okay") are kept.
 * Returns an empty string when nothing but disfluencies was said.
 */
export function cleanUtteranceText(text: string): string {
    const startsCapitalized = /^\p{Lu}/u.test(text);
    const words = findDisfluencies(text).filter((word) => !word.isDisfluency);

    let cleaned = words.map((word) => word.text).join(" ")
        .replace(/^[,;:]\s*/, "")
        .replace(/,(\s*[,.?!])/g, "$1")
        .replace(/([.?!]\s+)(\p{Ll})/gu, (_, end: string, letter: string) => end + letter.toUpperCase());
    if (startsCapitalized) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
}

/**
 * Splits the text of one utterance into its words as said, marking the ones
 * {@link cleanUtteranceText} removes.
 */
export function markDisfluencies(text: string): MarkedWord[] {
    return findDisfluencies(text)
        .map(({ said, isDisfluency }) => ({ text: said, isDisfluency }));
}

/** Marks the disfluencies of `text`, in the order {@link cleanUtteranceText} documents. */
function findDisfluencies(text: string) {
    const words: Word[] = text.split(/\s+/).filter(Boolean)
        .map((word) => ({ text: word, said: word, key: toKey(word), isDisfluency: false }));

    const kept = markFillers(words)
        .filter((word) => {
            word.isDisfluency = /^[b-hj-z][,.]?$/.test(word.text);
            return !word.isDisfluency;
        });
    markRestarts(kept);
    return words;
}

/**
 * Names the speaker of `key`, or gives back its default name when `name` is blank. Returns a new
 * transcript; the utterances are shared.
 */
export function setSpeakerName(transcript: Transcript, key: string, name: string): Transcript {
    const speakers = { ...transcript.speakers };
    delete speakers[key];
    const trimmed = name.trim().slice(0, MAX_SPEAKER_NAME_LENGTH);
    if (trimmed) {
        speakers[key] = trimmed;
    }
    return { ...transcript, speakers };
}

/**
 * Marks filler words, and returns the others; the sentence end a filler carried ("…because uh.")
 * moves to the word before.
 */
function markFillers(words: Word[]) {
    const kept: Word[] = [];
    for (const word of words) {
        if (!FILLER_WORDS.has(word.key)) {
            kept.push(word);
            continue;
        }
        word.isDisfluency = true;
        const sentenceEnd = /[.?!]$/.exec(word.text)?.[0];
        const previous = kept.at(-1);
        if (sentenceEnd && previous && !/[.?!]$/.test(previous.text)) {
            previous.text = previous.text.replace(/[,;:]$/, "") + sentenceEnd;
        }
    }
    return kept;
}

/** Marks the first copy of each immediately repeated phrase, longest phrases first. */
function markRestarts(words: Word[]) {
    for (let size = MAX_RESTART_WORDS; size >= 1; size--) {
        let start = 0;
        while (start + 2 * size <= words.length) {
            if (isRestart(words, start, size)) {
                for (const word of words.splice(start, size)) {
                    word.isDisfluency = true;
                }
            } else {
                start++;
            }
        }
    }
}

function isRestart(words: Word[], start: number, size: number) {
    const first = words.slice(start, start + size);
    const second = words.slice(start + size, start + 2 * size);
    const lastOfFirst = first[first.length - 1];
    return STUTTER_WORDS.has(first[0].key)
        && !(size === 1 && GRAMMATICAL_DOUBLES.has(first[0].key))
        && !first.some((word) => NUMBER_WORD.test(word.key))
        && !/[,;:.?!]$/.test(lastOfFirst.text)
        && first.every((word, index) => word.key === second[index].key);
}

/** Lowercases `word` and trims the punctuation around it, keeping a trailing `'` or `-`. */
function toKey(word: string) {
    const chars = [ ...word.toLowerCase().replace(/’/g, "'") ];
    let start = 0;
    let end = chars.length;
    while (start < end && !LETTER_OR_DIGIT.test(chars[start])) {
        start++;
    }
    while (end > start && !LETTER_OR_DIGIT.test(chars[end - 1])
        && !KEPT_AT_END.includes(chars[end - 1])) {
        end--;
    }
    return chars.slice(start, end).join("");
}
