import { describe, expect, it } from "vitest";

import metrics from "../../src/etapi/metrics.js";

// `collectMetrics` is exercised end-to-end by etapi-metrics.spec.ts; here we lock down
// `formatPrometheusMetrics`, whose null-handling branches the live DB never produces
// (it always has notes, dates and a measurable size).
describe("etapi/metrics formatPrometheusMetrics", () => {
    const baseVersion = {
        app: "1.0.0",
        db: 228,
        node: undefined,
        sync: 1,
        buildDate: "2026-01-01",
        buildRevision: "abc123"
    };

    it("skips metrics whose value is null and statistics that are absent", () => {
        const text = metrics.formatPrometheusMetrics({
            version: baseVersion,
            database: {
                // a null count must be omitted entirely
                totalNotes: null as unknown as number,
                deletedNotes: 0,
                activeNotes: 0,
                protectedNotes: 0,
                totalAttachments: 0,
                deletedAttachments: 0,
                activeAttachments: 0,
                totalRevisions: 0,
                totalBranches: 0,
                totalAttributes: 0,
                totalBlobs: 0,
                totalEtapiTokens: 0,
                totalRecentNotes: 0
            },
            noteTypes: {},
            attachmentTypes: {},
            statistics: {
                oldestNote: null,
                newestNote: null,
                lastModified: null,
                databaseSizeBytes: null
            },
            timestamp: "2026-01-01T00:00:00.000Z"
        });

        expect(text).not.toContain("trilium_notes_total");
        expect(text).not.toContain("trilium_database_size_bytes");
        expect(text).not.toContain("trilium_oldest_note_timestamp");
        expect(text).toContain("trilium_info");
    });

    it("emits type/mime breakdowns and timestamped statistics when present", () => {
        const text = metrics.formatPrometheusMetrics({
            version: { ...baseVersion, node: "20.0.0" },
            database: {
                totalNotes: 10,
                deletedNotes: 1,
                activeNotes: 9,
                protectedNotes: 2,
                totalAttachments: 3,
                deletedAttachments: 0,
                activeAttachments: 3,
                totalRevisions: 4,
                totalBranches: 9,
                totalAttributes: 5,
                totalBlobs: 6,
                totalEtapiTokens: 1,
                totalRecentNotes: 7
            },
            noteTypes: { text: 8, code: 1 },
            attachmentTypes: { "image/png": 3 },
            statistics: {
                oldestNote: "2026-01-01T00:00:00.000Z",
                newestNote: "2026-02-01T00:00:00.000Z",
                lastModified: "2026-03-01T00:00:00.000Z",
                databaseSizeBytes: 4096
            },
            timestamp: "2026-01-01T00:00:00.000Z"
        });

        expect(text).toContain("trilium_notes_total 10");
        expect(text).toContain('trilium_notes_by_type{type="text"} 8');
        expect(text).toContain('trilium_attachments_by_type{mime_type="image/png"} 3');
        expect(text).toContain("trilium_database_size_bytes 4096");
        expect(text).toContain("trilium_oldest_note_timestamp");
        expect(text).toContain("trilium_last_modified_timestamp");
    });
});
