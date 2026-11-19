import { indexMarkdownBlocks } from "@triliumnext/commons/src/lib/markdown_block_index.js";
import {
    applySourceChange, placeMarkerOnBlock
} from "@triliumnext/commons/src/lib/markdown_references.js";
import { describe, expect, it } from "vitest";

import { serverBlockHost } from "../import/markdown";
import type { ReferenceSource } from "./index";
import markdownReferences from "./markdown";

/** A note of `content`, as a provider reads it. */
function source(content: string | Uint8Array) {
    return { isContentAvailable: () => true, getContent: () => content } as unknown as ReferenceSource;
}

const marker = (id: string) => `<a data-trilium-block-id="${id}"></a>`;

describe("markdownReferences", () => {
    it("reads Markdown notes, and gives only a heading a reference", () => {
        const content = `# Intro\n\nText <a id="top"></a>\n\n## Kept ${marker("kept")}`;

        expect(markdownReferences.isFor("code", "text/x-markdown")).toBe(true);
        expect(markdownReferences.isFor("code", "text/markdown")).toBe(true);
        expect(markdownReferences.isFor("code", "text/html")).toBe(false);
        expect(markdownReferences.isFor("text", "text/x-markdown")).toBe(false);
        expect(markdownReferences.findTargets(source(content))).toStrictEqual([
            { kind: "heading", title: "Intro", level: 1 },
            { kind: "heading", title: "Kept", level: 2, params: { block: "kept" } },
            { kind: "anchor", title: "top", params: { bookmark: "top" } }
        ]);
        expect(markdownReferences.findTargets(source(new Uint8Array([ 35, 32, 65 ])))).toStrictEqual([]);

        const created = markdownReferences.createReference?.(
            content, { kind: "heading", index: 0, title: "Intro" }
        );
        expect(created?.params.block).toMatch(/^[A-Za-z0-9]{12}$/);
        expect(created?.content)
            .toBe(content.replace("# Intro", `# Intro ${marker(created?.params.block ?? "")}`));
        expect(markdownReferences.createReference?.(
            content, { kind: "heading", index: 1, title: "Kept" }
        )).toStrictEqual({ content, params: { block: "kept" } });
        expect(markdownReferences.createReference?.(
            content, { kind: "anchor", index: 0, title: "top" }
        )).toBeNull();
        expect(markdownReferences.createReference?.(
            new Uint8Array(), { kind: "heading", index: 0, title: "Intro" }
        )).toBeNull();
    });

    it("places markers as the server renders the note", () => {
        const fence = "```";
        const cases: [ string, number, string ][] = [
            [ "> Quoted\n> text", 2, `> Quoted\n> text ${marker("new")}` ],
            [ "- [x] done", 1, `- [x] done ${marker("new")}` ],
            [ "| a | b |\n| - | - |", 1, `| a ${marker("new")} | b |\n| - | - |` ],
            [ `${fence}js\ncode\n${fence}`, 2, `${marker("new")}\n\n${fence}js\ncode\n${fence}` ],
            [ "***", 1, `${marker("new")}\n\n***` ],
            [ "$$x$$", 1, `${marker("new")}$$x$$` ],
            [ "> [!NOTE]\n> Body", 2, `> [!NOTE]\n> Body ${marker("new")}` ]
        ];

        for (const [ source, line, expected ] of cases) {
            const index = indexMarkdownBlocks(source, serverBlockHost);
            const block = index.blockAt(line);
            const placed = block && placeMarkerOnBlock(
                source, index, block, { kind: "draw", createId: () => "new" }, serverBlockHost
            );
            expect(placed?.change, source).toBeDefined();
            expect(applySourceChange(source, placed?.change), source).toBe(expected);
        }
    });
});
