import { ClassicEditor, CodeBlock, Essentials, Paragraph, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import CodeBlockHljsClass from "./code_block_hljs_class.js";

describe("CodeBlockHljsClass", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, CodeBlockHljsClass]);
    });

    /** Render a model fragment to the editing DOM and return the contenteditable root. */
    function render(content: string): Element {
        setModelData(editor.model, content);
        editor.editing.view.forceRender();
        const root = editor.editing.view.getDomRoot();
        if (!root) {
            throw new Error("Editing view has no DOM root.");
        }
        return root;
    }

    it("loads the plugin and exposes its name", () => {
        expect(editor.plugins.get(CodeBlockHljsClass)).toBeInstanceOf(CodeBlockHljsClass);
        expect(CodeBlockHljsClass.pluginName).toBe("CodeBlockHljsClass");
    });

    it("tags the editing-view <pre> so highlight.js themes can target it", () => {
        const root = render("<codeBlock language=\"plaintext\">foo[]</codeBlock>");
        const pre = root.querySelector("pre");

        // The theme rewrite in packages/highlightjs targets `.ck-content pre.hljs`, so the class
        // has to land on the <pre>, not on the inner <code>.
        expect(pre?.classList.contains("hljs")).toBe(true);
        expect(pre?.querySelector("code")?.classList.contains("hljs")).toBe(false);
    });

    it("keeps the class out of the stored data", () => {
        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]</codeBlock>");

        // Only the editing downcast is tagged — note content must stay free of the editor-only class.
        expect(editor.getData()).not.toContain("hljs");
    });

    it("tags every code block, including after a language change", () => {
        const root = render("<codeBlock language=\"plaintext\">one</codeBlock><codeBlock language=\"plaintext\">two[]</codeBlock>");
        expect([...root.querySelectorAll("pre")].every((pre) => pre.classList.contains("hljs"))).toBe(true);

        // forceValue keeps it a code block — a plain execute would toggle it back to a paragraph.
        editor.execute("codeBlock", { language: "css", forceValue: true });
        editor.editing.view.forceRender();

        const changed = root.querySelectorAll("pre");
        expect(changed.length).toBe(2);
        expect([...changed].every((pre) => pre.classList.contains("hljs"))).toBe(true);
    });
});
