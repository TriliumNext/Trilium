import { describe, expect, it, vi, beforeEach } from "vitest";
import ocrRoutes from "./ocr.js";

// Mock the OCR service
vi.mock("../../services/ocr/ocr_service.js", () => ({
    default: {
        isOCREnabled: vi.fn(() => true),
        startBatchProcessing: vi.fn(() => Promise.resolve({ success: true })),
        getBatchProgress: vi.fn(() => ({ inProgress: false, total: 0, processed: 0 }))
    }
}));

// Mock becca
vi.mock("../../becca/becca.js", () => ({
    default: {}
}));

// Mock log
vi.mock("../../services/log.js", () => ({
    default: {
        error: vi.fn()
    }
}));

describe("OCR API", () => {
    let mockRequest: any;
    let mockResponse: any;

    beforeEach(() => {
        mockRequest = {
            params: {},
            body: {},
            query: {}
        };

        mockResponse = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            triliumResponseHandled: false
        };
    });

    it("should set triliumResponseHandled flag in batch processing", async () => {
        await ocrRoutes.batchProcessOCR(mockRequest, mockResponse);

        expect(mockResponse.json).toHaveBeenCalledWith({ success: true });
        expect(mockResponse.triliumResponseHandled).toBe(true);
    });

    it("should set triliumResponseHandled flag in get batch progress", async () => {
        await ocrRoutes.getBatchProgress(mockRequest, mockResponse);

        expect(mockResponse.json).toHaveBeenCalledWith({ 
            inProgress: false, 
            total: 0, 
            processed: 0 
        });
        expect(mockResponse.triliumResponseHandled).toBe(true);
    });

    it("should handle errors and set triliumResponseHandled flag", async () => {
        // Mock service to throw error
        const ocrService = await import("../../services/ocr/ocr_service.js");
        vi.mocked(ocrService.default.startBatchProcessing).mockRejectedValueOnce(new Error("Test error"));

        await ocrRoutes.batchProcessOCR(mockRequest, mockResponse);

        expect(mockResponse.status).toHaveBeenCalledWith(500);
        expect(mockResponse.json).toHaveBeenCalledWith({
            success: false,
            error: "Test error"
        });
        expect(mockResponse.triliumResponseHandled).toBe(true);
    });
});