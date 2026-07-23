import { describe, expect, it } from "vitest";

import { formatDuration, formatSize, type ImportReportData, renderImportReport } from "./report.js";

/** A successful import's report data; tests override the aspect they exercise. */
function reportData(overrides: Partial<ImportReportData> = {}): ImportReportData {
    return {
        importedPageCount: 12,
        notebookCount: 1,
        sectionCount: 2,
        durationMs: 90_000,
        imageCount: 4,
        imageBytes: 2 * 1024 * 1024,
        attachmentCount: 1,
        attachmentBytes: 512,
        inkPageCount: 3,
        resolvedLinkCount: 5,
        unresolvedLinkCount: 1,
        throttledRequestCount: 7,
        throttleWaitMs: 3 * 60_000,
        failedPages: [],
        failedResources: [],
        ...overrides
    };
}

describe("formatDuration", () => {
    it("scales units with the magnitude", () => {
        expect(formatDuration(42_000)).toBe("42s");
        expect(formatDuration(5 * 60_000 + 3_000)).toBe("5m 3s");
        expect(formatDuration(2 * 3_600_000 + 41 * 60_000)).toBe("2h 41m");
        expect(formatDuration(0)).toBe("0s");
    });
});

describe("formatSize", () => {
    it("scales units with the magnitude", () => {
        expect(formatSize(512)).toBe("512 B");
        expect(formatSize(1_536)).toBe("1.5 KiB");
        expect(formatSize(12 * 1024)).toBe("12 KiB");
        expect(formatSize(2 * 1024 * 1024)).toBe("2 MiB");
    });
});

describe("renderImportReport", () => {
    it("summarizes a fully successful import as a heading-column table without failure sections", () => {
        const html = renderImportReport(reportData());

        expect(html).toContain('<tr><th scope="row">Pages imported successfully</th><td>12/12 (100%)</td></tr>');
        expect(html).toContain('<tr><th scope="row">Notebooks imported</th><td>1</td></tr>');
        expect(html).toContain('<tr><th scope="row">Sections imported</th><td>2</td></tr>');
        expect(html).toContain('<tr><th scope="row">Total import duration</th><td>1m 30s</td></tr>');
        expect(html).toContain('<tr><th scope="row">Images</th><td>4 (2 MiB)</td></tr>');
        expect(html).toContain('<tr><th scope="row">File attachments</th><td>1 (512 B)</td></tr>');
        expect(html).toContain('<tr><th scope="row">Pages with handwriting or drawings</th><td>3</td></tr>');
        expect(html).toContain('<tr><th scope="row">Cross-page links</th><td>5 resolved, 1 pointing outside the imported selection</td></tr>');
        expect(html).toContain('<tr><th scope="row">Time throttled by Microsoft Graph</th><td>3m 0s (7 throttled requests)</td></tr>');
        expect(html).toContain('<figure class="table">');
        expect(html).not.toContain("could not be imported");
        expect(html).not.toContain("could not be downloaded");
    });

    it("omits zero-valued rows from the summary table", () => {
        const html = renderImportReport(reportData({
            imageCount: 0,
            imageBytes: 0,
            attachmentCount: 0,
            attachmentBytes: 0,
            inkPageCount: 0,
            resolvedLinkCount: 0,
            unresolvedLinkCount: 0,
            throttledRequestCount: 0,
            throttleWaitMs: 0
        }));

        expect(html).toContain("Pages imported successfully");
        expect(html).toContain("Total import duration");
        expect(html).not.toContain("Images");
        expect(html).not.toContain("File attachments");
        expect(html).not.toContain("handwriting");
        expect(html).not.toContain("Cross-page links");
        expect(html).not.toContain("throttled");
    });

    it("lists failed pages with reference links and escaped titles/errors", () => {
        const html = renderImportReport(reportData({
            importedPageCount: 10,
            failedPages: [
                { title: "Meeting <notes>", sectionTitle: "Work & Archive", noteId: "ph1", error: "HTTP 504" },
                { title: "Recipes", sectionTitle: "Kitchen", noteId: "ph2", error: "HTTP 504" }
            ]
        }));

        // 10 of 12 pages: the percentage is floored so a lossy import never rounds up to 100%.
        expect(html).toContain('<tr><th scope="row">Pages imported successfully</th><td>10/12 (83%)</td></tr>');
        expect(html).toContain("Pages that could not be imported");
        expect(html).toContain('<a class="reference-link" href="#root/ph1">Meeting &lt;notes&gt;</a>');
        expect(html).toContain("Work &amp; Archive");
        expect(html).toContain("HTTP 504");
    });

    it("lists pages with failed resource downloads, with per-page counts", () => {
        const html = renderImportReport(reportData({
            failedResources: [
                { pageTitle: "Gallery", pageNoteId: "n1", failedCount: 3 },
                { pageTitle: "Scans", pageNoteId: "n2", failedCount: 1 }
            ]
        }));

        expect(html).toContain("Missing images and attachments");
        expect(html).toContain('<a class="reference-link" href="#root/n1">Gallery</a>: 3 resources could not be downloaded');
        expect(html).toContain('<a class="reference-link" href="#root/n2">Scans</a>: 1 resource could not be downloaded');
    });
});
