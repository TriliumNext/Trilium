import { describe, expect, it } from "vitest";

import { parseNote } from "./importer.js";

describe("Google Keep importer — parseNote", () => {
    it("parses a titled plain-text note: title, paragraphs and original timestamps", () => {
        const json = JSON.stringify({
            title: "Asdf",
            textContent: "Hi there. ",
            createdTimestampUsec: 1763069966429000,
            userEditedTimestampUsec: 1763069966429000
        });

        const note = parseNote("Asdf.json", json);

        expect(note).toEqual({
            title: "Asdf",
            content: "<p>Hi there. </p>",
            attachments: [],
            utcDateCreated: "2025-11-13 21:39:26.429Z",
            utcDateModified: "2025-11-13 21:39:26.429Z"
        });
    });

    it("derives a readable local-time title from the timestamp filename for an untitled note", () => {
        const json = JSON.stringify({ title: "", textContent: "Dsaa" });

        const note = parseNote("2025-11-13T23_39_37.236+02_00.json", json);

        // Reformatted to local wall-clock time (the offset is already baked into the filename).
        expect(note?.title).toBe("2025-11-13 23:39:37");
    });

    it("uses a non-timestamp filename as-is for the title", () => {
        const note = parseNote("Shopping list.json", JSON.stringify({ title: "", textContent: "milk" }));

        expect(note?.title).toBe("Shopping list");
    });

    it("renders a multi-line body as one paragraph per line, escaping HTML", () => {
        const json = JSON.stringify({ textContent: "Heading 1\nHeading 2\nBold & <b>italic</b>" });

        const note = parseNote("note.json", json);

        expect(note?.content).toBe("<p>Heading 1</p><p>Heading 2</p><p>Bold &amp; &lt;b&gt;italic&lt;/b&gt;</p>");
    });

    it("renders a checklist as a CKEditor task list with checked state, skipping empty items", () => {
        const json = JSON.stringify({
            listContent: [
                { text: "This is a note with", isChecked: false },
                { text: "check", isChecked: true },
                { text: "", isChecked: false }
            ]
        });

        const note = parseNote("list.json", json);

        expect(note?.content).toBe(
            `<ul class="todo-list">` +
                `<li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">This is a note with</span></label></li>` +
                `<li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">check</span></label></li>` +
                `</ul>`
        );
    });

    it("prefers the rich-text body, converting basic formatting (textContentHtml over textContent)", () => {
        const json = JSON.stringify({
            textContent: "Bold",
            textContentHtml: `<p dir="ltr" style="line-height:1.38;"><span style="font-weight:700;">Bold</span></p>`
        });

        const note = parseNote("note.json", json);

        expect(note?.content).toBe("<p><strong>Bold</strong></p>");
    });

    it("keeps a checklist item that has only rich text (textHtml, no plain text field)", () => {
        const json = JSON.stringify({
            listContent: [{ textHtml: `<p><span style="font-weight:700;">bold item</span></p>`, isChecked: false }]
        });

        const note = parseNote("list.json", json);

        expect(note?.content).toContain(`<span class="todo-list__label__description"><strong>bold item</strong></span>`);
    });

    it("treats an epoch (0) timestamp as a real date, not a missing one", () => {
        const note = parseNote("n.json", JSON.stringify({ createdTimestampUsec: 0 }));

        expect(note?.utcDateCreated).toBe("1970-01-01 00:00:00.000Z");
    });

    it("prefers a checklist item's rich-text (textHtml over text)", () => {
        const json = JSON.stringify({
            listContent: [{ text: "done", textHtml: `<p><span style="font-style:italic;">done</span></p>`, isChecked: true }]
        });

        const note = parseNote("list.json", json);

        expect(note?.content).toBe(
            `<ul class="todo-list">` +
                `<li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description"><i>done</i></span></label></li>` +
                `</ul>`
        );
    });

    it("uses distinct created/modified timestamps when both are present", () => {
        const json = JSON.stringify({
            textContent: "x",
            createdTimestampUsec: 1782029545375000,
            userEditedTimestampUsec: 1782029654353000
        });

        const note = parseNote("note.json", json);

        expect(note?.utcDateCreated).toBe("2026-06-21 08:12:25.375Z");
        expect(note?.utcDateModified).toBe("2026-06-21 08:14:14.353Z");
    });

    it("maps a Keep palette colour to its hex for the #color label", () => {
        expect(parseNote("n.json", JSON.stringify({ color: "GREEN" }))?.colorHex).toBe("#95d641");
        expect(parseNote("n.json", JSON.stringify({ color: "CERULEAN" }))?.colorHex).toBe("#82b1ff");
    });

    it("leaves colour undefined for Keep's default, an unknown colour, or no colour", () => {
        expect(parseNote("n.json", JSON.stringify({ color: "DEFAULT" }))?.colorHex).toBeUndefined();
        expect(parseNote("n.json", JSON.stringify({ color: "MAGENTA" }))?.colorHex).toBeUndefined();
        expect(parseNote("n.json", JSON.stringify({}))?.colorHex).toBeUndefined();
    });

    it("leaves timestamps undefined and content empty for a bare note", () => {
        const note = parseNote("empty.json", JSON.stringify({}));

        expect(note).toEqual({ title: "empty", content: "", attachments: [], utcDateCreated: undefined, utcDateModified: undefined });
    });

    it("yields no attachments for a note with an empty (or absent) attachments array", () => {
        expect(parseNote("n.json", JSON.stringify({ attachments: [] }))?.attachments).toEqual([]);
        expect(parseNote("n.json", JSON.stringify({}))?.attachments).toEqual([]);
    });

    it("parses image attachments, deriving the MIME from the file extension", () => {
        const json = JSON.stringify({
            title: "With image",
            textContent: "see below",
            attachments: [{ filePath: "abc123.png", mimetype: "image/png" }]
        });

        const note = parseNote("note.json", json);

        expect(note?.attachments).toEqual([{ fileName: "abc123.png", mime: "image/png" }]);
    });

    it("derives an attachment's MIME from its extension over Keep's declared mimetype", () => {
        const json = JSON.stringify({
            attachments: [{ filePath: "recording.3gp", mimetype: "application/octet-stream" }]
        });

        const note = parseNote("note.json", json);

        // 3gp resolves to video/3gpp by extension, overriding the export's generic octet-stream.
        expect(note?.attachments).toEqual([{ fileName: "recording.3gp", mime: "video/3gpp" }]);
    });

    it("falls an attachment's MIME back to Keep's mimetype, then octet-stream, for an unknown extension", () => {
        const json = JSON.stringify({
            attachments: [
                { filePath: "mystery.weird", mimetype: "audio/amr" },
                { filePath: "nomime.weird" }
            ]
        });

        const note = parseNote("note.json", json);

        expect(note?.attachments).toEqual([
            { fileName: "mystery.weird", mime: "audio/amr" },
            { fileName: "nomime.weird", mime: "application/octet-stream" }
        ]);
    });

    it("uses an attachment's base name, dropping any path, and skips entries with no filePath", () => {
        const json = JSON.stringify({
            attachments: [{ filePath: "sub/dir/photo.jpg", mimetype: "image/jpeg" }, { mimetype: "image/png" }]
        });

        const note = parseNote("note.json", json);

        expect(note?.attachments).toEqual([{ fileName: "photo.jpg", mime: "image/jpeg" }]);
    });

    it("skips a malformed JSON entry rather than throwing", () => {
        expect(parseNote("broken.json", "{ not valid json")).toBeNull();
    });

    it("leaves the date undefined when the timestamp overflows to an Invalid Date", () => {
        // A timestamp so large that new Date(usec / 1000) is an Invalid Date (NaN time).
        const note = parseNote("n.json", JSON.stringify({ createdTimestampUsec: 9e18 }));

        expect(note?.utcDateCreated).toBeUndefined();
    });

    it("falls back to \"Untitled\" when an untitled note's filename strips to empty", () => {
        const note = parseNote(".json", JSON.stringify({}));

        expect(note?.title).toBe("Untitled");
    });

    it("yields empty content when a checklist has only empty/filtered-out items", () => {
        const note = parseNote("list.json", JSON.stringify({ listContent: [{ text: "" }] }));

        expect(note?.content).toBe("");
    });

    it("renders a checklist mixing a rich-text item and a plain-text item", () => {
        const json = JSON.stringify({
            listContent: [
                { textHtml: `<p><span style="font-weight:700;">rich</span></p>`, isChecked: false },
                { text: "plain", isChecked: true }
            ]
        });

        const note = parseNote("list.json", json);

        expect(note?.content).toBe(
            `<ul class="todo-list">` +
                `<li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description"><strong>rich</strong></span></label></li>` +
                `<li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">plain</span></label></li>` +
                `</ul>`
        );
    });
});
