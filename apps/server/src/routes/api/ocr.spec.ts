import { describe, expect, it, vi, beforeEach } from "vitest";
import ocrRoutes from "./ocr.js";

// Mock the OCR service
vi.mock("../../services/ocr/ocr_service.js", () => ({
    default: {
        startBatchProcessing: vi.fn(() => Promise.resolve({ success: true })),
        getBatchProgress: vi.fn(() => ({ inProgress: false, total: 0, processed: 0 }))
    }
}));

// Mock becca
vi.mock("../../becca/becca.js", () => ({
    default: {}
}));

// Mock sql
vi.mock("../../services/sql.js", () => ({
    default: {
        getRow: vi.fn()
    }
}));

// Mock log
vi.mock("../../services/log.js", () => ({
    default: {
        error: vi.fn()
    }
}));

describe("OCR API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return success for batch processing", async () => {
        const result = await ocrRoutes.batchProcessOCR();
        expect(result).toEqual({ success: true });
    });

    it("should return batch progress", async () => {
        const result = await ocrRoutes.getBatchProgress();
        expect(result).toEqual({ inProgress: false, total: 0, processed: 0 });
    });

    it("should return 400 when batch processing fails", async () => {
        const ocrService = await import("../../services/ocr/ocr_service.js");
        vi.mocked(ocrService.default.startBatchProcessing).mockResolvedValueOnce({
            success: false,
            message: "No images found that need OCR processing"
        });

        const result = await ocrRoutes.batchProcessOCR();
        expect(result).toEqual([400, { success: false, message: "No images found that need OCR processing" }]);
    });
});
