import {
    _getModelData as getModelData,
    ClassicEditor,
    Essentials,
    type ModelElement,
    Paragraph
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Tabs from "./tabs.js";

function tab(title: string, body = "") {
    return `<section class="trilium-tab"><p class="trilium-tab-title">${title}</p>` +
        `<div class="trilium-tab-panel"><p>${body}</p></div></section>`;
}

describe("tabs commands", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, Tabs]
        });
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    function titles(tabs: ModelElement) {
        return [...tabs.getChildren()].map(child => {
            const title = (child as ModelElement).getChild(0) as ModelElement;
            return [...title.getChildren()].map(text => text.is("$text") ? text.data : "").join("");
        });
    }

    it("adds a tab at the end of a block selected as a whole, including a nested one", () => {
        editor.setData(
            `<div class="trilium-tabs">${tab("A")}<section class="trilium-tab">` +
                `<p class="trilium-tab-title">B</p><div class="trilium-tab-panel">` +
                    `<div class="trilium-tabs">${tab("B1")}${tab("B2")}</div>` +
                `</div></section></div>`
        );
        const outer = editor.model.document.getRoot()?.getChild(0) as ModelElement;
        const inner = ((outer.getChild(1) as ModelElement).getChild(1) as ModelElement).getChild(0) as ModelElement;

        editor.model.change(writer => writer.setSelection(inner, "on"));
        editor.execute("insertTab");
        expect(titles(inner)).toEqual(["B1", "B2", "Tab 3"]);
        expect(titles(outer)).toEqual(["A", "B"]);

        editor.model.change(writer => writer.setSelection(outer, "on"));
        editor.execute("insertTab");
        expect(titles(outer)).toEqual(["A", "B", "Tab 3"]);
        expect(getModelData(editor.model)).toContain("<tabTitle>[Tab 3]</tabTitle>");
    });

    it("moves a tab left and disables the move at either end", () => {
        editor.setData(`<div class="trilium-tabs">${tab("A")}${tab("B")}</div>`);
        const tabs = editor.model.document.getRoot()?.getChild(0) as ModelElement;
        editor.model.change(writer => writer.setSelection((tabs.getChild(1) as ModelElement).getChild(0) as ModelElement, 0));

        editor.execute("moveTabLeft");

        expect(titles(tabs)).toEqual(["B", "A"]);
        expect(editor.commands.get("moveTabLeft")?.isEnabled).toBe(false);
        expect(editor.commands.get("moveTabRight")?.isEnabled).toBe(true);
    });
});
