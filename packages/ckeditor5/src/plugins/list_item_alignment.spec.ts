import {
    _setModelData as setModelData, Alignment, Bold, ClassicEditor, GeneralHtmlSupport, Heading,
    List, type ModelElement, Paragraph, TodoList, Undo
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ListItemAlignment from "./list_item_alignment.js";
import { applyListItemAlignment } from "./list_item_alignment_read_only.js";

const PLUGINS = [ Paragraph, Heading, List, TodoList, Alignment, Bold, Undo, ListItemAlignment ];
const ITEM = 'listIndent="0" listType="bulleted"';
const CENTER = "trilium-list-item-aligned-center";
const RIGHT = "trilium-list-item-aligned-right";

async function createEditor(extraConfig = {}) {
    return createTestEditor([ ...PLUGINS, GeneralHtmlSupport ], extraConfig);
}

function getBlock(editor: ClassicEditor, index: number) {
    return editor.model.document.getRoot()?.getChild(index) as ModelElement;
}

/** The alignment classes of each `<li>` in the editing view. */
function getItemClasses(editor: ClassicEditor) {
    const items = editor.editing.view.getDomRoot()?.querySelectorAll("li") ?? [];
    return [ ...items ].map((item) => [ ...item.classList ]
        .filter((name) => name.startsWith("trilium-list-item-aligned-")).join(" "));
}

describe("ListItemAlignment", () => {
    it("marks the items of aligned first paragraphs in the editing view only", async () => {
        const editor = await createEditor();
        editor.setData(
            "<ul><li><p style=\"text-align:center;\">a</p></li>" +
            "<li><p style=\"text-align:right;\">b</p></li><li>c</li></ul>" +
            "<ol><li><p style=\"text-align:justify;\">d</p></li></ol>" +
            "<ul class=\"todo-list\"><li><label class=\"todo-list__label\">" +
            "<input type=\"checkbox\" disabled=\"disabled\"></label>" +
            "<p style=\"text-align:center;\">e</p></li></ul>");

        expect(getItemClasses(editor)).toEqual([ CENTER, RIGHT, "", "", CENTER ]);
        expect(getBlock(editor, 0).getAttribute("listItemAlignment")).toBe("center");
        expect(editor.getData()).not.toContain("trilium-list-item-aligned");
    });

    it("follows the item's first paragraph, on all of its blocks and through undo", async () => {
        const editor = await createEditor();
        setModelData(editor.model,
            `<paragraph ${ITEM} listItemId="a">[]First</paragraph>` +
            `<paragraph ${ITEM} listItemId="a">Second</paragraph>` +
            `<heading1 ${ITEM} listItemId="b" alignment="center">Heading</heading1>` +
            `<paragraph ${ITEM} listItemId="b" alignment="right">After it</paragraph>` +
            `<heading1 ${ITEM} listItemId="c" alignment="center">Only a heading</heading1>`);
        const values = () => [ 0, 1, 2, 3, 4 ]
            .map((index) => getBlock(editor, index).getAttribute("listItemAlignment"));
        expect(values()).toEqual([ undefined, undefined, "right", "right", undefined ]);

        editor.execute("alignment", { value: "center" });
        expect(values()).toEqual([ "center", "center", "right", "right", undefined ]);
        expect(getItemClasses(editor)[0]).toBe(CENTER);

        // Removing the first block makes the second one decide.
        editor.model.change((writer) => writer.remove(getBlock(editor, 0)));
        expect(getBlock(editor, 0).getAttribute("listItemAlignment")).toBeUndefined();

        editor.execute("undo");
        expect(values()).toEqual([ "center", "center", "right", "right", undefined ]);
        editor.execute("undo");
        expect(values()).toEqual([ undefined, undefined, "right", "right", undefined ]);
    });

    it("treats the blocks around a nested list as one item", async () => {
        const editor = await createEditor();
        setModelData(editor.model,
            `<paragraph ${ITEM} listItemId="a" alignment="center">First</paragraph>` +
            `<paragraph listIndent="1" listType="bulleted" listItemId="n">Nested</paragraph>` +
            `<paragraph ${ITEM} listItemId="a">After the nested list</paragraph>` +
            `<paragraph ${ITEM} listItemId="b">Next item</paragraph>`);

        const values = () => [ 0, 1, 2, 3 ]
            .map((index) => getBlock(editor, index).getAttribute("listItemAlignment"));
        expect(values()).toEqual([ "center", undefined, "center", undefined ]);
        expect(getItemClasses(editor)).toEqual([ CENTER, "", "" ]);

        // Aligning a later block leaves the item to its first paragraph.
        const after = getBlock(editor, 2);
        editor.model.change((writer) => writer.setAttribute("alignment", "right", after));
        expect(values()).toEqual([ "center", undefined, "center", undefined ]);
    });

    it("leaves the attribute alone for typing and inline formatting", async () => {
        const editor = await createEditor();
        setModelData(editor.model,
            `<paragraph ${ITEM} listItemId="a" alignment="center">[Text]</paragraph>`);
        const block = getBlock(editor, 0);

        editor.execute("bold");
        editor.model.change((writer) => writer.insertText("more", block, "end"));
        expect(block.getAttribute("listItemAlignment")).toBe("center");
    });

    it("allows the attribute on list items only", async () => {
        const editor = await createEditor();
        setModelData(editor.model,
            `<paragraph ${ITEM} listItemId="a">Item</paragraph><paragraph>Text</paragraph>`);
        const { schema } = editor.model;

        expect(schema.checkAttribute(getBlock(editor, 0), "listItemAlignment")).toBe(true);
        expect(schema.checkAttribute(getBlock(editor, 1), "listItemAlignment")).toBe(false);
    });

    it("drops the class from pasted HTML, which General HTML Support keeps otherwise", async () => {
        const allowAll = { name: /.*/, classes: true, attributes: true, styles: true };
        const editor = await createEditor({ htmlSupport: { allow: [ allowAll ] } });
        editor.setData(`<ul><li class="${CENTER} other">a</li></ul>`);

        expect(editor.getData()).toContain("<li class=\"other\"");
        expect(editor.getData()).not.toContain("trilium-list-item-aligned");
        expect(getItemClasses(editor)).toEqual([ "" ]);
    });
});

describe("applyListItemAlignment", () => {
    it("marks each item by its own first paragraph, and clears a stale mark", () => {
        const container = document.createElement("div");
        container.innerHTML =
            "<ul><li><p style=\"text-align:center\">a</p>" +
                "<ul><li><p style=\"text-align:right\">b</p></li></ul></li>" +
            "<li><p>c</p><p style=\"text-align:center\">d</p></li>" +
            "<li class=\"trilium-list-item-aligned-left\">" +
                "<p style=\"text-align:justify\">e</p></li>" +
            "<li>f</li></ul>";

        applyListItemAlignment(container);

        expect([ ...container.querySelectorAll("li") ].map((item) => item.className))
            .toEqual([ CENTER, RIGHT, "", "", "" ]);
    });
});
