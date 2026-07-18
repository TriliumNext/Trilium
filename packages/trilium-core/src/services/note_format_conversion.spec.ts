import { trimIndentation } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { getContext } from "./context.js";
import { convertNoteContent, convertNoteFormat } from "./note_format_conversion.js";
import noteService from "./notes.js";

describe("note format conversion", () => {
    it("converts an HTML text note to a Markdown code note", () => {
        const { content, type, mime } = convertNoteContent(
            "html",
            "<h1>Title</h1><p>Some <strong>bold</strong> text.</p><ul><li>one</li><li>two</li></ul>",
            "My note"
        );

        expect(type).toBe("code");
        expect(mime).toBe("text/x-markdown");
        expect(content).toBe(trimIndentation`\
            # Title

            Some **bold** text.

            *   one
            *   two`);
    });

    it("converts a Markdown code note to an HTML text note", () => {
        const { content, type, mime } = convertNoteContent(
            "markdown",
            trimIndentation`\
                # Title

                Some **bold** text.`,
            "My note"
        );

        expect(type).toBe("text");
        expect(mime).toBe("text/html");
        // Trilium reserves H1 for the note title, so top-level Markdown headings render as <h2>.
        expect(content).toContain("<h2>Title</h2>");
        expect(content).toContain("<strong>bold</strong>");
    });

    it("preserves structure across an HTML -> Markdown -> HTML round-trip", () => {
        const original = "<h2>Heading</h2><p>Paragraph with a <a href=\"https://example.com\">link</a>.</p>";

        const { content: markdown } = convertNoteContent("html", original, "title");
        const { content: html } = convertNoteContent("markdown", markdown, "title");

        expect(html).toContain("<h2>Heading</h2>");
        expect(html).toContain("<a href=\"https://example.com\">link</a>");
    });
});

describe("note format conversion (real DB)", () => {
    let counter = 0;

    function createTextNote() {
        counter++;
        return getContext().init(() =>
            noteService.createNewNote({
                parentNoteId: "root",
                title: `convert-spec-${counter}`,
                content: "<h2>Heading</h2><p>Some <strong>bold</strong> text.</p>",
                type: "text"
            }).note
        );
    }

    it("flips a text note to Markdown, saves a named revision, and converts back", () => {
        const note = createTextNote();
        const revisionsBefore = note.getRevisions().length;

        getContext().init(() => convertNoteFormat(note));

        expect(note.type).toBe("code");
        expect(note.mime).toBe("text/x-markdown");
        expect(note.getContent()).toContain("## Heading");

        const revisions = note.getRevisions();
        expect(revisions.length).toBe(revisionsBefore + 1);
        const toMarkdownRevision = revisions.at(-1);
        expect(toMarkdownRevision?.source).toBe("manual");
        expect(toMarkdownRevision?.type).toBe("text"); // captured the pre-conversion state
        const markdownDescription = toMarkdownRevision?.description;

        // Convert back to a text note.
        getContext().init(() => convertNoteFormat(note));

        expect(note.type).toBe("text");
        expect(note.mime).toBe("text/html");
        expect(note.getContent()).toContain("<h2>Heading</h2>");

        // The two directions save distinctly-named revisions.
        const textDescription = note.getRevisions().at(-1)?.description;
        expect(markdownDescription).toBeTruthy();
        expect(textDescription).toBeTruthy();
        expect(textDescription).not.toBe(markdownDescription);
    });
});
