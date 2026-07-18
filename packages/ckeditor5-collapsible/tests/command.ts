import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

describe("CollapsibleCommand", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let model: ClassicEditor["model"];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, CollapsibleEditing]
        });
        model = editor.model;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    describe("execute", () => {
        it("inserts an empty collapsible at a collapsed caret and parks the caret in the new summary", () => {
            setModelData(model, "<paragraph>[]</paragraph>");
            editor.execute("collapsible");
            // Caret in the new summary; the empty body paragraph follows it.
            expect(getModelData(model)).toContain(
                "<details><summary>[]</summary><paragraph></paragraph></details>"
            );
        });

        it("wraps an intra-block text selection into a paragraph in the new body", () => {
            setModelData(model, "<paragraph>Hello [selected] world</paragraph>");
            editor.execute("collapsible");
            expect(getModelData(model, { withoutSelection: true })).toContain(
                "<details><summary></summary><paragraph>selected</paragraph></details>"
            );
        });

        it("preserves a multi-block selection as the new body", () => {
            setModelData(model,
                "[<paragraph>Block one</paragraph><paragraph>Block two</paragraph>]"
            );
            editor.execute("collapsible");
            const data = getModelData(model, { withoutSelection: true });
            expect(data).toContain("<paragraph>Block one</paragraph>");
            expect(data).toContain("<paragraph>Block two</paragraph>");
            // Both selected paragraphs end up inside the new <details>.
            expect(data).toMatch(/<details><summary><\/summary><paragraph>Block one<\/paragraph><paragraph>Block two<\/paragraph><\/details>/);
        });

        it("unwraps a nested <details> in the selection so we don't gain an extra level of nesting", () => {
            setModelData(model,
                "[<details>" +
                    "<summary>Inner</summary>" +
                    "<paragraph>Inner body</paragraph>" +
                "</details>]"
            );
            editor.execute("collapsible");
            const data = getModelData(model, { withoutSelection: true });
            // Exactly ONE <details> in the output — the inner one was unwrapped.
            expect((data.match(/<details>/g) ?? []).length).toBe(1);
            // The inner body is preserved as the new collapsible's body.
            expect(data).toContain("<paragraph>Inner body</paragraph>");
            // The inner summary's text isn't pulled into the new summary (the
            // new summary is the editable title for the user to fill in).
            expect(data).not.toContain("<summary>Inner");
        });
    });

    describe("refresh", () => {
        it("is enabled at a root-level caret", () => {
            setModelData(model, "<paragraph>[]</paragraph>");
            expect(editor.commands.get("collapsible")!.isEnabled).toBe(true);
        });

        it("keeps value=false even when the caret is already inside a collapsible (it's not a toggle)", () => {
            setModelData(model,
                "<details><summary>X</summary><paragraph>[]</paragraph></details>"
            );
            expect(editor.commands.get("collapsible")!.value).toBe(false);
        });
    });
});
