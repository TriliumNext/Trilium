import {
    _getModelData as getModelData, _setModelData as setModelData, type Batch, type ClassicEditor,
    GeneralHtmlSupport, type ModelDocumentChangeEvent, type ModelElement
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createHeadingsEditor, findBlock, getRoot, outline } from "../../../test/headings-kit.js";

/** `intro`, a collapsed `Alpha` with `a1` and `a2` under it, then `Beta` with `b1` under it. */
const DOCUMENT = "<paragraph>intro</paragraph>" +
    "<heading2 headingCollapsed=\"true\">Alpha</heading2>" +
    "<paragraph>a1</paragraph><paragraph>a2</paragraph>" +
    "<heading2>Beta</heading2><paragraph>b1</paragraph>";

describe("CollapsibleHeadings", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createHeadingsEditor();
    });

    describe("conversion", () => {
        it("loads and saves the collapsed state on the heading", () => {
            const html = "<p>intro</p><h2 data-trilium-collapsed=\"true\">Alpha</h2><p>a1</p>" +
                "<h2>Beta</h2>";
            editor.setData(html);

            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), Beta");
            expect(editor.getData()).toBe(html);
        });

        it("drops a collapsed state that hides nothing, and any value but true", () => {
            editor.setData(
                "<h2 data-trilium-collapsed=\"true\">Empty</h2>" +
                "<h2 data-trilium-collapsed=\"false\">Other</h2><p>o1</p>"
            );

            expect(outline(editor)).toBe("Empty, Other, o1");
            expect(editor.getData()).toBe("<h2>Empty</h2><h2>Other</h2><p>o1</p>");
        });

        it("consumes the attribute before General HTML Support does", async () => {
            const ghsEditor = await createHeadingsEditor([ GeneralHtmlSupport ], {
                htmlSupport: {
                    allow: [ { name: /^h[2-6]$/, attributes: true, classes: true, styles: true } ]
                }
            });

            ghsEditor.setData(
                "<h2 data-trilium-collapsed=\"true\" data-other=\"x\">A</h2><p>a1</p>" +
                "<h2 data-trilium-collapsed=\"no\">B</h2><p>b1</p>"
            );

            expect(outline(ghsEditor)).toBe("▸A, (a1), B, b1");
            expect(ghsEditor.getData()).toBe(
                "<h2 data-trilium-collapsed=\"true\" data-other=\"x\">A</h2><p>a1</p>" +
                "<h2>B</h2><p>b1</p>"
            );
        });

        it("marks the headings outside lists, which keep room for the arrow", () => {
            setModelData(editor.model,
                "<heading2>A</heading2>" +
                "<heading3 listItemId=\"i\" listIndent=\"0\" listType=\"bulleted\">B</heading3>" +
                "<paragraph>[]p</paragraph>");
            const isMarked = (text: string) => editor.editing.mapper
                .toViewElement(findBlock(editor, text))?.hasClass("trilium-section-heading");

            expect([ isMarked("A"), isMarked("B") ]).toEqual([ true, false ]);

            // The marks follow a heading into and out of a list.
            editor.model.change((writer) => {
                writer.removeAttribute("listItemId", findBlock(editor, "B"));
                writer.removeAttribute("listIndent", findBlock(editor, "B"));
                writer.removeAttribute("listType", findBlock(editor, "B"));
                writer.setAttributes({ listItemId: "j", listIndent: 0, listType: "bulleted" },
                    findBlock(editor, "A"));
            });
            expect([ isMarked("A"), isMarked("B") ]).toEqual([ false, true ]);
        });
    });

    describe("toggleHeadingCollapse", () => {
        it("is enabled in a heading with blocks under it, and shows its state", () => {
            const command = editor.commands.get("toggleHeadingCollapse");
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Al[]pha"));
            expect([ command?.isEnabled, command?.value ]).toEqual([ true, true ]);

            setModelData(editor.model, DOCUMENT.replace("Beta", "B[]eta"));
            expect([ command?.isEnabled, command?.value ]).toEqual([ true, false ]);

            setModelData(editor.model, DOCUMENT.replace("intro", "in[]tro"));
            expect(command?.isEnabled).toBe(false);

            setModelData(editor.model, "<heading2>Alone[]</heading2><heading2>Next</heading2>");
            expect(command?.isEnabled).toBe(false);
        });

        it("collapses and expands without an undo step", () => {
            setModelData(editor.model, "<paragraph>intro</paragraph><heading2>Al[]pha</heading2>" +
                "<paragraph>a1</paragraph><heading2>Beta</heading2>");
            editor.execute("insertText", { text: "x" });
            const batches = recordBatches();

            editor.execute("toggleHeadingCollapse");
            expect(outline(editor)).toBe("intro, ▸Alxpha, (a1), Beta");

            // Undo takes back the typing and leaves the section collapsed.
            editor.execute("undo");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), Beta");

            editor.execute("toggleHeadingCollapse");
            expect(outline(editor)).toBe("intro, Alpha, a1, Beta");
            expect(batches.map((batch) => batch.isUndoable)).toEqual([ false, true, false ]);
        });

        it("moves the selection from the section it collapses to the end of the heading", () => {
            const toggleAlpha = () => {
                editor.plugins.get("CollapsibleHeadingsEditing").toggle(findBlock(editor, "Alpha"));
            };
            setModelData(editor.model, "<heading2>Alpha</heading2><paragraph>a[1</paragraph>" +
                "<paragraph>a]2</paragraph><heading2>Beta</heading2>");

            toggleAlpha();
            expect(getModelData(editor.model)).toBe(
                "<heading2 headingCollapsed=\"true\">Alpha[]</heading2><paragraph>a1</paragraph>" +
                "<paragraph>a2</paragraph><heading2>Beta</heading2>"
            );

            setModelData(editor.model, "<heading2>Alpha</heading2>" +
                "[<horizontalLine></horizontalLine>]<paragraph>a1</paragraph>");
            toggleAlpha();
            expect(getModelData(editor.model)).toBe(
                "<heading2 headingCollapsed=\"true\">Alpha[]</heading2>" +
                "<horizontalLine></horizontalLine><paragraph>a1</paragraph>"
            );
        });

        it("toggles on Ctrl+Alt+Enter and leaves other blocks to other handlers", () => {
            setModelData(editor.model, DOCUMENT.replace("Beta", "Beta[]"));
            const spy = vi.spyOn(editor, "execute");

            editor.editing.view.document.fire("keydown", keyData());
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), ▸Beta, (b1)");

            setModelData(editor.model, DOCUMENT.replace("intro", "intro[]"));
            spy.mockClear();
            editor.editing.view.document.fire("keydown", keyData());
            expect(spy).not.toHaveBeenCalledWith("toggleHeadingCollapse");
        });

        it("announces the new state", () => {
            const announce = vi.spyOn(editor.ui.ariaLiveAnnouncer, "announce");
            setModelData(editor.model, DOCUMENT.replace("Beta", "Beta[]"));

            editor.execute("toggleHeadingCollapse");
            editor.execute("toggleHeadingCollapse");

            expect(announce.mock.calls.map(([ text ]) => text))
                .toEqual([ "Section collapsed", "Section expanded" ]);
        });

        it("does nothing for a heading without blocks under it", () => {
            setModelData(editor.model, "<heading2>A[]</heading2><heading2>B</heading2>");

            editor.execute("toggleHeadingCollapse");

            expect(outline(editor)).toBe("A, B");
        });
    });

    describe("model rules", () => {
        beforeEach(() => {
            setModelData(editor.model, DOCUMENT.replace("intro", "intro[]"));
        });

        it("keeps a loaded section collapsed", () => {
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");
        });

        it("keeps a section collapsed when its heading splits before its end", () => {
            setCaret("Alpha", 2);
            editor.execute("enter");
            expect(outline(editor)).toBe("intro, Al, ▸pha, (a1), (a2), Beta, b1");

            setModelData(editor.model, DOCUMENT);
            setCaret("Alpha", 0);
            editor.execute("enter");
            expect(outline(editor)).toBe("intro, heading2, ▸Alpha, (a1), (a2), Beta, b1");
        });

        it("expands a section that a paragraph joins, in the same undo step", () => {
            editor.model.change((writer) => {
                writer.insertElement("paragraph",
                    writer.createPositionAfter(findBlock(editor, "Alpha")));
            });
            expect(outline(editor)).toBe("intro, Alpha, paragraph, a1, a2, Beta, b1");

            editor.execute("undo");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");
        });

        it("expands a section when removing the next heading adds blocks to it", () => {
            editor.model.change((writer) => writer.remove(findBlock(editor, "Beta")));
            expect(outline(editor)).toBe("intro, Alpha, a1, a2, b1");

            setModelData(editor.model, DOCUMENT.replace("<paragraph>b1</paragraph>", ""));
            editor.model.change((writer) => writer.remove(findBlock(editor, "Beta")));
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2)");
        });

        it("keeps a moved section collapsed unless it lands before other blocks", () => {
            const moveSection = (target: () => ModelElement, place: "before" | "after") => {
                editor.model.change((writer) => {
                    const range = writer.createRange(
                        writer.createPositionBefore(findBlock(editor, "Alpha")),
                        writer.createPositionAfter(findBlock(editor, "a2"))
                    );
                    writer.move(range, target(), place);
                });
            };

            moveSection(() => findBlock(editor, "b1"), "after");
            expect(outline(editor)).toBe("intro, Beta, b1, ▸Alpha, (a1), (a2)");

            moveSection(() => findBlock(editor, "Beta"), "after");
            expect(outline(editor)).toBe("intro, Beta, Alpha, a1, a2, b1");
        });

        it("expands a section that grows with a level change, but not one that shrinks", () => {
            setModelData(editor.model,
                "<heading3 headingCollapsed=\"true\">Sub</heading3><paragraph>s1</paragraph>" +
                "<heading3>Next</heading3><paragraph>n1</paragraph>");
            editor.model.change((writer) => writer.rename(findBlock(editor, "Sub"), "heading2"));
            expect(outline(editor)).toBe("Sub, s1, Next, n1");

            setModelData(editor.model,
                "<heading2 headingCollapsed=\"true\">Top</heading2><paragraph>t1</paragraph>" +
                "<heading3>Inner</heading3><paragraph>i1</paragraph>");
            editor.model.change((writer) => writer.rename(findBlock(editor, "Top"), "heading3"));
            expect(outline(editor)).toBe("▸Top, (t1), Inner, i1");
        });

        it("drops the collapsed state of a heading that becomes a paragraph or a list item", () => {
            editor.model.change((writer) => writer.rename(findBlock(editor, "Alpha"), "paragraph"));
            expect(outline(editor)).toBe("intro, Alpha, a1, a2, Beta, b1");

            setModelData(editor.model, DOCUMENT);
            editor.model.change((writer) => {
                writer.setAttributes({ listItemId: "x", listIndent: 0, listType: "bulleted" },
                    findBlock(editor, "Alpha"));
            });
            expect(outline(editor)).toBe("intro, Alpha, a1, a2, Beta, b1");
        });

        it("expands the section that the selection is set into, not as an undo step", () => {
            const batches = recordBatches();

            setCaret("a1", 1);

            expect(outline(editor)).toBe("intro, Alpha, a1, a2, Beta, b1");
            expect(batches.map((batch) => batch.isUndoable)).toEqual([ false ]);
        });

        it("restores a collapsed section that a deletion took along, on undo", () => {
            editor.model.change((writer) => {
                writer.setSelection(writer.createRange(
                    writer.createPositionAt(findBlock(editor, "intro"), 2),
                    writer.createPositionAt(findBlock(editor, "Beta"), 2)
                ));
            });
            editor.execute("delete");
            expect(outline(editor)).toBe("inta, b1");

            editor.execute("undo");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");
        });

        it("keeps a heading collapsed when undo puts it back without its section", () => {
            editor.model.change((writer) => writer.remove(findBlock(editor, "Alpha")));
            expect(outline(editor)).toBe("intro, a1, a2, Beta, b1");

            editor.execute("undo");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");
            editor.execute("redo");
            expect(outline(editor)).toBe("intro, a1, a2, Beta, b1");
        });

        it("keeps a section collapsed when its copy and removal happen in one change", () => {
            const model = editor.model;
            const section = model.createRange(
                model.createPositionBefore(findBlock(editor, "Alpha")),
                model.createPositionAfter(findBlock(editor, "a2"))
            );
            const content = model.getSelectedContent(model.createSelection(section));
            const html = editor.data.stringify(content);

            model.change((writer) => {
                writer.remove(section);
                model.insertContent(editor.data.parse(html),
                    writer.createPositionAfter(findBlock(editor, "b1")));
            });

            expect(outline(editor)).toBe("intro, Beta, b1, ▸Alpha, (a1), (a2)");
        });
    });

    describe("Enter at the end of a collapsed heading", () => {
        it("adds an empty heading of the same level after the section, as one undo step", () => {
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Alpha[]"));

            editor.execute("enter");
            expect(getModelData(editor.model)).toBe(
                "<paragraph>intro</paragraph><heading2 headingCollapsed=\"true\">Alpha</heading2>" +
                "<paragraph>a1</paragraph><paragraph>a2</paragraph><heading2>[]</heading2>" +
                "<heading2>Beta</heading2><paragraph>b1</paragraph>"
            );

            editor.execute("insertText", { text: "New" });
            editor.execute("enter");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), New, paragraph, Beta, b1");

            editor.execute("undo");
            editor.execute("undo");
            editor.execute("undo");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, b1");
        });

        it("adds the heading at the end of the root, or before a higher heading", () => {
            setModelData(editor.model,
                "<heading2 headingCollapsed=\"true\">Alpha[]</heading2><paragraph>a1</paragraph>");
            editor.execute("enter");
            expect(outline(editor)).toBe("▸Alpha, (a1), heading2");

            setModelData(editor.model,
                "<heading2>Top</heading2><heading3 headingCollapsed=\"true\">Sub[]</heading3>" +
                "<paragraph>s1</paragraph><heading2>Next</heading2>");
            editor.execute("enter");
            expect(outline(editor)).toBe("Top, ▸Sub, (s1), heading3, Next");
        });

        it("keeps the attributes of the heading but its block id", () => {
            setModelData(editor.model,
                "<heading2 alignment=\"center\" blockId=\"b1\" headingCollapsed=\"true\">" +
                "Alpha[]</heading2><paragraph>a1</paragraph>");
            editor.model.schema.extend("$block", { allowAttributes: [ "alignment", "blockId" ] });

            editor.execute("enter");

            const blank = getRoot(editor).getChild(2) as ModelElement;
            expect(Object.fromEntries(blank.getAttributes())).toEqual({ alignment: "center" });
        });

        it("deletes a selection that ends at the end of the heading first", () => {
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Alp[ha]"));

            editor.execute("enter");

            expect(outline(editor)).toBe("intro, ▸Alp, (a1), (a2), heading2, Beta, b1");
        });

        it("leaves other Enter presses in headings to the editor", () => {
            setModelData(editor.model, DOCUMENT.replace("Beta", "Beta[]"));
            editor.execute("enter");
            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), Beta, paragraph, b1");

            setModelData(editor.model, DOCUMENT.replace("Alpha", "Al[]pha"));
            editor.execute("enter");
            expect(outline(editor)).toBe("intro, Al, ▸pha, (a1), (a2), Beta, b1");
        });

        it("works with a real key press", async () => {
            setModelData(editor.model, DOCUMENT.replace("Alpha", "Alpha[]"));
            editor.editing.view.focus();

            await userEvent.keyboard("{Enter}");

            expect(outline(editor)).toBe("intro, ▸Alpha, (a1), (a2), heading2, Beta, b1");
        });
    });

    function setCaret(text: string, offset: number) {
        editor.model.change((writer) => writer.setSelection(findBlock(editor, text), offset));
    }

    /** The batches of the changes to the content from now on. */
    function recordBatches() {
        const batches: Batch[] = [];
        editor.model.document.on<ModelDocumentChangeEvent>("change:data",
            (_evt, batch) => batches.push(batch));
        return batches;
    }

    function keyData() {
        return {
            keyCode: 13, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false,
            preventDefault: vi.fn(), stopPropagation: vi.fn(), domTarget: document.body
        };
    }
});
