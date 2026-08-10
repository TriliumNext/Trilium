import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Enter, Essentials, Paragraph, Delete as WidgetDelete } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Admonition from "./admonition.js";
import AdmonitionEditing from "./admonition_editing.js";

describe("AdmonitionEditing", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Admonition]);
    });

    it("declares its required plugins", () => {
        expect(AdmonitionEditing.requires).toContain(Enter);
        expect(AdmonitionEditing.requires).toContain(WidgetDelete);
        expect(AdmonitionEditing.pluginName).toBe("AdmonitionEditing");
    });

    it("registers the aside element and its type attribute in the schema", () => {
        const schema = editor.model.schema;

        expect(schema.isRegistered("aside")).toBe(true);
        expect(schema.checkChild(["$root", "aside"], "paragraph")).toBe(true);
        expect(schema.checkAttribute("aside", "admonitionType")).toBe(true);
    });

    describe("upcast", () => {
        it("reads the type from the element's class list", () => {
            editor.setData(`<aside class="admonition warning"><p>foo</p></aside>`);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                `<aside admonitionType="warning"><paragraph>foo</paragraph></aside>`
            );
        });

        it("falls back to the default type when no known type class is present", () => {
            editor.setData(`<aside class="admonition"><p>foo</p></aside>`);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                `<aside admonitionType="note"><paragraph>foo</paragraph></aside>`
            );
        });

        it("ignores unrelated classes", () => {
            editor.setData(`<aside class="admonition something-else"><p>foo</p></aside>`);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                `<aside admonitionType="note"><paragraph>foo</paragraph></aside>`
            );
        });

        it("leaves an aside without the admonition class alone", () => {
            editor.setData(`<aside><p>foo</p></aside>`);

            expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph>foo</paragraph>");
        });
    });

    describe("downcast", () => {
        it("writes the admonition class alongside the type", () => {
            setModelData(editor.model, `<aside admonitionType="caution"><paragraph>foo</paragraph></aside>`);

            expect(editor.getData()).toBe(`<aside class="admonition caution"><p>foo</p></aside>`);
        });
    });

    describe("post-fixer", () => {
        it("removes an admonition inserted with no content at all", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                const aside = writer.createElement("aside", { admonitionType: "tip" });
                writer.insert(aside, writer.createPositionAt(root ?? aside, "end"));
            });

            expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph>foo</paragraph>");
        });

        it("removes an admonition that ends up empty", () => {
            setModelData(editor.model, `<aside admonitionType="note"><paragraph>foo[]</paragraph></aside>`);

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                const aside = root?.getChild(0);
                if (aside?.is("element")) {
                    writer.remove(writer.createRangeIn(aside));
                }
            });

            expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph></paragraph>");
        });

        it("unwraps a misplaced admonition nested inside an inserted element", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                // The inserted element is the paragraph, so the post-fixer only finds the illegal
                // <aside> by scanning the inserted element's descendants.
                const paragraph = writer.createElement("paragraph");
                const aside = writer.createElement("aside", { admonitionType: "tip" });
                writer.insertElement("paragraph", aside, 0);
                writer.insert(aside, writer.createPositionAt(paragraph, 0));
                writer.insert(paragraph, writer.createPositionAt(root ?? paragraph, "end"));
            });

            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("<aside");
        });
    });

    describe("breaking out of an admonition", () => {
        it("leaves the admonition when Enter is pressed in an empty trailing block", () => {
            setModelData(
                editor.model,
                `<aside admonitionType="note"><paragraph>foo</paragraph><paragraph>[]</paragraph></aside>`
            );

            editor.editing.view.document.fire("enter", {
                preventDefault: vi.fn(),
                isSoft: false
            });

            expect(getModelData(editor.model)).toBe(
                `<aside admonitionType="note"><paragraph>foo</paragraph></aside><paragraph>[]</paragraph>`
            );
        });

        it("keeps the admonition when Enter is pressed in a non-empty block", () => {
            setModelData(editor.model, `<aside admonitionType="note"><paragraph>foo[]</paragraph></aside>`);

            editor.editing.view.document.fire("enter", {
                preventDefault: vi.fn(),
                isSoft: false
            });

            expect(getModelData(editor.model, { withoutSelection: true })).toContain(`<aside admonitionType="note">`);
        });

        it("ignores Enter outside an admonition", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            const executeSpy = vi.spyOn(editor, "execute");

            editor.editing.view.document.fire("enter", { preventDefault: vi.fn(), isSoft: false });

            // The default behaviour runs instead — the plugin never breaks out of an admonition.
            expect(executeSpy).not.toHaveBeenCalledWith("admonition");
        });

        it("leaves the admonition when Backspace is pressed in the first empty block", () => {
            setModelData(
                editor.model,
                `<aside admonitionType="note"><paragraph>[]</paragraph><paragraph>foo</paragraph></aside>`
            );

            editor.editing.view.document.fire("delete", {
                direction: "backward",
                preventDefault: vi.fn(),
                unit: "character"
            });

            expect(getModelData(editor.model)).toBe(
                `<paragraph>[]</paragraph><aside admonitionType="note"><paragraph>foo</paragraph></aside>`
            );
        });

        it("ignores a forward delete", () => {
            setModelData(editor.model, `<aside admonitionType="note"><paragraph>[]</paragraph></aside>`);
            const executeSpy = vi.spyOn(editor, "execute");

            editor.editing.view.document.fire("delete", { direction: "forward", preventDefault: vi.fn(), unit: "character" });

            expect(executeSpy).not.toHaveBeenCalledWith("admonition");
        });

        it("ignores Backspace in a block that is not the first one", () => {
            setModelData(
                editor.model,
                `<aside admonitionType="note"><paragraph>foo</paragraph><paragraph>[]</paragraph></aside>`
            );
            const executeSpy = vi.spyOn(editor, "execute");

            editor.editing.view.document.fire("delete", { direction: "backward", preventDefault: vi.fn(), unit: "character" });

            expect(executeSpy).not.toHaveBeenCalledWith("admonition");
        });

        it("ignores Enter when the selection is not collapsed", () => {
            setModelData(
                editor.model,
                `<aside admonitionType="note"><paragraph>[foo]</paragraph></aside>`
            );
            const executeSpy = vi.spyOn(editor, "execute");

            editor.editing.view.document.fire("enter", { preventDefault: vi.fn(), isSoft: false });

            expect(executeSpy).not.toHaveBeenCalledWith("admonition");
        });
    });
});
