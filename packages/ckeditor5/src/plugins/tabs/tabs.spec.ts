import {
    _getModelData as getModelData,
    _setModelData as setModelData,
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
            "<div class=\"trilium-tab-panel\"><p>Run the installer.</p></div></section>" +
        "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">Linux</p>" +
            "<div class=\"trilium-tab-panel\"><p>Use the package.</p></div></section>" +
    "</div>";

describe("Tabs", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, FindAndReplaceEditing, Paragraph, Tabs]
        });
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    function model() {
        return getModelData(editor.model, { withoutSelection: true });
    }

    function activeTitles() {
        const root = editor.editing.view.getDomRoot();
        return [...root?.querySelectorAll(".trilium-tab--active > .trilium-tab-title") ?? []]
            .map(title => title.textContent);
    }

    function tabsElement() {
        const tabs = editor.model.document.getRoot()?.getChild(0);
        expect(tabs?.is("element", "tabs")).toBe(true);
        return tabs as ModelElement;
    }

    it("round-trips the saved HTML through the model", () => {
        editor.setData(TWO_TABS);

        expect(model()).toBe(
            "<tabs>" +
                "<tab><tabTitle>Windows</tabTitle><tabPanel><paragraph>Run the installer.</paragraph></tabPanel></tab>" +
                "<tab><tabTitle>Linux</tabTitle><tabPanel><paragraph>Use the package.</paragraph></tabPanel></tab>" +
            "</tabs>"
        );
        expect(editor.getData()).toBe(TWO_TABS);
    });

    it("inserts two numbered tabs and selects the first title", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        editor.execute("tabs");

        expect(getModelData(editor.model)).toBe(
            "<tabs>" +
                "<tab><tabTitle>[Tab 1]</tabTitle><tabPanel><paragraph></paragraph></tabPanel></tab>" +
                "<tab><tabTitle>Tab 2</tabTitle><tabPanel><paragraph></paragraph></tabPanel></tab>" +
            "</tabs>"
        );
    });

    it("repairs tabs that lack a title or a panel and drops a block without tabs", () => {
        editor.setData(
            "<div class=\"trilium-tabs\">" +
                "<section class=\"trilium-tab\"><div class=\"trilium-tab-panel\"><p>Body</p></div></section>" +
                "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">Title</p></section>" +
            "</div>" +
            "<div class=\"trilium-tabs\"></div>"
        );

        expect(model()).toBe(
            "<tabs>" +
                "<tab><tabTitle></tabTitle><tabPanel><paragraph>Body</paragraph></tabPanel></tab>" +
                "<tab><tabTitle>Title</tabTitle><tabPanel><paragraph></paragraph></tabPanel></tab>" +
            "</tabs>"
        );
    });

    it("merges extra titles and panels of a tab into its first panel, in document order", () => {
        editor.setData(
            "<div class=\"trilium-tabs\">" +
                "<section class=\"trilium-tab\">" +
                    "<p class=\"trilium-tab-title\">A</p>" +
                    "<p class=\"trilium-tab-title\">B</p>" +
                    "<div class=\"trilium-tab-panel\"><p>x</p></div>" +
                    "<div class=\"trilium-tab-panel\"><p>y</p></div>" +
                    "<p class=\"trilium-tab-title\">C</p>" +
                "</section>" +
                "<section class=\"trilium-tab\">" +
                    "<div class=\"trilium-tab-panel\"><p>z</p></div>" +
                    "<p class=\"trilium-tab-title\">D</p>" +
                    "<div class=\"trilium-tab-panel\"></div>" +
                "</section>" +
            "</div>"
        );

        expect(model()).toBe(
            "<tabs>" +
                "<tab><tabTitle>A</tabTitle><tabPanel>" +
                    "<paragraph>B</paragraph><paragraph>x</paragraph><paragraph>y</paragraph><paragraph>C</paragraph>" +
                "</tabPanel></tab>" +
                "<tab><tabTitle>D</tabTitle><tabPanel><paragraph>z</paragraph></tabPanel></tab>" +
            "</tabs>"
        );
    });

    it("shows the first tab, then whichever tab holds the selection", () => {
        editor.setData(TWO_TABS);
        expect(activeTitles()).toEqual(["Windows"]);

        const linux = tabsElement().getChild(1) as ModelElement;
        editor.model.change(writer => writer.setSelection(linux.getChild(1) as ModelElement, 0));
        expect(activeTitles()).toEqual(["Linux"]);

        editor.model.change(writer => writer.setSelection(editor.model.document.getRoot() as ModelElement, "end"));
        expect(activeTitles()).toEqual(["Linux"]);
    });

    it("shows the tab holding the highlighted find result without moving the caret", () => {
        editor.setData(TWO_TABS);
        const windowsPanel = (tabsElement().getChild(0) as ModelElement).getChild(1) as ModelElement;
        editor.model.change(writer => writer.setSelection(windowsPanel, 0));
        const caret = getModelData(editor.model);

        editor.execute("find", "the");
        expect(activeTitles()).toEqual(["Windows"]);

        editor.execute("findNext");
        expect(activeTitles()).toEqual(["Linux"]);
        expect(getModelData(editor.model)).toBe(caret);

        editor.execute("findNext");
        expect(activeTitles()).toEqual(["Windows"]);

        editor.execute("findPrevious");
        expect(activeTitles()).toEqual(["Linux"]);
    });

    it("exposes the active tab and each panel's title to assistive technology", () => {
        editor.setData(TWO_TABS);
        const root = editor.editing.view.getDomRoot();
        const titles = [...root?.querySelectorAll(".trilium-tab-title") ?? []];
        const panels = [...root?.querySelectorAll(".trilium-tab-panel") ?? []];
        expect(titles).toHaveLength(2);
        expect(panels).toHaveLength(2);

        expect(titles.map(title => title.getAttribute("aria-current"))).toEqual(["true", null]);
        for (const [index, title] of titles.entries()) {
            const panel = panels[index];
            expect(panel.id).not.toBe("");
            expect(title.getAttribute("aria-controls")).toBe(panel.id);
            expect(panel.getAttribute("aria-labelledby")).toBe(title.id);
            expect(root?.querySelector(`#${title.id}`)?.textContent).toBe(["Windows", "Linux"][index]);
        }
        expect(new Set([...titles, ...panels].map(element => element.id)).size).toBe(4);

        const linux = tabsElement().getChild(1) as ModelElement;
        editor.model.change(writer => writer.setSelection(linux.getChild(1) as ModelElement, 0));
        expect(titles.map(title => title.getAttribute("aria-current"))).toEqual([null, "true"]);
    });

    it("adds, moves and removes the tab holding the selection", () => {
        editor.setData(TWO_TABS);
        const windows = tabsElement().getChild(0) as ModelElement;
        editor.model.change(writer => writer.setSelection(windows.getChild(0) as ModelElement, 0));

        editor.execute("insertTab");
        expect(getModelData(editor.model)).toContain("<tabTitle>[Tab 2]</tabTitle>");
        editor.model.change(writer => editor.model.insertContent(writer.createText("macOS")));
        expect(activeTitles()).toEqual(["macOS"]);

        editor.execute("moveTabRight");
        expect(editor.commands.get("moveTabRight")?.isEnabled).toBe(false);
        expect(editor.getData()).toContain("Windows</p>");
        expect(editor.getData().indexOf("Linux")).toBeLessThan(editor.getData().indexOf("macOS"));

        editor.execute("removeTab");
        expect(model()).not.toContain("macOS");
        expect(activeTitles()).toEqual(["Linux"]);

        editor.execute("removeTab");
        editor.execute("removeTab");
        expect(model()).toBe("<paragraph></paragraph>");
    });

    it("moves the caret from a title into its panel on Enter", () => {
        editor.setData(TWO_TABS);
        const windows = tabsElement().getChild(0) as ModelElement;
        editor.model.change(writer => writer.setSelection(windows.getChild(0) as ModelElement, "end"));

        editor.editing.view.document.fire("enter", {
            preventDefault() {},
            domEvent: new KeyboardEvent("keydown")
        });

        expect(getModelData(editor.model)).toContain(
            "<tabTitle>Windows</tabTitle><tabPanel><paragraph>[]Run the installer.</paragraph></tabPanel>"
        );
    });
});
