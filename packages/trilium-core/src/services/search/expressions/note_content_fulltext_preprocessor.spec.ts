import { NoteType } from "@triliumnext/commons";
import { describe, expect,it } from "vitest";

import preprocessContent from "./note_content_fulltext_preprocessor";

describe("Mind map preprocessing", () => {
    const type: NoteType = "mindMap";
    const mime = "application/json";

    it("supports empty JSON", () => {
        expect(preprocessContent("{}", type, mime)).toEqual("");
    });

    it("supports blank text / invalid JSON", () => {
        expect(preprocessContent("", type, mime)).toEqual("");
        expect(preprocessContent(`{ "node": " }`, type, mime)).toEqual("");
    });

    it("reads data", () => {
        expect(preprocessContent(`{ "nodedata": { "topic": "Root", "children": [ { "topic": "Child 1" }, { "topic": "Child 2", "children": [ { "topic": "Grandchild" } ] } ] } }`, type, mime)).toEqual("root, child 1, child 2, grandchild");        
    });
});

describe("Canvas preprocessing", () => {
    const type: NoteType = "canvas";
    const mime = "application/json";

    it("supports empty JSON", () => {
        expect(preprocessContent("{}", type, mime)).toEqual("");
    });

    it("supports blank text / invalid JSON", () => {
        expect(preprocessContent("", type, mime)).toEqual("");        
    });

    it("reads elements", () => {
        expect(preprocessContent(`{ "elements": [ { "type": "text", "text": "Hello" } ] }`, type, mime)).toEqual("hello");
        expect(preprocessContent(`{ "elements": [ { "type": "text" }, { "type": "text", "text": "World" }, { "type": "rectangle", "text": "Ignored" } ] }`, type, mime)).toEqual("world");
    });
});

describe("Spreadsheet preprocessing", () => {
    const type: NoteType = "spreadsheet";
    const mime = "application/json";

    it("supports empty / invalid JSON", () => {
        expect(preprocessContent("{}", type, mime)).toEqual("");
        expect(preprocessContent("", type, mime)).toEqual("");
    });

    it("reads visible cell values", () => {
        const workbook = JSON.stringify({
            workbook: {
                sheets: {
                    s1: { cellData: { 0: { 0: { v: "Revenue" }, 1: { v: 42 } } } }
                }
            }
        });
        expect(preprocessContent(workbook, type, mime)).toEqual("revenue 42");
    });
});

describe("Text (HTML) preprocessing", () => {
    const type: NoteType = "text";
    const mime = "text/html";

    it("surfaces link-preview title, url and description from data attributes", () => {
        const content = `<section class="link-embed" data-url="https://en.wikipedia.org/wiki/The_Terminator" data-title="The Terminator - Wikipedia" data-description="A 1984 science fiction film.">&nbsp;</section>`;
        const result = preprocessContent(content, type, mime);

        expect(result).toContain("the terminator - wikipedia");
        expect(result).toContain("https://en.wikipedia.org/wiki/the_terminator");
        expect(result).toContain("a 1984 science fiction film.");
    });

    it("keeps the markup but still unescapes entities when raw is requested", () => {
        const result = preprocessContent("<p>Hello&nbsp;world</p>", type, mime, true);
        expect(result).toEqual("<p>hello world</p>");
    });
});

describe("Unhandled type/mime combinations", () => {
    it("returns the normalized content untouched", () => {
        // Neither the type nor the mime matches any branch, so no extractor runs.
        expect(preprocessContent("Plain Text", "code", "text/plain")).toEqual("plain text");
        expect(preprocessContent("{}", "llmChat", "text/plain")).toEqual("{}");
    });
});

describe("LLM chat preprocessing", () => {
    const type: NoteType = "llmChat";
    const mime = "application/json";

    it("supports empty / invalid JSON", () => {
        expect(preprocessContent("{}", type, mime)).toEqual("");
        expect(preprocessContent("", type, mime)).toEqual("");
    });

    it("reads conversation prose and skips metadata", () => {
        const chat = JSON.stringify({
            version: 1,
            messages: [
                { id: "1", role: "user", content: "What is a Branch?" },
                { id: "2", role: "assistant", content: [ { type: "text", content: "A parent-child link." } ] }
            ]
        });
        expect(preprocessContent(chat, type, mime)).toEqual("what is a branch? a parent-child link.");
    });
});