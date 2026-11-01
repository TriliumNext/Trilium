import { ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { registerTestCleanup } from "../../test/globals-test-kit.js";
import SkipUnchangedAttributes from "./skip_unchanged_attributes.js";

describe("SkipUnchangedAttributes", () => {
    let editor: ClassicEditor;
    let domRoot: HTMLElement;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, SkipUnchangedAttributes]);
        domRoot = getDomRoot(editor);
    });

    it("writes only the class of the root when the focus changes", () => {
        expect(domRoot.getAttribute("lang")).toBe("en");
        expect(domRoot.getAttribute("dir")).toBe("ltr");

        const written = recordAttributeWrites(domRoot, () => {
            editor.ui.focusTracker.isFocused = true;
        });

        expect(domRoot.classList).toContain("ck-focused");
        expect(written).toEqual(["class"]);
    });

    it("writes attributes that are new or change value", () => {
        const written = recordAttributeWrites(domRoot, () => {
            editor.editing.view.change((writer) => {
                writer.setAttribute("lang", "ro", getViewRoot(editor));
                writer.setAttribute("data-trilium-test", "1", getViewRoot(editor));
            });
        });

        expect(written.sort()).toEqual(["data-trilium-test", "lang"]);
        expect(domRoot.getAttribute("lang")).toBe("ro");
        expect(domRoot.getAttribute("data-trilium-test")).toBe("1");
    });

    it("renames an unsafe attribute that the DOM already has", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        registerTestCleanup(() => warn.mockRestore());
        domRoot.setAttribute("onclick", "void 0");

        editor.editing.view.change((writer) => {
            writer.setAttribute("onclick", "void 0", getViewRoot(editor));
        });

        expect(domRoot.hasAttribute("onclick")).toBe(false);
        expect(domRoot.getAttribute("data-ck-unsafe-attribute-onclick")).toBe("void 0");
    });
});

/** Runs `action` and returns the names of the attributes written on `element`, in order. */
function recordAttributeWrites(element: HTMLElement, action: () => void) {
    const observer = new MutationObserver(() => {});
    observer.observe(element, { attributes: true });
    action();
    const names = observer.takeRecords().map((record) => record.attributeName);
    observer.disconnect();
    return names;
}

function getViewRoot(editor: ClassicEditor) {
    const root = editor.editing.view.document.getRoot();
    if (!root) throw new Error("The editing view has no root.");
    return root;
}

function getDomRoot(editor: ClassicEditor) {
    const root = editor.editing.view.getDomRoot();
    if (!root) throw new Error("The editing view has no DOM root.");
    return root;
}
