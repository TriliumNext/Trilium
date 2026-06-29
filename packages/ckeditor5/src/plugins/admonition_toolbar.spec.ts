import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, WidgetToolbarRepository } from "ckeditor5";
import { Admonition } from "@triliumnext/ckeditor5-admonition";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import AdmonitionToolbar from "./admonition_toolbar.js";
import AdmonitionTypeDropdown from "./admonition_type_dropdown.js";

// Helper: place the cursor inside the first paragraph within the first aside in the model.
function selectInsideFirstAdmonition(editor: ClassicEditor): void {
    editor.model.change((writer) => {
        const root = editor.model.document.getRoot();
        if (!root) {
            return;
        }
        const aside = root.getChild(0);
        if (!aside || !aside.is("element")) {
            return;
        }
        const para = aside.getChild(0);
        if (!para || !para.is("element")) {
            return;
        }
        writer.setSelection(writer.createPositionAt(para, 0));
    });
}

describe("AdmonitionToolbar", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Admonition, AdmonitionTypeDropdown, AdmonitionToolbar]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(AdmonitionToolbar)).toBeInstanceOf(AdmonitionToolbar);
    });

    it("declares the required plugins including WidgetToolbarRepository, Admonition, and AdmonitionTypeDropdown", () => {
        const requires = AdmonitionToolbar.requires;
        expect(requires).toContain(WidgetToolbarRepository);
        expect(requires).toContain(Admonition);
        expect(requires).toContain(AdmonitionTypeDropdown);
    });

    it("registers the admonition toolbar in WidgetToolbarRepository", () => {
        const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
            _toolbarDefinitions: Map<string, unknown>;
        };
        expect(repository._toolbarDefinitions.has("admonition")).toBe(true);
    });

    describe("getRelatedElement", () => {
        // Access the registered getRelatedElement callback from the toolbar repository.
        function getRelatedElementFn(ed: ClassicEditor): (selection: unknown) => unknown {
            const repository = ed.plugins.get(WidgetToolbarRepository) as unknown as {
                _toolbarDefinitions: Map<string, {
                    getRelatedElement: (selection: unknown) => unknown;
                }>;
            };
            const def = repository._toolbarDefinitions.get("admonition");
            if (!def) {
                throw new Error("Admonition toolbar definition not found in WidgetToolbarRepository.");
            }
            return def.getRelatedElement;
        }

        it("returns null when the selection has no first position", () => {
            const fn = getRelatedElementFn(editor);
            const result = fn({ getFirstPosition: () => null });
            expect(result).toBeNull();
        });

        it("returns the admonition view element when selection is inside an admonition", () => {
            editor.setData('<aside class="admonition note"><p>Hello</p></aside>');
            selectInsideFirstAdmonition(editor);

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).not.toBeNull();
        });

        it("returns null when selection is in a plain paragraph (not an admonition)", () => {
            setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).toBeNull();
        });

        it("returns the admonition element when walking up from deeply nested content", () => {
            editor.setData('<aside class="admonition note"><p>Deep<strong>nested</strong></p></aside>');
            // Place cursor at the end of the paragraph to be inside a nested strong element.
            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) {
                    return;
                }
                const aside = root.getChild(0);
                if (!aside || !aside.is("element")) {
                    return;
                }
                const para = aside.getChild(0);
                if (!para || !para.is("element")) {
                    return;
                }
                writer.setSelection(writer.createPositionAt(para, "end"));
            });

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).not.toBeNull();
        });

        it("returns null when selection position parent hierarchy has no admonition ancestor", () => {
            // Make sure no admonition is in the document - use plain text only.
            setModelData(editor.model, "<paragraph>just a text[]</paragraph>");

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).toBeNull();
        });

        it("returns the admonition element for different admonition types", () => {
            // Test with a "warning" type admonition to ensure type doesn't affect element detection.
            editor.setData('<aside class="admonition warning"><p>Warning content</p></aside>');
            selectInsideFirstAdmonition(editor);

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).not.toBeNull();
        });

        it("returns null when the aside ancestor has no class attribute (getAttribute returns null)", () => {
            // Exercises the `|| ""` branch on line 30: getAttribute?.("class") returns null,
            // so classes falls back to "" and the loop does not return the element.
            const fn = getRelatedElementFn(editor);

            // Build a fake view node chain: text node → p → aside (no class) → root (null parent)
            const rootNode = { is: () => false, getAttribute: () => null, parent: null };
            const asideNode = {
                is: (type: string, name: string) => type === "element" && name === "aside",
                getAttribute: (_attr: string) => null,
                parent: rootNode
            };
            const pNode = {
                is: () => false,
                getAttribute: () => null,
                parent: asideNode
            };
            const fakeSelection = {
                getFirstPosition: () => ({ parent: pNode })
            };

            const result = fn(fakeSelection);
            expect(result).toBeNull();
        });

        it("skips a div ancestor whose getAttribute is undefined (covers optional-chain falsy branch)", () => {
            // Exercises the getAttribute?.() optional-chain: if getAttribute is absent on the
            // node, the optional chain short-circuits to undefined, `|| ""` kicks in, and the
            // loop continues without returning the node.
            const fn = getRelatedElementFn(editor);

            const rootNode = { is: () => false, parent: null };
            const divNode = {
                is: (type: string, name: string) => type === "element" && name === "div",
                // no getAttribute property at all → optional chain yields undefined
                parent: rootNode
            };
            const pNode = {
                is: () => false,
                parent: divNode
            };
            const fakeSelection = {
                getFirstPosition: () => ({ parent: pNode })
            };

            const result = fn(fakeSelection);
            expect(result).toBeNull();
        });
    });
});
