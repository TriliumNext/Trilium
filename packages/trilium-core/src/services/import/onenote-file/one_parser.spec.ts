import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import { type OneContentFile, type OneContentText, parseOneSection } from "./one_parser.js";

const dir = dirname(fileURLToPath(import.meta.url));

/**
 * The fixture is a small OneNote desktop section file from the msiemens/onenote.rs test corpus
 * (MPL-2.0), used here only to exercise the from-scratch binary parser.
 */
function loadFixture(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(join(dir, "fixtures", name)));
}

describe("parseOneSection", () => {
    it("extracts the page hierarchy, titles and body text from a desktop .one section", () => {
        const section = parseOneSection(loadFixture("onenote_desktop.one"));

        expect(section.pages).toHaveLength(3);
        expect(section.pages[0].title).toContain("Test");

        const firstPageText = section.pages[0].content.filter((c): c is OneContentText => c.kind === "text").map((c) => c.text);
        expect(firstPageText).toContain("This notebook should have three pages.");
        // UTF-16 text is decoded (the page has a mix of runs).
        expect(firstPageText).toContain("3+3=6");
    });

    it("extracts an embedded image as raw bytes with its filename", () => {
        const section = parseOneSection(loadFixture("onenote_desktop.one"));
        const files = section.pages.flatMap((p) => p.content).filter((c): c is OneContentFile => c.kind === "file");

        const png = files.find((f) => f.name.toLowerCase().endsWith(".png"));
        expect(png).toBeTruthy();
        expect(png?.bytes.length).toBeGreaterThan(0);
        // PNG signature: the first bytes are the PNG magic.
        expect(png?.bytes[0]).toBe(0x89);
        expect(png?.bytes[1]).toBe(0x50); // 'P'
    });

    it("rejects a non-revision-store (OneDrive/FSSHTTPB) file with a clear error", () => {
        // A file whose header format GUID isn't the desktop revision store must not be parsed as one.
        const fake = new Uint8Array(1024);
        expect(() => parseOneSection(fake)).toThrow();
    });
});
