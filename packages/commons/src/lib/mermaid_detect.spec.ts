import { describe, expect, it } from "vitest";

import { looksLikeMermaidDiagram } from "./mermaid_detect.js";

describe("looksLikeMermaidDiagram", () => {
    it("recognizes common diagram types", () => {
        expect(looksLikeMermaidDiagram("sequenceDiagram\nA->>B: hi")).toBe(true);
        expect(looksLikeMermaidDiagram("flowchart TD\nA --> B")).toBe(true);
        expect(looksLikeMermaidDiagram("graph TD\nA --> B")).toBe(true);
        expect(looksLikeMermaidDiagram("stateDiagram-v2\n[*] --> Still")).toBe(true);
        expect(looksLikeMermaidDiagram("classDiagram\nA <|-- B")).toBe(true);
        expect(looksLikeMermaidDiagram("erDiagram\nA ||--o{ B : has")).toBe(true);
        expect(looksLikeMermaidDiagram("gantt\ntitle x")).toBe(true);
        expect(looksLikeMermaidDiagram("pie\ntitle x")).toBe(true);
        expect(looksLikeMermaidDiagram("mindmap\nroot")).toBe(true);
    });

    it("skips YAML front-matter and init directives", () => {
        expect(looksLikeMermaidDiagram("---\ntitle: x\n---\nflowchart TD\nA-->B")).toBe(true);
        expect(looksLikeMermaidDiagram("%%{init: {'theme':'dark'}}%%\nsequenceDiagram\nA->>B: hi")).toBe(true);
    });

    it("rejects non-mermaid text and empty input", () => {
        expect(looksLikeMermaidDiagram("")).toBe(false);
        expect(looksLikeMermaidDiagram(null)).toBe(false);
        expect(looksLikeMermaidDiagram("const x = 1;")).toBe(false);
        expect(looksLikeMermaidDiagram("# shell\nbun upgrade")).toBe(false);
        expect(looksLikeMermaidDiagram("This documents a sequenceDiagram API")).toBe(false);
    });
});
