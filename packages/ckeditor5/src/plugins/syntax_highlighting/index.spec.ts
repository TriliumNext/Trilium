import { _setModelData as setModelData, _getViewData as getViewData, ClassicEditor, CodeBlock, Essentials, GeneralHtmlSupport, HorizontalLine, Paragraph, type EditorConfig } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import SyntaxHighlighting from "./index.js";

// A tiny fake highlight.js that wraps the whole text in a single hljs-keyword
// span and, on request, can nest a second span. It tracks how it was called so
// tests can assert the highlightAuto vs highlight branch selection.
interface FakeHljs {
    highlight: ReturnType<typeof vi.fn>;
    highlightAuto: ReturnType<typeof vi.fn>;
}

function makeFakeHljs(html: (text: string) => string): FakeHljs {
    return {
        highlight: vi.fn((text: string) => ({ value: html(text) })),
        highlightAuto: vi.fn((text: string) => ({ value: html(text) }))
    };
}

const DEFAULT_MIME = "auto-detect";

async function createEditor(
    syntaxHighlighting: EditorConfig["syntaxHighlighting"],
    extraPlugins: EditorConfig["plugins"] = [],
    extraConfig: Partial<EditorConfig> = {}
): Promise<ClassicEditor> {
    return createTestEditor(
        [Essentials, Paragraph, CodeBlock, SyntaxHighlighting, ...(extraPlugins ?? [])],
        {
            syntaxHighlighting,
            ...extraConfig
        }
    );
}

describe("SyntaxHighlighting", () => {
    let editor: ClassicEditor | undefined;
    let fakeHljs: FakeHljs;

    beforeEach(() => {
        // Wrap the text in one span so a marker is generated for every codeblock.
        fakeHljs = makeFakeHljs((text) => `<span class="hljs-keyword">${escapeHtml(text)}</span>`);
    });

    function makeConfig(overrides: Partial<NonNullable<EditorConfig["syntaxHighlighting"]>> = {}): EditorConfig["syntaxHighlighting"] {
        return {
            enabled: true,
            defaultMimeType: DEFAULT_MIME,
            mapLanguageName: (mimeType: string) => mimeType,
            loadHighlightJs: async () => fakeHljs,
            ...overrides
        };
    }

    it("does nothing when the syntaxHighlighting config is missing", async () => {
        editor = await createEditor(undefined);
        const plugin = editor.plugins.get(SyntaxHighlighting);
        expect(plugin).toBeInstanceOf(SyntaxHighlighting);

        setModelData(editor.model, '<codeBlock language="javascript">const a[]</codeBlock>');
        // No conversion registered -> no highlight spans in the view.
        expect(getViewData(editor.editing.view)).not.toContain("hljs-keyword");
    });

    it("does nothing when syntaxHighlighting is disabled", async () => {
        const loadHighlightJs = vi.fn(async () => fakeHljs);
        editor = await createEditor(makeConfig({ enabled: false, loadHighlightJs }));

        setModelData(editor.model, '<codeBlock language="javascript">const a[]</codeBlock>');
        expect(loadHighlightJs).not.toHaveBeenCalled();
        expect(getViewData(editor.editing.view)).not.toContain("hljs-keyword");
    });

    it("highlights a code block, downcasting markers to spans", async () => {
        editor = await createEditor(makeConfig());

        setModelData(editor.model, '<codeBlock language="javascript">const a[]</codeBlock>');
        await flushPostFixers(editor);

        expect(fakeHljs.highlight).toHaveBeenCalledWith("const a", { language: "javascript" });
        expect(fakeHljs.highlightAuto).not.toHaveBeenCalled();

        const view = getViewData(editor.editing.view);
        expect(view).toContain("hljs-keyword");
        expect(view).toContain("data-syntax-result");
    });

    it("uses highlightAuto when the language matches the default mime type", async () => {
        editor = await createEditor(makeConfig());

        setModelData(editor.model, `<codeBlock language="${DEFAULT_MIME}">hello[]</codeBlock>`);
        await flushPostFixers(editor);

        expect(fakeHljs.highlightAuto).toHaveBeenCalledWith("hello");
        expect(fakeHljs.highlight).not.toHaveBeenCalled();
    });

    it("does not highlight plaintext code blocks", async () => {
        editor = await createEditor(makeConfig());

        setModelData(editor.model, '<codeBlock language="text-plain">plain text[]</codeBlock>');
        await flushPostFixers(editor);

        expect(fakeHljs.highlight).not.toHaveBeenCalled();
        expect(fakeHljs.highlightAuto).not.toHaveBeenCalled();
        expect(getViewData(editor.editing.view)).not.toContain("hljs-keyword");
    });

    it("re-highlights when the code block content changes, clearing old markers", async () => {
        editor = await createEditor(makeConfig());

        setModelData(editor.model, '<codeBlock language="javascript">const a[]</codeBlock>');
        await flushPostFixers(editor);
        expect(fakeHljs.highlight).toHaveBeenCalledTimes(1);

        // Append more text into the code block; the postfixer must clear the
        // previous markers and re-highlight.
        editor.model.change((writer) => {
            const codeBlock = editor?.model.document.getRoot()?.getChild(0);
            if (codeBlock && codeBlock.is("element")) {
                writer.insertText("bc", writer.createPositionAt(codeBlock, "end"));
            }
        });
        await flushPostFixers(editor);

        expect(fakeHljs.highlight).toHaveBeenLastCalledWith("const abc", { language: "javascript" });
        expect(getViewData(editor.editing.view)).toContain("hljs-keyword");
    });

    it("handles softBreaks (newlines) in code blocks", async () => {
        editor = await createEditor(makeConfig());

        editor.model.change((writer) => {
            const root = editor?.model.document.getRoot();
            if (!root) {
                return;
            }
            const codeBlock = writer.createElement("codeBlock", { language: "javascript" });
            writer.insertText("a", codeBlock);
            writer.insertElement("softBreak", codeBlock, "end");
            writer.insertText("b", codeBlock, "end");
            writer.insert(codeBlock, root, 0);
        });
        await flushPostFixers(editor);

        expect(fakeHljs.highlight).toHaveBeenCalledWith("a\nb", { language: "javascript" });
        expect(getViewData(editor.editing.view)).toContain("hljs-keyword");
    });

    it("handles nested spans and HTML-escaped entities in the highlight output", async () => {
        // Produce nested spans plus an escaped entity so the entity branch runs.
        fakeHljs = makeFakeHljs(() =>
            '<span class="hljs-meta">#<span class="hljs-keyword">include</span> <span class="hljs-string">&lt;stdio.h&gt;</span></span>');
        editor = await createEditor(makeConfig());

        editor.model.change((writer) => {
            const root = editor?.model.document.getRoot();
            if (!root) {
                return;
            }
            const codeBlock = writer.createElement("codeBlock", { language: "cpp" });
            writer.insertText("#include <stdio.h>", codeBlock);
            writer.insert(codeBlock, root, 0);
        });
        await flushPostFixers(editor);

        const view = getViewData(editor.editing.view);
        expect(view).toContain("hljs-meta");
        expect(view).toContain("hljs-keyword");
        expect(view).toContain("hljs-string");
    });

    it("uses only the first class when highlight.js emits a scoped (space-separated) class", async () => {
        fakeHljs = makeFakeHljs((text) => `<span class="hljs-title function_">${escapeHtml(text)}</span>`);
        editor = await createEditor(makeConfig());

        setModelData(editor.model, '<codeBlock language="python">def f[]</codeBlock>');
        await flushPostFixers(editor);

        const view = getViewData(editor.editing.view);
        expect(view).toContain("hljs-title");
        expect(view).not.toContain("function_");
    });

    it("does not highlight when the highlighted block is too large", async () => {
        editor = await createEditor(makeConfig());

        editor.model.change((writer) => {
            const root = editor?.model.document.getRoot();
            if (!root) {
                return;
            }
            const codeBlock = writer.createElement("codeBlock", { language: "javascript" });
            // 500+ children: each softBreak is one child.
            for (let i = 0; i < 501; i++) {
                writer.insertElement("softBreak", codeBlock, "end");
            }
            writer.insert(codeBlock, root, 0);
        });
        await flushPostFixers(editor);

        expect(fakeHljs.highlight).not.toHaveBeenCalled();
        expect(fakeHljs.highlightAuto).not.toHaveBeenCalled();
    });

    it("ignores a falsy highlight result", async () => {
        fakeHljs.highlight.mockReturnValue(undefined);
        editor = await createEditor(makeConfig());

        setModelData(editor.model, '<codeBlock language="javascript">const a[]</codeBlock>');
        await flushPostFixers(editor);

        expect(fakeHljs.highlight).toHaveBeenCalled();
        expect(getViewData(editor.editing.view)).not.toContain("hljs-keyword");
    });

    it("recursively finds code blocks nested inside other elements (GHS divs), skipping paragraphs and leaf elements", async () => {
        // <htmlDiv> wrapping a paragraph (skipped), a leaf <hr> (no children, so the
        // recurse branch is skipped) and another <htmlDiv> (recursed into) that holds
        // the code block. Inserting the whole subtree as one unit makes the postfixer
        // take the recursive lookForCodeBlocks path.
        editor = await createEditor(makeConfig(), [GeneralHtmlSupport, HorizontalLine], {
            htmlSupport: { allow: [{ name: /.*/, attributes: true, classes: true, styles: true }] }
        });

        editor.setData(
            '<div><p>intro</p><hr><div><pre><code class="language-javascript">const x</code></pre></div></div>');
        await flushPostFixers(editor);

        expect(fakeHljs.highlight).toHaveBeenCalledWith("const x", { language: "javascript" });
    });

    it("tolerates a stray closing span tag in the highlight output", async () => {
        // A closing </span> with no matching opening tag pops an empty stack, so
        // posStart is undefined and no marker is added for it.
        fakeHljs = makeFakeHljs((text) => `<span class="hljs-keyword">${escapeHtml(text)}</span></span>`);
        editor = await createEditor(makeConfig());

        setModelData(editor.model, '<codeBlock language="javascript">a[]</codeBlock>');
        await flushPostFixers(editor);

        expect(fakeHljs.highlight).toHaveBeenCalledWith("a", { language: "javascript" });
        expect(getViewData(editor.editing.view)).toContain("hljs-keyword");
    });

    it("handles an empty code block whose highlighter still emits a span", async () => {
        // An empty code block has no children, so the parser walks the span markup
        // with no corresponding child text (child stays null -> startOffset fallback,
        // and the child-fetch falls into the empty childText branch).
        fakeHljs = makeFakeHljs(() => '<span class="hljs-comment"></span>');
        editor = await createEditor(makeConfig());

        editor.model.change((writer) => {
            const root = editor?.model.document.getRoot();
            if (!root) {
                return;
            }
            const codeBlock = writer.createElement("codeBlock", { language: "javascript" });
            writer.insert(codeBlock, root, 0);
        });
        await flushPostFixers(editor);

        // The marker spans an empty range, so nothing is rendered, but the parse
        // path (null child / empty childText) ran without throwing.
        expect(fakeHljs.highlight).toHaveBeenCalledWith("", { language: "javascript" });
    });

    it("clears markers when a code block is removed", async () => {
        editor = await createEditor(makeConfig());

        setModelData(editor.model,
            '<codeBlock language="javascript">const a</codeBlock><paragraph>after[]</paragraph>');
        await flushPostFixers(editor);
        expect(fakeHljs.highlight).toHaveBeenCalledTimes(1);

        editor.model.change((writer) => {
            const codeBlock = editor?.model.document.getRoot()?.getChild(0);
            if (codeBlock) {
                writer.remove(codeBlock);
            }
        });
        await flushPostFixers(editor);

        // No re-highlight triggered by the removal itself.
        expect(fakeHljs.highlight).toHaveBeenCalledTimes(1);
    });
});

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

// The postfixer runs synchronously inside model.change, but markers are
// downcast on the next render; yield to flush any pending view updates.
async function flushPostFixers(editor: ClassicEditor): Promise<void> {
    editor.editing.view.forceRender();
    await Promise.resolve();
}
