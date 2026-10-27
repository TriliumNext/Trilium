import { describe, expect, it } from "vitest";

import {
    cleanUtteranceText, getSpeakerKey, getTranscriptionModel, getTranscriptionResources,
    markDisfluencies, MAX_SPEAKER_NAME_LENGTH, parseTranscript, setSpeakerName,
    type Transcript
} from "./transcript.js";

const TRANSCRIPT: Transcript = {
    version: 1,
    startedAt: "2026-10-14T09:30:00.000Z",
    utterances: [ { source: "system", offsetMs: 0, speaker: 2, text: "Hi." } ]
};

describe("transcript", () => {
    it("reads only version 1 transcripts", () => {
        expect(parseTranscript(JSON.stringify(TRANSCRIPT))).toEqual(TRANSCRIPT);
        expect(parseTranscript(null)).toBeNull();
        expect(parseTranscript("")).toBeNull();
        expect(parseTranscript("not json")).toBeNull();
        expect(parseTranscript(JSON.stringify({ version: 2, utterances: [] }))).toBeNull();
        expect(parseTranscript(JSON.stringify({ version: 1 }))).toBeNull();
    });

    it("keys the local speaker and identified system speakers, not unidentified speech", () => {
        expect(getSpeakerKey("microphone")).toBe("microphone");
        expect(getSpeakerKey("microphone", 3)).toBe("microphone");
        expect(getSpeakerKey("system", 2)).toBe("system:2");
        expect(getSpeakerKey("system")).toBeNull();
    });

    it("names a speaker, trims and caps the name, and forgets it when blank", () => {
        const named = setSpeakerName(TRANSCRIPT, "system:2", "  Alexandra ");
        expect(named.speakers).toEqual({ "system:2": "Alexandra" });
        expect(named.utterances).toBe(TRANSCRIPT.utterances);
        expect(TRANSCRIPT.speakers).toBeUndefined();

        const both = setSpeakerName(named, "microphone", "x".repeat(MAX_SPEAKER_NAME_LENGTH + 5));
        expect(both.speakers?.microphone).toHaveLength(MAX_SPEAKER_NAME_LENGTH);
        expect(setSpeakerName(both, "system:2", " ").speakers).toEqual({
            microphone: "x".repeat(MAX_SPEAKER_NAME_LENGTH)
        });
    });

    it("removes filler words, keeping the sentence ends and capitals they carried", () => {
        expect(cleanUtteranceText("Uh the data is a bit old.")).toBe("The data is a bit old.");
        expect(cleanUtteranceText("a good point, uh, because uh.")).toBe("a good point, because.");
        expect(cleanUtteranceText("So okay. um so we can go")).toBe("So okay. So we can go");
        expect(cleanUtteranceText("Oh, okay. Hmm, sure.")).toBe("Oh, okay. Hmm, sure.");
        expect(cleanUtteranceText("Uh.")).toBe("");
    });

    it("collapses stutters and restarts, an abandoned word's first letter included", () => {
        expect(cleanUtteranceText("So the the that's a point")).toBe("So the that's a point");
        expect(cleanUtteranceText("we have the uh the memory")).toBe("we have the memory");
        expect(cleanUtteranceText("that was on the on the board")).toBe("that was on the board");
        expect(cleanUtteranceText("I wanted to to to share")).toBe("I wanted to share");
        expect(cleanUtteranceText("Because it's d as you can see")).toBe("Because it's as you can see");
        expect(cleanUtteranceText("probably compare it")).toBe("probably compare it");
    });

    it("keeps meant repeats: numbers, emphasis, commas, grammatical doubles, acronyms", () => {
        for (const meant of [
            "Two two forty, five five fifty.",
            "Okay, okay, okay. Yes yes.",
            "I know, I know.",
            "to check this, this, this, this.",
            "something like that that has a lot",
            "You do it it doesn't grow",
            "the S D K and a PV2"
        ]) {
            expect(cleanUtteranceText(meant)).toBe(meant);
        }
    });

    it("marks the words the cleanup removes, keeping every word as it was said", () => {
        const marked = (text: string) => markDisfluencies(text)
            .map(({ text, isDisfluency }) => isDisfluency ? `[${text}]` : text)
            .join(" ");
        expect(marked("Uh the data is a bit old.")).toBe("[Uh] the data is a bit old.");
        expect(marked("a good point, uh, because uh.")).toBe("a good point, [uh,] because [uh.]");
        expect(marked("we have the uh the memory")).toBe("we have [the] [uh] the memory");
        expect(marked("that was on the on the board")).toBe("that was [on] [the] on the board");
        expect(marked("Because it's d as you can see")).toBe("Because it's [d] as you can see");
        expect(marked("I know, I know.")).toBe("I know, I know.");
        expect(marked("Uh.")).toBe("[Uh.]");
        expect(markDisfluencies("  ")).toEqual([]);
    });

    it("matches words through the punctuation around them, in time linear in their length", () => {
        expect(cleanUtteranceText("So “uh” (um) we’re we're done")).toBe("So we're done");
        expect(cleanUtteranceText("And (the) the plan")).toBe("And the plan");

        const punctuated = `a${"&".repeat(100_000)}a`;
        const startedAt = performance.now();
        expect(cleanUtteranceText(punctuated)).toBe(punctuated);
        expect(performance.now() - startedAt).toBeLessThan(250);
    });
});

describe("transcription models", () => {
    it("resolves the selected model, and an unknown or missing one to the int8 model", () => {
        expect(getTranscriptionModel("parakeet-fp32"))
            .toEqual({ id: "parakeet-fp32", resourceId: "transcription.parakeet-fp32", precision: "fp32" });
        expect(getTranscriptionModel("parakeet-int8"))
            .toEqual({ id: "parakeet-int8", resourceId: "transcription.parakeet", precision: "int8" });
        expect(getTranscriptionModel("whisper").id).toBe("parakeet-int8");
        expect(getTranscriptionModel(null).id).toBe("parakeet-int8");
        expect(getTranscriptionModel("toString").id).toBe("parakeet-int8");
    });

    it("needs the selected recognizer, the VAD and, to identify speakers, the speaker model", () => {
        expect(getTranscriptionResources("parakeet-fp32", true))
            .toEqual([ "transcription.parakeet-fp32", "transcription.silero-vad", "transcription.titanet" ]);
        expect(getTranscriptionResources(undefined, true))
            .toEqual([ "transcription.parakeet", "transcription.silero-vad", "transcription.titanet" ]);
        expect(getTranscriptionResources("parakeet-int8", false))
            .toEqual([ "transcription.parakeet", "transcription.silero-vad" ]);
    });
});
