import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

import { generateHelpContentIndex } from "./help_content_generator.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "help-content-"));

afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe("generateHelpContentIndex", () => {
    it("indexes HTML files by their docName path and converts them to plain text", () => {
        fs.writeFileSync(path.join(tmpRoot, "Intro.html"), "<h1>Intro</h1><p>Hello <b>World</b></p>");
        fs.mkdirSync(path.join(tmpRoot, "Guide", "Sub"), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, "Guide", "Sub", "Page.html"), "<p>Nested page</p>");
        // Non-HTML files (images, meta) are ignored.
        fs.writeFileSync(path.join(tmpRoot, "image.png"), "binary");
        fs.writeFileSync(path.join(tmpRoot, "Guide", "!!!meta.json"), "{}");

        const index = generateHelpContentIndex(tmpRoot);

        expect(Object.keys(index).sort()).toEqual(["Guide/Sub/Page", "Intro"]);
        expect(index["Intro"]).toContain("Intro");
        expect(index["Intro"]).toContain("Hello World");
        expect(index["Intro"]).not.toContain("<");
        expect(index["Guide/Sub/Page"]).toBe("Nested page");
    });
});
