import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    GeneralHtmlSupport,
    List,
    type ModelElement,
    Paragraph,
    Table,
    TableCaption,
    type UpcastElementEvent
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Admonition from "../admonition/admonition.js";
import Multicolumn from "../multicolumn/multicolumn.js";
import Aside from "./aside.js";

/** An aside in model notation, with `blocks` and the model `attributes`, such as a position. */
function aside(blocks: string, attributes = "") {
    return `<asideBlock${attributes}><asideContent>${blocks}</asideContent></asideBlock>`;
}

function paragraph(text: string) {
    return `<paragraph>${text}</paragraph>`;
}

const WRAPPED = " position=\"wrap-right\"";
const COLUMN = "<div class=\"trilium-multicolumn-column\">";

describe("AsideEditing", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, List, Table, Admonition, Multicolumn, Aside
        ]);
    });

    function model() {
        return getModelData(editor.model, { withoutSelection: true });
    }

    /** The saved form of the selected content, as a copy puts it on the clipboard. */
    function copy() {
        const content = editor.model.getSelectedContent(editor.model.document.selection);
        return editor.data.stringify(content);
    }

    function getRoot() {
        return editor.model.document.getRoot() as ModelElement;
    }

    function getWidget() {
        const widget = editor.editing.view.getDomRoot()?.querySelector("aside");
        if (!widget) {
            throw new Error("Expected a rendered aside.");
        }
        return widget;
    }

    describe("conversion", () => {
        it("loads an aside with its position and width, and saves its blocks in it", () => {
            const data = "<aside style=\"--aside-width:18em;\" data-position=\"wrap-right\">" +
                "<p>One</p><p>Two</p></aside>";
            editor.setData(data);

            expect(model()).toBe(aside(paragraph("One") + paragraph("Two"),
                " customWidth=\"18em\" position=\"wrap-right\""));
            expect(editor.getData()).toBe(data);
        });

        it("loads the background color of an aside, and saves it as its style", () => {
            const data = "<aside style=\"background-color:#e64d4d;\" " +
                "data-position=\"wrap-right\"><p>A</p></aside><aside><p>B</p></aside>";
            // Whether a later converter, such as General HTML Support, can still take the style.
            const consumableColors: (boolean | null)[] = [];
            editor.data.upcastDispatcher.on<UpcastElementEvent>("element:aside",
                (_evt, { viewItem }, api) => {
                    consumableColors.push(
                        api.consumable.test(viewItem, { styles: "background-color" }));
                }, { priority: "low" });
            editor.setData(data);

            expect(model()).toBe(aside(paragraph("A"), ` backgroundColor="#e64d4d"${WRAPPED}`) +
                aside(paragraph("B")));
            expect(editor.getData()).toBe(data);
            expect(consumableColors).toEqual([ false, null ]);
        });

        it("loads an aside without a position in the flow, with text, nothing or classes", () => {
            editor.setData(
                "<aside>Text</aside><aside></aside>" +
                "<aside class=\"sidebar\" data-position=\"top\"><p>A</p></aside>"
            );

            expect(model()).toBe(
                aside(paragraph("Text")) + aside(paragraph("")) + aside(paragraph("A")));
            expect(editor.getData()).toBe(
                "<aside><p>Text</p></aside><aside><p>&nbsp;</p></aside><aside><p>A</p></aside>");
        });

        it("leaves the text of an aside where no block can go, such as a caption", async () => {
            editor = await createTestEditor([ Essentials, Paragraph, Table, TableCaption, Aside ]);
            editor.setData("<figure class=\"table\"><table><tbody><tr><td>Cell</td></tr></tbody>" +
                "</table><figcaption><aside><p>Caption</p></aside></figcaption></figure>");

            expect(model()).toBe("<table><tableRow><tableCell>" + paragraph("Cell") +
                "</tableCell></tableRow><caption>Caption</caption></table>");
        });

        it("leaves an admonition an admonition, in an aside too", () => {
            const tip = "<aside class=\"admonition tip\"><p>Tip</p></aside>";
            const note = "<aside class=\"admonition note\"><p>Note</p></aside>";
            editor.setData(`${tip}<aside>${note}</aside>`);

            expect(model()).toBe(
                `<aside admonitionType="tip">${paragraph("Tip")}</aside>` +
                aside(`<aside admonitionType="note">${paragraph("Note")}</aside>`));
            expect(editor.getData()).toBe(`${tip}<aside>${note}</aside>`);
        });

        it("saves a copy of a whole aside, and of blocks in one, without an inner element", () => {
            setModelData(editor.model, `[${aside(paragraph("A") + paragraph("B"), WRAPPED)}]`);
            expect(copy()).toBe("<aside data-position=\"wrap-right\"><p>A</p><p>B</p></aside>");

            setModelData(editor.model, aside("<paragraph>[A</paragraph><paragraph>B]</paragraph>"));
            expect(copy()).toBe("<p>A</p><p>B</p>");

            setModelData(editor.model, `${paragraph("[Before")}${aside(paragraph("A"))}` +
                paragraph("After]"));
            expect(copy()).toBe("<p>Before</p><aside><p>A</p></aside><p>After</p>");
        });

        it("takes the element and its color before General HTML Support", async () => {
            editor = await createTestEditor([
                Essentials, Paragraph, GeneralHtmlSupport, Admonition, Aside
            ], {
                htmlSupport: {
                    allow: [ { name: /.*/, attributes: true, classes: true, styles: true } ]
                }
            });
            const data = "<aside style=\"background-color:#e64d4d;\" data-position=\"left\">" +
                "<p>A</p></aside><aside class=\"admonition note\"><p>B</p></aside>";
            editor.setData(data);

            expect(model()).toBe(
                aside(paragraph("A"), " backgroundColor=\"#e64d4d\" position=\"left\"") +
                `<aside admonitionType="note">${paragraph("B")}</aside>`);
            expect(editor.getData()).toBe(data);
        });
    });

    describe("editing view", () => {
        it("draws a widget with a selection handle around an editable, placed by its position",
            () => {
                setModelData(editor.model, aside(paragraph("A[]"), WRAPPED));
                const widget = getWidget();

                expect([ ...widget.classList ]).toEqual(expect.arrayContaining([
                    "ck-widget", "ck-widget_with-selection-handle", "ck-widget_resizable",
                    "ck-widget_resize-anchor-right", "ck-widget_fixed-height"
                ]));
                expect(widget.getAttribute("data-position")).toBe("wrap-right");
                const corner = widget.querySelector(".ck-widget__resize-handle_corner");
                expect(corner && getComputedStyle(corner).cursor).toBe("ew-resize");
                const content = widget.querySelector(":scope > .aside-content");
                expect(content?.getAttribute("contenteditable")).toBe("true");
                expect(content?.getAttribute("aria-label")).toBe("Aside");
                expect(content?.textContent).toBe("A");

                editor.execute("asidePosition", { value: "wrap-left" });
                expect(getWidget()).toBe(widget);
                expect(widget.getAttribute("data-position")).toBe("wrap-left");
                expect(widget.classList.contains("ck-widget_resize-anchor-left")).toBe(true);
            });

        it("paints the background color of the aside, and none once it is removed", () => {
            setModelData(editor.model,
                aside(paragraph("A[]"), ` backgroundColor="#e64d4d"${WRAPPED}`));
            const widget = getWidget();
            expect(widget.style.backgroundColor).toBe("rgb(230, 77, 77)");

            editor.execute("asideColor", { value: "#4d99e6" });
            expect(widget.style.backgroundColor).toBe("rgb(77, 153, 230)");

            editor.execute("asideColor", { value: null });
            expect(getWidget()).toBe(widget);
            expect(widget.style.backgroundColor).toBe("");
        });

        it("gives a colored aside the hue of its color for the theme tints, without saving it",
            () => {
                setModelData(editor.model,
                    aside(paragraph("A[]"), ` backgroundColor="#e64d4d"${WRAPPED}`));
                const widget = getWidget();
                const hue = () => [
                    widget.style.getPropertyValue("--custom-color-hue"),
                    widget.classList.contains("with-hue")
                ];
                expect(hue()).toEqual([ "0", true ]);
                expect(editor.getData()).not.toMatch(/hue/);

                const colors = [ "hsl(210, 75%, 60%)", "rgb(153, 77, 230)", "#555555",
                    "transparent", "inherit", null ];
                expect(colors.map((value) => {
                    editor.execute("asideColor", { value });
                    return hue();
                })).toEqual([
                    [ "210", true ], [ "270", true ], [ "", false ], [ "", false ], [ "", false ],
                    [ "", false ]
                ]);
                expect(getWidget()).toBe(widget);
            });

        it("looks selected while it holds the selection, as while it is selected", () => {
            setModelData(editor.model, aside(paragraph("A[]")) + paragraph("B"));
            const isMarked = () => getWidget().classList.contains("ck-widget_selected");
            expect(isMarked()).toBe(true);

            editor.model.change((writer) => writer.setSelection(getRoot().getChild(1), 0));
            expect(isMarked()).toBe(false);

            editor.model.change((writer) => writer.setSelection(getRoot().getChild(0), "on"));
            expect(isMarked()).toBe(true);
        });

        it("shows a placeholder while the aside holds only an empty block", () => {
            setModelData(editor.model, aside("<paragraph>[]</paragraph>"));
            const block = () => getWidget().querySelector(".aside-content > p");
            expect(block()?.getAttribute("data-placeholder"))
                .toBe("Type the content of the aside");
            expect(block()?.classList.contains("ck-placeholder")).toBe(true);

            editor.model.change((writer) => {
                editor.model.insertContent(writer.createText("Typed"));
            });
            expect(block()?.classList.contains("ck-placeholder")).toBe(false);
        });
    });

    describe("schema", () => {
        it("allows an aside where a block goes, and only its content in it", () => {
            setModelData(editor.model,
                aside(paragraph("[]")) +
                "<table><tableRow><tableCell>" + paragraph("") + "</tableCell></tableRow></table>"
            );
            const schema = editor.model.schema;
            const asideBlock = getRoot().getChild(0) as ModelElement;
            const cell = editor.model.createPositionFromPath(getRoot(), [ 1, 0, 0, 0 ]).parent;

            for (const parent of [ getRoot(), cell ]) {
                expect(schema.checkChild(parent, "asideBlock")).toBe(true);
            }
            expect(schema.checkChild(asideBlock, "asideContent")).toBe(true);
            expect(schema.checkChild(asideBlock, "paragraph")).toBe(false);
            expect(schema.checkChild(getRoot(), "asideContent")).toBe(false);
            expect(schema.isObject(asideBlock)).toBe(true);
            expect(schema.isLimit(asideBlock.getChild(0) as ModelElement)).toBe(true);
        });
    });

    describe("post-fixer", () => {
        it("gives an aside without content an empty block, and merges extra content", () => {
            editor.setData("<p>Text</p>");
            editor.model.change((writer) => {
                writer.append(writer.createElement("asideBlock"), getRoot());

                const twoContents = writer.createElement("asideBlock");
                for (const text of [ "A", "B" ]) {
                    const content = writer.createElement("asideContent");
                    const block = writer.createElement("paragraph");
                    writer.insertText(text, block);
                    writer.append(block, content);
                    writer.append(content, twoContents);
                }
                writer.append(twoContents, getRoot());
            });

            expect(model()).toBe(paragraph("Text") + aside(paragraph("")) +
                aside(paragraph("A") + paragraph("B")));
        });

        it("keeps the content of an aside from becoming empty", () => {
            setModelData(editor.model, aside(paragraph("A") + paragraph("B")));
            const content = (getRoot().getChild(0) as ModelElement).getChild(0) as ModelElement;

            editor.model.change((writer) => writer.remove(writer.createRangeIn(content)));

            expect(model()).toBe(aside(paragraph("")));
        });

        it("replaces an aside inside another with its blocks, also where a paste puts one", () => {
            editor.setData("<aside><p>A</p><aside data-position=\"left\"><p>B</p></aside></aside>");
            expect(model()).toBe(aside(paragraph("A") + paragraph("B")));

            setModelData(editor.model, aside(paragraph("Target[]"), WRAPPED));
            const pasted = editor.data.parse(
                "<aside><p>Pasted</p></aside>" +
                `<div class="trilium-multicolumn-layout">${COLUMN}<aside><p>In a column</p>` +
                `</aside></div>${COLUMN}<p>Second</p></div></div>`,
                "$clipboardHolder"
            );
            editor.model.insertContent(pasted);

            expect(model()).toBe(aside(
                paragraph("Target") + paragraph("Pasted") +
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    `<multicolumnColumn>${paragraph("In a column")}</multicolumnColumn>` +
                    `<multicolumnColumn>${paragraph("Second")}</multicolumnColumn>` +
                "</multicolumnLayout>",
                WRAPPED
            ));
        });
    });
});
