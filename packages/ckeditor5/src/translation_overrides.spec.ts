import { Bookmark, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../test/editor-kit.js";
// Side effect: assigns window.CKEDITOR_TRANSLATIONS, the global CKEditor reads to relabel its
// built-in strings. Imported before any editor is created so the override is in place.
import "./translation_overrides.js";

describe("translation overrides", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Bookmark], {
            toolbar: { items: ["bookmark"] }
        });
    });

    it("are picked up by the editor UI (Bookmark relabelled to Anchor)", () => {
        const labels = toolbarLabels(editor);
        expect(labels).toContain("Anchor");
        expect(labels).not.toContain("Bookmark");
    });

    it("register the text-snippet relabels for the premium template feature", () => {
        // The Template feature is premium and not loaded here, so its relabel can't be exercised
        // through the UI — assert the override dictionary carries it instead.
        const dictionary = window.CKEDITOR_TRANSLATIONS?.en?.dictionary ?? {};
        expect(dictionary["Insert template"]).toBe("Insert text snippet");
        expect(dictionary["Search template"]).toBe("Search text snippet");
    });
});

function toolbarLabels(editor: ClassicEditor): string[] {
    const labels: string[] = [];
    for (const item of editor.ui.view.toolbar?.items ?? []) {
        // Toolbar items are buttons (label directly) or dropdowns (label on the inner buttonView).
        const view = item as unknown as { label?: unknown; buttonView?: { label?: unknown } };
        const label = typeof view.label === "string"
            ? view.label
            : typeof view.buttonView?.label === "string"
                ? view.buttonView.label
                : null;
        if (label) {
            labels.push(label);
        }
    }
    return labels;
}
