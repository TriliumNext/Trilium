import { ClassicEditor, CodeBlock, Essentials, GeneralHtmlSupport, List, Paragraph, _getModelData as getModelData, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import CodeBlockInsertParagraph from "./code_block_insert_paragraph.js";

const WRAPPER = ".ck-code-block__type-around";
const BUTTON = ".ck-code-block__type-around__button";

describe("CodeBlockInsertParagraph", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, CodeBlockInsertParagraph]);
    });

    /** Render a model fragment to the editing DOM and return the contenteditable root. */
    function render(content = "<codeBlock language=\"plaintext\">foo[]</codeBlock>"): Element {
        setModelData(editor.model, content);
        editor.editing.view.forceRender();
        const root = editor.editing.view.getDomRoot();
        if (!root) {
            throw new Error("Editing view has no DOM root.");
        }
        return root;
    }

    /** Fire a `mousedown` on the editing view document (the channel the plugin listens to). */
    function fireMouseDown(domTarget: unknown): ReturnType<typeof vi.fn> {
        const preventDefault = vi.fn();
        const viewDocument = editor.editing.view.document as unknown as { fire(event: string, data: unknown): void };
        viewDocument.fire("mousedown", { domTarget, preventDefault });
        return preventDefault;
    }

    describe("metadata", () => {
        it("loads the plugin", () => {
            expect(editor.plugins.get(CodeBlockInsertParagraph)).toBeInstanceOf(CodeBlockInsertParagraph);
        });

        it("exposes the plugin name and requires CodeBlock", () => {
            expect(CodeBlockInsertParagraph.pluginName).toBe("CodeBlockInsertParagraph");
            expect(CodeBlockInsertParagraph.requires).toContain(CodeBlock);
        });
    });

    describe("UI injection", () => {
        it("injects two type-around buttons into the code block's mapped <code>", () => {
            const root = render();

            expect(root.querySelectorAll(WRAPPER).length).toBe(1);
            expect(root.querySelectorAll(BUTTON).length).toBe(2);
            // The wrapper lives inside the <code> (the element the model is bound to), not the
            // parent <pre> — injecting into a non-mapped container breaks downcast removal.
            const wrapper = root.querySelector(WRAPPER);
            expect(wrapper?.parentElement?.tagName).toBe("CODE");
            expect(wrapper?.closest("pre")).not.toBeNull();
        });

        it("labels the buttons with localized before/after titles", () => {
            const root = render();

            expect(root.querySelector(`${BUTTON}_before`)?.getAttribute("title")).toBe("Insert paragraph before code block");
            expect(root.querySelector(`${BUTTON}_after`)?.getAttribute("title")).toBe("Insert paragraph after code block");
        });

        it("does not inject the UI into non-code-block elements", () => {
            const root = render("<paragraph>foo[]</paragraph><codeBlock language=\"plaintext\">bar</codeBlock>");

            // Only the single code block is decorated; the paragraph is left untouched.
            expect(root.querySelectorAll(WRAPPER).length).toBe(1);
        });
    });

    describe("inserting paragraphs on click", () => {
        it("inserts a paragraph after the code block when the after-button is pressed", () => {
            const root = render();

            const preventDefault = fireMouseDown(root.querySelector(`${BUTTON}_after`));

            expect(getModelData(editor.model)).toBe("<codeBlock language=\"plaintext\">foo</codeBlock><paragraph>[]</paragraph>");
            expect(preventDefault).toHaveBeenCalled();
        });

        it("inserts a paragraph before the code block when the before-button is pressed", () => {
            const root = render();

            fireMouseDown(root.querySelector(`${BUTTON}_before`));

            expect(getModelData(editor.model)).toBe("<paragraph>[]</paragraph><codeBlock language=\"plaintext\">foo</codeBlock>");
        });

        it("ignores a mousedown that is not on a type-around button", () => {
            const root = render();
            const before = getModelData(editor.model);

            fireMouseDown(root); // the editable root, which has no button ancestor

            expect(getModelData(editor.model)).toBe(before);
        });

        it("ignores a button that is detached from any code block", () => {
            render();
            const before = getModelData(editor.model);

            const orphan = document.createElement("div");
            orphan.className = "ck-code-block__type-around__button ck-code-block__type-around__button_after";
            fireMouseDown(orphan);

            expect(getModelData(editor.model)).toBe(before);
        });
    });

    describe("conversion lifecycle", () => {
        // Replacing the editor content (e.g. switching notes, which calls editor.setData)
        // must remove the decorated code block without tripping the view writer.
        it("survives content replacement that removes a decorated code block", () => {
            editor.setData("<pre><code class=\"language-plaintext\">foo</code></pre>");
            expect(() => editor.setData("<p>bar</p>")).not.toThrow();
        });
    });
});

describe("CodeBlockInsertParagraph — nested code blocks", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor(
            [Essentials, Paragraph, CodeBlock, List, GeneralHtmlSupport, CodeBlockInsertParagraph],
            { htmlSupport: { allow: [{ name: /.*/, attributes: true, classes: true, styles: true }] } }
        );
    });

    // Regression: a decorated code block inside a list item used to throw
    // `view-writer-invalid-range-container` on removal, because the UI element was injected
    // into the non-mapped <pre>. See the plugin's module comment.
    it("survives removing a code block nested in a list item", () => {
        editor.setData("<ul><li><pre><code class=\"language-plaintext\">foo</code></pre></li></ul>");
        expect(() => editor.setData("<p>bar</p>")).not.toThrow();
    });
});
