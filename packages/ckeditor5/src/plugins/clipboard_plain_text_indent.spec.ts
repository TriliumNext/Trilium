import { _setModelData as setModelData, CodeBlock, Essentials, Heading, Indent, IndentBlock, Paragraph } from "ckeditor5";
import type { ClassicEditor, ViewDocumentFragment } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ClipboardPlainTextIndent, { viewToIndentedPlainText } from "./clipboard_plain_text_indent.js";

describe("ClipboardPlainTextIndent", () => {
    async function createEditor(html: string, extraConfig = {}) {
        const editor = await createTestEditor(
            [Essentials, Paragraph, Heading, Indent, IndentBlock, ClipboardPlainTextIndent],
            extraConfig
        );
        editor.setData(html);
        editor.execute("selectAll");
        return editor;
    }

    function copy(editor: ClassicEditor) {
        const dataTransfer = recordingDataTransfer();
        editor.editing.view.document.fire("copy", { dataTransfer, preventDefault: () => {}, method: "copy" });
        return dataTransfer;
    }

    it("prefixes each indented block with one tab per indent level", async () => {
        const editor = await createEditor([
            "<p>Top</p>",
            `<p style="margin-left:40px">One</p>`,
            `<p style="margin-left:80px">Two</p>`,
            `<h2 style="margin-left:40px">Heading</h2>`,
            "<p>Back</p>"
        ].join(""));

        expect(copy(editor).getData("text/plain")).toBe("Top\n\n\tOne\n\n\t\tTwo\n\n\tHeading\n\nBack");
    });

    it("indents every line of a block that holds soft breaks, but not past a trailing one", async () => {
        const editor = await createEditor(`<p style="margin-left:40px">First<br>Second<br><strong>Third<br></strong></p><p>End</p>`);

        expect(copy(editor).getData("text/plain")).toBe("\tFirst\n\tSecond\n\tThird\n\n\nEnd");
    });

    it("writes nothing for a copy of an empty selection", async () => {
        const editor = await createEditor(`<p style="margin-left:40px">One</p>`);
        setModelData(editor.model, `<paragraph blockIndent="40px">[]One</paragraph>`);

        expect(copy(editor).store).not.toHaveProperty("text/plain");
    });

    it("leaves a copy inside one block unindented, as CKEditor copies only its text", async () => {
        const editor = await createEditor(`<p style="margin-left:40px">One</p>`);

        expect(copy(editor).getData("text/plain")).toBe("One");
    });

    it("leaves the HTML flavor untouched", async () => {
        const editor = await createEditor(`<p style="margin-left:40px">One</p><p>Two</p>`);

        expect(copy(editor).getData("text/html")).toBe(`<p style="margin-left:40px;">One</p><p>Two</p>`);
    });

    it("counts levels against the configured offset and gives a foreign unit one level", async () => {
        const editor = await createEditor(
            `<p style="margin-left:4em">Two</p><p style="margin-left:15px">Foreign</p>`,
            { indentBlock: { offset: 2, unit: "em" } }
        );

        expect(copy(editor).getData("text/plain")).toBe("\t\tTwo\n\n\tForeign");
    });

    it("reads the right margin of right-to-left content", async () => {
        const editor = await createEditor(`<p style="margin-right:40px">Shalom</p><p>End</p>`, { language: { content: "he" } });

        expect(copy(editor).getData("text/plain")).toBe("\tShalom\n\nEnd");
    });

    it("serializes a fragment without changing it", async () => {
        const editor = await createEditor(`<p>One</p><p style="margin-left:40px">Two<br>Three</p>`);
        const content = editor.data.toView(
            editor.model.getSelectedContent(editor.model.document.selection),
            { isClipboardPipeline: true }
        );
        const before = editor.data.processor.toData(content);

        expect(viewToIndentedPlainText(editor, content)).toBe("One\n\n\tTwo\n\tThree");
        expect(editor.data.processor.toData(content)).toBe(before);
    });

    it("does not indent a block whose margin is zero or not a length", async () => {
        const editor = await createEditor("");
        const content = editor.data.processor.toView(
            `<p style="margin-left:0px">Zero</p><p style="margin-left:auto">Auto</p>`
        ) as ViewDocumentFragment;

        expect(viewToIndentedPlainText(editor, content)).not.toContain("\t");
    });

    describe("on paste", () => {
        const PLUGINS = [Essentials, Paragraph, Indent, IndentBlock, CodeBlock];

        async function pasteInto(text: string, { html = "", plugins = [...PLUGINS, ClipboardPlainTextIndent], config = {} } = {}) {
            const editor = await createTestEditor(plugins, config);
            paste(editor, text, html);
            return editor.getData();
        }

        function paste(editor: ClassicEditor, text: string, html = "") {
            const dataTransfer = recordingDataTransfer();
            dataTransfer.setData("text/plain", text);
            if (html) {
                dataTransfer.setData("text/html", html);
            }
            editor.editing.view.document.fire("paste", { dataTransfer, preventDefault: () => {}, stopPropagation: () => {} });
        }

        it("turns lines led by tabs into paragraphs indented one level per tab", async () => {
            const text = [
                "Plain text", "\tOne", "\t\tTwo", "\t\t\tThree", "\t\t\tThree again", "\t\tTwo", "\tOne", "Plain text"
            ].join("\n\n");

            expect(await pasteInto(text)).toBe([
                "<p>Plain text</p>",
                `<p style="margin-left:40px;">One</p>`,
                `<p style="margin-left:80px;">Two</p>`,
                `<p style="margin-left:120px;">Three</p>`,
                `<p style="margin-left:120px;">Three again</p>`,
                `<p style="margin-left:80px;">Two</p>`,
                `<p style="margin-left:40px;">One</p>`,
                "<p>Plain text</p>"
            ].join(""));
        });

        it("indents a paragraph by the tabs all of its lines share", async () => {
            const data = await pasteInto("\t\tDeeper\n\tShallower\n\n\tSame\n\tSame\n\nNone\n\tSome");

            expect(data).toMatch(/^<p style="margin-left:40px;">(&nbsp;| )+Deeper<br>Shallower<\/p>/);
            expect(data).toContain(`<p style="margin-left:40px;">Same<br>Same</p>`);
            expect(data).toMatch(/<p>None<br>(&nbsp;| )+Some<\/p>$/);

            expect(await pasteInto("\tOne\n\n\n\n\tTwo")).toBe(
                `<p style="margin-left:40px;">One</p><p>&nbsp;</p><p style="margin-left:40px;">Two</p>`
            );
        });

        it("restores what a copy of indented paragraphs wrote", async () => {
            const html = `<p>Top</p><p style="margin-left:40px;">One<br><br>Two</p><p style="margin-left:80px;">Deep</p>`;
            const source = await createEditor(html);

            expect(await pasteInto(copy(source).getData("text/plain"))).toBe(html);
        });

        it("counts levels in the configured offset and indents right-to-left content on the right", async () => {
            expect(await pasteInto("\t\tTwo", { config: { indentBlock: { offset: 2, unit: "em" } } }))
                .toBe(`<p style="margin-left:4em;">Two</p>`);
            expect(await pasteInto("\tShalom", { config: { language: { content: "he" } } }))
                .toBe(`<p style="margin-right:40px;">Shalom</p>`);
        });

        it("keeps the tabs of a paste into a code block", async () => {
            const editor = await createTestEditor([...PLUGINS, ClipboardPlainTextIndent]);
            setModelData(editor.model, `<codeBlock language="plaintext">[]</codeBlock>`);
            paste(editor, "\tfoo\n\tbar");

            expect(editor.getData()).toBe(`<pre><code class="language-plaintext">\tfoo\n\tbar</code></pre>`);
        });

        it("leaves the paste to CKEditor when there is HTML, no leading tab, or no margin-based indent", async () => {
            const cases: [string, Parameters<typeof pasteInto>[1]][] = [
                ["\tTabbed", { html: "<p>Tabbed</p>" }],
                ["Inner\ttab\n\nNo indent", {}],
                ["\tTabbed", { config: { indentBlock: { classes: ["indent-1", "indent-2"] } } }],
                ["\tTabbed", { plugins: [Essentials, Paragraph, ClipboardPlainTextIndent] }]
            ];

            for (const [text, options] of cases) {
                const plugins = (options?.plugins ?? PLUGINS).filter((plugin) => plugin !== ClipboardPlainTextIndent);
                expect(await pasteInto(text, options)).toBe(await pasteInto(text, { ...options, plugins }));
            }
        });
    });
});

function recordingDataTransfer() {
    const store: Record<string, string> = {};
    return {
        store,
        setData: (type: string, data: string) => { store[type] = data; },
        getData: (type: string) => store[type] ?? ""
    };
}
