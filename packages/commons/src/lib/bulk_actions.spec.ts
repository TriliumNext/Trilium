import { describe, expect, it } from "vitest";

import { NOTE_CONVERSION_IDS, RISKY_NOTE_CONVERSION_IDS } from "./bulk_actions.js";

describe("note conversion ids", () => {
    it("keeps the risky list a subset of the declared conversions", () => {
        // The two lists are maintained by hand and consumed in different places — the client
        // builds its combo box from NOTE_CONVERSION_IDS, while RISKY_NOTE_CONVERSION_IDS only
        // decides which of those gets the stronger confirmation prompt. A typo'd or stale entry
        // in the risky list would silently downgrade that prompt to the mild one.
        for (const id of RISKY_NOTE_CONVERSION_IDS) {
            expect(NOTE_CONVERSION_IDS).toContain(id);
        }

        expect(new Set(NOTE_CONVERSION_IDS).size).toBe(NOTE_CONVERSION_IDS.length);
        expect(new Set(RISKY_NOTE_CONVERSION_IDS).size).toBe(RISKY_NOTE_CONVERSION_IDS.length);
    });

    it("marks html-to-markdown as lossy and markdown-to-html as safe", () => {
        // HTML carries formatting Markdown cannot represent, so that direction drops content;
        // the reverse only ever gains structure.
        expect(RISKY_NOTE_CONVERSION_IDS).toContain("htmlToMarkdown");
        expect(RISKY_NOTE_CONVERSION_IDS).not.toContain("markdownToHtml");
    });
});
