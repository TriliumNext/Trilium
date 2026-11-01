import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    ClassicEditor,
    Essentials,
    type ModelElement,
    Paragraph
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TabAlignment } from "./constants.js";
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

    function modelWithSelection() {
        return getModelData(editor.model);
    }

    function activeTitles() {
        const root = editor.editing.view.getDomRoot();
        return [...root?.querySelectorAll(".trilium-tab-title--active") ?? []]
            .map(title => title.textContent);
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

    it("disables the commands for a single tab while a nested block is selected as a whole", () => {
        editor.setData(
            `<div class="trilium-tabs">${tab("A")}<section class="trilium-tab">` +
                `<p class="trilium-tab-title">B</p><div class="trilium-tab-panel">` +
                    `<div class="trilium-tabs">${tab("B1")}${tab("B2")}</div>` +
                `</div></section>${tab("C")}</div>`
        );
        const outer = editor.model.document.getRoot()?.getChild(0) as ModelElement;
        const inner = ((outer.getChild(1) as ModelElement).getChild(1) as ModelElement).getChild(0) as ModelElement;
        expect(inner.is("element", "tabs")).toBe(true);

        editor.model.change(writer => writer.setSelection(inner, "on"));

        for (const name of [ "removeTab", "moveTabLeft", "moveTabRight", "assignTabReference" ]) {
            const command = editor.commands.get(name);
            expect(command, name).toBeDefined();
            expect(command?.isEnabled, name).toBe(false);
        }
        editor.execute("removeTab");
        expect(titles(outer)).toEqual(["A", "B", "C"]);
        expect(titles(inner)).toEqual(["B1", "B2"]);
    });

    it("aligns the block holding the selection and saves no attribute for the top", () => {
        const html = `<div class="trilium-tabs">${tab("A", "a")}${tab("B", "b")}</div>` +
            "<p>Outside</p>";
        editor.setData(html);
        const root = editor.model.document.getRoot();
        const tabs = root?.getChild(0) as ModelElement;
        const command = editor.commands.get("tabAlignment");
        expect(command).toBeDefined();

        editor.model.change(writer => writer.setSelection(root?.getChild(1) as ModelElement, 0));
        expect([command?.isEnabled, command?.value]).toEqual([false, undefined]);

        const panel = (tabs.getChild(1) as ModelElement).getChild(1) as ModelElement;
        editor.model.change(writer => writer.setSelection(panel, 0));
        expect([command?.isEnabled, command?.value]).toEqual([true, "top"]);

        editor.execute("tabAlignment", { value: "bottom" });
        expect([tabs.getAttribute("tabAlignment"), command?.value]).toEqual(["bottom", "bottom"]);
        expect(editor.getData())
            .toContain("<div class=\"trilium-tabs\" data-trilium-tab-alignment=\"bottom\">");

        const unknownAlignment: string = "left";
        editor.execute("tabAlignment", { value: unknownAlignment as TabAlignment });
        expect(command?.value).toBe("bottom");

        editor.execute("tabAlignment", { value: "top" });
        expect(tabs.hasAttribute("tabAlignment")).toBe(false);
        expect(editor.getData()).toBe(html);
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

    describe("moveToTab", () => {
        it("moves the touched blocks to a later tab's start or an earlier tab's end, and shows it", () => {
            setModelData(editor.model, block(
                modelTab("A", "a"), modelTab("B", "b[1", "b]2", "b3"), modelTab("C", "c")));
            const before = editor.getData();

            editor.execute("moveToTab", { target: "next" });
            expect(modelWithSelection()).toBe(block(
                modelTab("A", "a"), modelTab("B", "b3"), modelTab("C", "b[1", "b]2", "c")));
            expect(activeTitles()).toEqual(["C"]);

            editor.execute("moveToTab", { target: "first" });
            expect(modelWithSelection()).toBe(block(
                modelTab("A", "a", "b[1", "b]2"), modelTab("B", "b3"), modelTab("C", "c")));
            expect(activeTitles()).toEqual(["A"]);

            editor.execute("undo");
            editor.execute("undo");
            expect(editor.getData()).toBe(before);
        });

        it("fills an empty target, refills the source and ignores targets past an end", () => {
            setModelData(editor.model, block(modelTab("A", "[a]"), modelTab("B", "")));

            editor.execute("moveToTab", { target: "last" });
            expect(modelWithSelection()).toBe(block(modelTab("A", ""), modelTab("B", "[a]")));

            editor.execute("moveToTab", { target: "next" });
            editor.execute("moveToTab", { target: "last" });
            expect(modelWithSelection()).toBe(block(modelTab("A", ""), modelTab("B", "[a]")));

            editor.execute("moveToTab", { target: "previous" });
            expect(modelWithSelection()).toBe(block(modelTab("A", "[a]"), modelTab("B", "")));
        });

        it("moves a nested tabs block selected as a whole", () => {
            const inner = block(modelTab("X", "x"), modelTab("Y", "y"));
            setModelData(editor.model, block(rawTab("A", `[${inner}]`), modelTab("B", "b")));

            editor.execute("moveToTab", { target: "next" });

            expect(modelWithSelection()).toBe(block(
                modelTab("A", ""), rawTab("B", `[${inner}]<paragraph>b</paragraph>`)));
        });

        it("is enabled only for a selection inside one panel", () => {
            const nested = block(modelTab("[X]", "x"), modelTab("Y", "y"));
            const cases: Array<[string, boolean]> = [
                [block(modelTab("A", "[a]"), modelTab("B", "b")), true],
                [block(modelTab("A", "a[]"), modelTab("B", "b")), false],
                [block(modelTab("[A]", "a"), modelTab("B", "b")), false],
                [block(rawTab("A", nested), modelTab("B", "b")), false],
                [`[${block(modelTab("A", "a"), modelTab("B", "b"))}]`, false],
                ["<paragraph>[a]</paragraph>", false]
            ];
            for (const [data, isEnabled] of cases) {
                setModelData(editor.model, data);
                expect(editor.commands.get("moveToTab")?.isEnabled, data).toBe(isEnabled);
            }
        });
    });

    describe("moveTab", () => {
        it("moves the current tab to any place, and the side commands only next to it", () => {
            const [a, b, c] = [modelTab("A", "a"), modelTab("B", "b[]"), modelTab("C", "c")];
            setModelData(editor.model, block(a, b, c));

            editor.execute("moveTab", { target: "last" });
            expect(modelWithSelection()).toBe(block(a, c, b));
            expect(editor.commands.get("moveTabRight")?.isEnabled).toBe(false);
            expect(editor.commands.get("moveTab")?.isEnabled).toBe(true);

            editor.execute("moveTab", { target: "next" });
            editor.execute("moveTab");
            expect(modelWithSelection()).toBe(block(a, c, b));

            editor.execute("moveTab", { target: "first" });
            expect(modelWithSelection()).toBe(block(b, a, c));
            expect(activeTitles()).toEqual(["B"]);
        });
    });

    describe("insertTab", () => {
        it("adds a tab before or after the current one, numbered by its place", () => {
            const [a, b] = [modelTab("A", "a"), modelTab("B", "b")];
            setModelData(editor.model, block(modelTab("A", "a[]"), b));

            editor.execute("insertTab", { position: "before" });
            expect(modelWithSelection()).toBe(block(modelTab("[Tab 1]", ""), a, b));
            expect(activeTitles()).toEqual(["Tab 1"]);

            editor.execute("insertTab", { position: "after" });
            expect(modelWithSelection())
                .toBe(block(modelTab("Tab 1", ""), modelTab("[Tab 2]", ""), a, b));

            setModelData(editor.model, `[${block(a, b)}]`);
            editor.execute("insertTab", { position: "before" });
            expect(modelWithSelection()).toBe(block(modelTab("[Tab 1]", ""), a, b));
        });
    });
});

/** A tabs block in model notation that holds `tabs`. */
function block(...tabs: string[]) {
    return `<tabs>${tabs.join("")}</tabs>`;
}

/** A tab in model notation with the given title and a paragraph for each of `texts`. */
function modelTab(title: string, ...texts: string[]) {
    return rawTab(title, texts.map(text => `<paragraph>${text}</paragraph>`).join(""));
}

/** A tab in model notation with the given title and panel content. */
function rawTab(title: string, panel: string) {
    return `<tab><tabTitle>${title}</tabTitle><tabPanel>${panel}</tabPanel></tab>`;
}
