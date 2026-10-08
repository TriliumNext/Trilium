import {
    _getModelData as getModelData,
    ClassicEditor,
    Essentials,
    FindAndReplaceEditing,
    type ModelElement,
    Paragraph
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Tabs from "./tabs.js";

const TWO_TABS =
    "<div class=\"trilium-tabs\">" +
        "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">Windows</p>" +
            "<div class=\"trilium-tab-panel\"><p>Run it.</p></div></section>" +
        "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">Linux</p>" +
            "<div class=\"trilium-tab-panel\"><p>Use the package.</p></div></section>" +
    "</div>" +
    "<p>Read the notes.</p>";

describe("TabsEditing", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, FindAndReplaceEditing, Paragraph, Tabs]
        });
        editor.setData(TWO_TABS);
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    function activeTitles() {
        const root = editor.editing.view.getDomRoot();
        return [...root?.querySelectorAll(".trilium-tab--active > .trilium-tab-title") ?? []]
            .map(title => title.textContent);
    }

    function linux() {
        const tabs = editor.model.document.getRoot()?.getChild(0) as ModelElement;
        return tabs.getChild(1) as ModelElement;
    }

    it("keeps the tab showing for a find result outside any tab, no result, or a node outside the view", () => {
        editor.model.change(writer => writer.setSelection(linux().getChild(1) as ModelElement, 0));

        editor.execute("find", "the");
        expect(activeTitles()).toEqual(["Linux"]);
        editor.execute("findNext");
        expect(activeTitles()).toEqual(["Linux"]);

        editor.execute("find", "nowhere");
        expect(activeTitles()).toEqual(["Linux"]);

        editor.plugins.get("TabsEditing").showTabsAroundDomNode(document.createElement("p"));
        expect(activeTitles()).toEqual(["Linux"]);
    });

    it("leaves Enter outside a title to the editor, and attribute changes to the post-fixer", () => {
        const panel = linux().getChild(1) as ModelElement;
        editor.model.change(writer => writer.setSelection(panel.getChild(0) as ModelElement, "end"));

        editor.editing.view.document.fire("enter", {
            preventDefault() {},
            domEvent: new KeyboardEvent("keydown")
        });
        expect(panel.childCount).toBe(2);

        const title = linux().getChild(0) as ModelElement;
        editor.model.change(writer => writer.setAttribute("bold", true, writer.createRangeIn(title)));
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toContain("<tabTitle><$text bold=\"true\">Linux</$text></tabTitle>");
    });
});
