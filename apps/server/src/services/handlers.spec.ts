import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module-under-test import) ---

type Listener = (data: { entityName: string; entity: any }) => void;
const listeners: Record<string, Listener[]> = {};

const mockEvents = {
    ENTITY_CREATED: "ENTITY_CREATED",
    subscribe: vi.fn((eventType: string, listener: Listener) => {
        (listeners[eventType] ||= []).push(listener);
    }),
    emit: (eventType: string, data: any) => {
        for (const l of listeners[eventType] || []) {
            l(data);
        }
    }
};

const mockLog = { info: vi.fn(), error: vi.fn() };
const mockOptions = { getOptionBool: vi.fn() };
const mockOcrService = {
    getAllSupportedMimeTypes: vi.fn(() => ["image/png", "application/pdf"]),
    processNoteOCR: vi.fn(),
    processAttachmentOCR: vi.fn()
};

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        events: mockEvents,
        getLog: () => mockLog,
        options: mockOptions
    };
});

vi.mock("./ocr/ocr_service", () => ({ default: mockOcrService }));

const { registerOcrHandlers } = await import("./handlers.js");

/** Flush queued microtasks so the .then/.catch of autoProcessOCR runs. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function emitCreated(entityName: string, entity: any) {
    mockEvents.emit("ENTITY_CREATED", { entityName, entity });
}

beforeEach(() => {
    for (const key of Object.keys(listeners)) delete listeners[key];
    vi.clearAllMocks();
    mockOptions.getOptionBool.mockReturnValue(true);
    mockOcrService.getAllSupportedMimeTypes.mockReturnValue(["image/png", "application/pdf"]);
    mockOcrService.processNoteOCR.mockResolvedValue(null);
    mockOcrService.processAttachmentOCR.mockResolvedValue(null);
    registerOcrHandlers();
});

afterEach(() => vi.restoreAllMocks());

describe("registerOcrHandlers", () => {
    it("subscribes to ENTITY_CREATED once", () => {
        expect(mockEvents.subscribe).toHaveBeenCalledWith("ENTITY_CREATED", expect.any(Function));
    });

    describe("file notes", () => {
        it("processes a supported file note and logs success when a result is returned", async () => {
            mockOcrService.processNoteOCR.mockResolvedValue({ text: "ok" });
            emitCreated("notes", { type: "file", mime: "application/pdf", noteId: "n1" });
            await flush();

            expect(mockOcrService.processNoteOCR).toHaveBeenCalledWith("n1");
            expect(mockLog.info).toHaveBeenCalled();
        });

        it("processes but does not log success when the result is falsy", async () => {
            mockOcrService.processNoteOCR.mockResolvedValue(null);
            emitCreated("notes", { type: "file", mime: "application/pdf", noteId: "n2" });
            await flush();

            expect(mockOcrService.processNoteOCR).toHaveBeenCalled();
            expect(mockLog.info).not.toHaveBeenCalled();
        });

        it("logs an error when processing rejects", async () => {
            mockOcrService.processNoteOCR.mockRejectedValue(new Error("boom"));
            emitCreated("notes", { type: "file", mime: "application/pdf", noteId: "n3" });
            await flush();

            expect(mockLog.error).toHaveBeenCalled();
        });

        it("does not process when the option is disabled", () => {
            mockOptions.getOptionBool.mockReturnValue(false);
            emitCreated("notes", { type: "file", mime: "application/pdf", noteId: "n4" });

            expect(mockOcrService.processNoteOCR).not.toHaveBeenCalled();
        });

        it("does not process non-file note types", () => {
            emitCreated("notes", { type: "image", mime: "image/png", noteId: "n5" });

            expect(mockOcrService.processNoteOCR).not.toHaveBeenCalled();
        });

        it("does not process a file note with an unsupported mime", async () => {
            emitCreated("notes", { type: "file", mime: "text/plain", noteId: "n6" });
            await flush();

            expect(mockOcrService.processNoteOCR).not.toHaveBeenCalled();
            expect(mockLog.info).not.toHaveBeenCalled();
        });
    });

    describe("file attachments", () => {
        it("processes a supported file attachment", async () => {
            mockOcrService.processAttachmentOCR.mockResolvedValue({ text: "ok" });
            emitCreated("attachments", { role: "file", mime: "image/png", attachmentId: "a1" });
            await flush();

            expect(mockOcrService.processAttachmentOCR).toHaveBeenCalledWith("a1");
            expect(mockLog.info).toHaveBeenCalled();
        });

        it("ignores non-file attachment roles", () => {
            emitCreated("attachments", { role: "image", mime: "image/png", attachmentId: "a2" });

            expect(mockOcrService.processAttachmentOCR).not.toHaveBeenCalled();
        });

        it("does not process when the option is disabled", () => {
            mockOptions.getOptionBool.mockReturnValue(false);
            emitCreated("attachments", { role: "file", mime: "image/png", attachmentId: "a3" });

            expect(mockOcrService.processAttachmentOCR).not.toHaveBeenCalled();
        });
    });

    it("ignores unrelated entity types", () => {
        emitCreated("branches", { branchId: "b1" });

        expect(mockOcrService.processNoteOCR).not.toHaveBeenCalled();
        expect(mockOcrService.processAttachmentOCR).not.toHaveBeenCalled();
    });
});
