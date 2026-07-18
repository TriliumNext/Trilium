import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

describe("structuralPostFixer + bodyExistsPostFixer", () => {
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

    it("removes an orphan <summary> that ended up outside of <details>", () => {
        // Manually insert a summary at the root — the summary-invariant post-fixer
        // doesn't apply here (no <details> involved), so the structural one should
        // clean it up.
        model.change(writer => {
            const root = model.document.getRoot()!;
            writer.insert(writer.createElement("summary"), root, 0);
        });
        const data = getModelData(model, { withoutSelection: true });
        expect(data).not.toContain("<summary>");
    });

    it("removes a fully empty <details>", () => {
        // setModelData sets the model directly, bypassing schema; the structural
        // post-fixer then removes the empty container.
        setModelData(model, "<details></details>");
        const data = getModelData(model, { withoutSelection: true });
        expect(data).not.toContain("<details>");
    });

    it("re-inserts a body paragraph when a <details> is left with only its summary", () => {
        setModelData(model,
            "<details><summary>X</summary><paragraph>body</paragraph></details>"
        );
        model.change(writer => {
            const details = model.document.getRoot()!.getChild(0)!;
            // Body block (index 1) — remove it and expect the post-fixer to replace it.
            writer.remove(details.getChild(1)!);
        });
        expect(getModelData(model, { withoutSelection: true })).toBe(
            "<details><summary>X</summary><paragraph></paragraph></details>"
        );
    });
});
