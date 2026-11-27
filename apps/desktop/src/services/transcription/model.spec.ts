import { describe, expect, it, vi } from "vitest";

vi.mock("i18next", () => ({ t: (key: string) => `t:${key}` }));
vi.mock("@triliumnext/server/src/services/resources.js", () => ({
    default: { getPath: () => null }
}));

import { RECOGNIZER_MODELS, SPEAKER_MODEL, TRANSCRIPTION_MODELS, VAD_MODEL } from "./model";

describe("transcription models", () => {
    it("translates each model's title and description lazily", () => {
        const [ int8, fp32 ] = RECOGNIZER_MODELS;
        expect([ int8.title(), int8.description() ]).toEqual([
            "t:transcription.recognizer-int8-title", "t:transcription.recognizer-description"
        ]);
        expect([ fp32.title(), fp32.description() ]).toEqual([
            "t:transcription.recognizer-fp32-title", "t:transcription.recognizer-description"
        ]);
        expect([ VAD_MODEL.title(), VAD_MODEL.description() ]).toEqual([
            "t:transcription.vad-title", "t:transcription.vad-description"
        ]);
        expect([ SPEAKER_MODEL.title(), SPEAKER_MODEL.description() ]).toEqual([
            "t:transcription.speaker-title", "t:transcription.speaker-description"
        ]);
        expect(TRANSCRIPTION_MODELS.map((model) => model.id))
            .toEqual([ int8.id, fp32.id, VAD_MODEL.id, SPEAKER_MODEL.id ]);
    });
});
