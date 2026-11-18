import { collectBlocks, compareBlockIds } from "@triliumnext/commons/src/lib/block_keys.js";
import { renderToHtml } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import {
    BlockQuote, CodeBlock, Essentials, Heading, HorizontalLine, Image, ImageInline, List, Paragraph,
    Table, TodoList
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Admonition from "../admonition/admonition.js";
import Math from "../math/math.js";
import Tabs from "../tabs/tabs.js";
import BlockReference from "./block_reference.js";

const PLUGINS = [
    Essentials, Paragraph, Heading, List, TodoList, BlockQuote, CodeBlock, Table, HorizontalLine,
    Image, ImageInline, Admonition, Tabs, Math, BlockReference
];

/** Math renders its source as text, in place of an engine. */
const CONFIG = {
    math: {
        engine: (equation: string, element: HTMLElement) => {
            element.textContent = equation;
        }
    }
};

/** A Markdown note with a block marker on every kind of block that the renderer writes an id on. */
const SHAPES = [
    `## Heading <a data-trilium-block-id="h"></a>`,
    `A paragraph <a data-trilium-block-id="p"></a>`,
    `&nbsp;<a data-trilium-block-id="e"></a>`,
    `- parent <a data-trilium-block-id="par"></a>\n    - child <a data-trilium-block-id="ch"></a>`,
    `1. one\n2. two<a data-trilium-block-id="i2"></a>`,
    `- [ ] open\n- [x] done <a data-trilium-block-id="todo"></a>`,
    `<a data-trilium-block-id="f"></a>$$x^2$$`,
    `<a data-trilium-block-id="c"></a>\n\n\`\`\`js\ncode();\n\`\`\``,
    `| A<a data-trilium-block-id="t"></a> | B |\n| --- | --- |\n| 1 | 2 |`,
    `<a data-trilium-block-id="q"></a>\n\n> quoted <a data-trilium-block-id="qp"></a>`,
    `> [!NOTE]\n> Body <a data-trilium-block-id="ap"></a>`,
    `<a data-trilium-block-id="r"></a>\n\n---`,
    `=== "Tab <a data-trilium-block-id="tab"></a>"\n\n    In tab <a data-trilium-block-id="in"></a>`,
    `![](api/images/abc/x.png)<a data-trilium-block-id="img"></a>`
].join("\n\n");

describe("the editor with rendered Markdown", () => {
    it("keeps every block id on the same block that the renderer wrote it on", async () => {
        const editor = await createTestEditor(PLUGINS, CONFIG);
        const rendered = renderToHtml(SHAPES, "", { sanitize: (html) => html, demoteH1: false });

        editor.setData(rendered);
        const saved = editor.getData();

        expect(compareBlockIds(collect(rendered), collect(saved)))
            .toEqual({ lostBlockIds: [], movedBlockIds: [] });
        expect(collect(saved).flatMap(({ id }) => id ?? [])).toEqual([
            "h", "p", "e", "par", "ch", "i2", "todo", "f", "c", "t", "q", "qp", "ap", "r", "tab",
            "in", "img"
        ]);
    });

    it("saves a referenced to-do item as the renderer writes it, with an id of the list", async () => {
        const editor = await createTestEditor(PLUGINS, CONFIG);
        const rendered = renderToHtml(`- [x] done <a data-trilium-block-id="todo"></a>`, "", {
            sanitize: (html) => html, demoteH1: false
        });

        editor.setData(rendered);

        expect(editor.getData().replace(/ data-list-item-id="\w+"/, "")).toBe(rendered);
    });
});

function collect(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return collectBlocks(template.content);
}
