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