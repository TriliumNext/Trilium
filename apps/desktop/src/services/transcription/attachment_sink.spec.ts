import type { Transcript } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    saveAttachment: vi.fn(),
    setContent: vi.fn(),
    getContent: vi.fn(),
    transactions: 0
}));

vi.mock("@triliumnext/core", () => ({
    becca: {
        getNoteOrThrow: (noteId: string) => ({ noteId, saveAttachment: h.saveAttachment }),
        getAttachmentOrThrow: (attachmentId: string) => ({
            attachmentId, setContent: h.setContent, getContent: h.getContent
        })
    },
    binary_utils: { decodeUtf8: (content: string) => content },
    cls: { init: <T>(callback: () => T) => callback() },
    getSql: () => ({
        transactional: <T>(callback: () => T) => {
            h.transactions++;
            return callback();
        }
    })
}));
vi.mock("i18next", () => ({ t: (key: string) => key }));

const { AttachmentSink } = await import("./attachment_sink");

const STARTED_AT = Date.UTC(2026, 9, 13, 14, 30);

beforeEach(() => {
    vi.clearAllMocks();
    h.transactions = 0;
    h.saveAttachment.mockReturnValue({ attachmentId: "transcript1" });
    h.getContent.mockReturnValue("");
});

describe("AttachmentSink", () => {
    it("creates an empty transcript attachment on the meeting note when it opens", () => {
        new AttachmentSink("meeting").open(STARTED_AT);

        expect(h.saveAttachment).toHaveBeenCalledExactlyOnceWith({
            role: "transcript",
            mime: "application/json",
            title: "transcription.attachment-title",
            content: expect.any(String)
        });
        const content = JSON.parse(h.saveAttachment.mock.calls[0][0].content) as Transcript;
        expect(content).toEqual({
            version: 1, startedAt: "2026-10-13T14:30:00.000Z", utterances: []
        });
    });

    it("rewrites the whole transcript after every utterance, in a transaction each", () => {
        const sink = new AttachmentSink("meeting");
        sink.open(STARTED_AT);
        sink.write({ source: "microphone", offsetMs: 1500, text: "Can you hear me?" });
        sink.write({ source: "system", offsetMs: 3000, text: "Yes." });

        expect(h.setContent).toHaveBeenCalledTimes(2);
        const last = JSON.parse(h.setContent.mock.calls[1][0]) as Transcript;
        expect(last.utterances).toEqual([
            { source: "microphone", offsetMs: 1500, text: "Can you hear me?" },
            { source: "system", offsetMs: 3000, text: "Yes." }
        ]);
        expect(h.transactions).toBe(3);
    });

    it("keeps the speaker names stored in the attachment, which a rename writes meanwhile", () => {
        const sink = new AttachmentSink("meeting");
        sink.open(STARTED_AT);
        h.getContent.mockReturnValue(JSON.stringify({
            version: 1,
            startedAt: "2026-10-13T14:30:00.000Z",
            speakers: { "system:1": "Alexandra" },
            utterances: []
        }));
        sink.write({ source: "system", offsetMs: 3000, speaker: 1, text: "Yes." });

        const written = JSON.parse(h.setContent.mock.calls[0][0]) as Transcript;
        expect(written.speakers).toEqual({ "system:1": "Alexandra" });
        expect(written.utterances).toHaveLength(1);
    });

    it("keeps an utterance it could not save, and saves it with the next write or save()", () => {
        const sink = new AttachmentSink("meeting");
        sink.open(STARTED_AT);
        h.setContent.mockImplementationOnce(() => {
            throw new Error("protected session is not available");
        });
        expect(() => sink.write({ source: "system", offsetMs: 0, text: "First." }))
            .toThrow("protected session is not available");
        sink.write({ source: "system", offsetMs: 1000, text: "Second." });
        const saved = JSON.parse(h.setContent.mock.calls[1][0]) as Transcript;
        expect(saved.utterances.map((utterance) => utterance.text)).toEqual([ "First.", "Second." ]);

        sink.save();
        expect(h.setContent).toHaveBeenCalledTimes(3);
        expect(h.setContent.mock.calls[2][0]).toBe(h.setContent.mock.calls[1][0]);
    });

    it("renames a speaker in the names as stored, keeping every utterance, in one transaction", () => {
        const sink = new AttachmentSink("meeting");
        sink.open(STARTED_AT);
        sink.write({ source: "system", offsetMs: 0, speaker: 1, text: "Hello." });
        h.getContent.mockReturnValue(JSON.stringify({
            version: 1, startedAt: "2026-10-13T14:30:00.000Z",
            speakers: { microphone: "Elian" }, utterances: []
        }));
        const transactions = h.transactions;

        sink.renameSpeaker("system:1", " Alexandra ");
        expect(h.transactions).toBe(transactions + 1);
        const renamed = JSON.parse(h.setContent.mock.calls.at(-1)?.[0]) as Transcript;
        expect(renamed.speakers).toEqual({ microphone: "Elian", "system:1": "Alexandra" });
        expect(renamed.utterances).toHaveLength(1);
    });

    it("refuses to write before it is open", () => {
        const sink = new AttachmentSink("meeting");
        expect(() => sink.write({ source: "system", offsetMs: 0, text: "Hi" }))
            .toThrow("The transcript attachment was not created.");
        expect(() => sink.save()).toThrow("The transcript attachment was not created.");
        expect(h.setContent).not.toHaveBeenCalled();
    });
});
