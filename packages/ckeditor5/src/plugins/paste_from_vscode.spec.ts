import { ClassicEditor, Code, CodeBlock, Essentials, Paragraph, _getModelData, _setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import PasteFromVsCode, { codeBlockLanguage, isVsCodeHtml, VSCODE_EDITOR_DATA, vsCodePasteHtml } from "./paste_from_vscode.js";

/** A CSS rule copied out of VS Code under a dark theme: the clipboard's HTML, verbatim. */
const VSCODE_HTML = `<meta charset='utf-8'><div style="color: #bbbebf;background-color: #121314;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;"><div><span style="color: #d7ba7d;">#trilium-error-overlay</span><span style="color: #bbbebf;"> </span><span style="color: #d7ba7d;">.tn-eo-title</span><span style="color: #bbbebf;"> {</span></div><div><span style="color: #bbbebf;">    </span><span style="color: #9cdcfe;">margin</span><span style="color: #bbbebf;">: </span><span style="color: #b5cea8;">0</span><span style="color: #bbbebf;">;</span></div><div><span style="color: #bbbebf;">    </span><span style="color: #9cdcfe;">font-size</span><span style="color: #bbbebf;">: </span><span style="color: #b5cea8;">1.4em</span><span style="color: #bbbebf;">;</span></div><div><span style="color: #bbbebf;">    </span><span style="color: #9cdcfe;">font-weight</span><span style="color: #bbbebf;">: </span><span style="color: #b5cea8;">600</span><span style="color: #bbbebf;">;</span></div><div><span style="color: #bbbebf;">}</span></div></div>`;

/** The style VS Code puts on the container, as in {@link VSCODE_HTML}. */
const VSCODE_STYLE = "color: #bbbebf;background-color: #121314;font-family: Menlo, Monaco, 'Courier New', monospace;"
    + "font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;";

/** The same copy as plain text. */
const VSCODE_TEXT = "#trilium-error-overlay .tn-eo-title {\n    margin: 0;\n    font-size: 1.4em;\n    font-weight: 600;\n}";

/** The `vscode-editor-data` entry of the same copy, verbatim. */
const VSCODE_CSS_DATA = `{"version":1,"id":"a35fc511-64ce-42fa-ad40-145ae9353182","isFromEmptySelection":false,"multicursorText":null,"mode":"css"}`;

function clipboard(text: string, editorData?: string, html = "") {
    const types: Record<string, string> = { "text/plain": text, "text/html": html };
    if (editorData !== undefined) {
        types[VSCODE_EDITOR_DATA] = editorData;
    }

    return { getData: (type: string) => types[type] ?? "" };
}

describe("PasteFromVsCode", () => {
    describe("codeBlockLanguage", () => {
        it("maps VS Code language IDs to code block languages", () => {
            expect(codeBlockLanguage("css")).toBe("text-css");
            expect(codeBlockLanguage("typescript")).toBe("application-typescript");
            expect(codeBlockLanguage("python")).toBe("text-x-python");
        });

        it("maps the IDs that differ from the Markdown names, or resolve to a variant there", () => {
            expect(codeBlockLanguage("shellscript")).toBe("text-x-sh");
            expect(codeBlockLanguage("typescriptreact")).toBe("text-typescript-jsx");
            expect(codeBlockLanguage("jsonc")).toBe("application-json");
            expect(codeBlockLanguage("json")).toBe("application-json");
            expect(codeBlockLanguage("java")).toBe("text-x-java");
            expect(codeBlockLanguage("sql")).toBe("text-x-sql");
        });

        it("returns null for a language Trilium has no MIME type for", () => {
            expect(codeBlockLanguage("makefile")).toBeNull();
            expect(codeBlockLanguage("")).toBeNull();
        });
    });

    describe("isVsCodeHtml", () => {
        it("recognizes the HTML VS Code writes", () => {
            expect(isVsCodeHtml(VSCODE_HTML)).toBe(true);
            // A single line: the container holds one line div.
            expect(isVsCodeHtml(`<div style="${VSCODE_STYLE}"><div><span style="color: #9cdcfe;">margin</span></div></div>`)).toBe(true);
            // An empty line is a bare <br> in the container rather than a line div.
            expect(isVsCodeHtml(`<div style="${VSCODE_STYLE}"><div>a</div><br><div>b</div></div>`)).toBe(true);
        });

        it("rejects HTML of any other shape", () => {
            expect(isVsCodeHtml("")).toBe(false);
            // Not preformatted, or not monospace.
            expect(isVsCodeHtml(`<div style="font-family: monospace;"><div>x</div></div>`)).toBe(false);
            expect(isVsCodeHtml(`<div style="font-family: Arial; white-space: pre;"><div>x</div></div>`)).toBe(false);
            // More than the one block, or a block that is not a div.
            expect(isVsCodeHtml(`${VSCODE_HTML}<p>after</p>`)).toBe(false);
            expect(isVsCodeHtml(`<pre style="font-family: monospace; white-space: pre;">x</pre>`)).toBe(false);
        });

        it("rejects a preformatted block whose content is not a div per line", () => {
            // Text and links straight inside the container, as on a page that styles a div this way.
            expect(isVsCodeHtml(`<div style="${VSCODE_STYLE}">see <a href="https://example.com">the docs</a></div>`)).toBe(false);
            expect(isVsCodeHtml(`<div style="${VSCODE_STYLE}"><div>a</div>b</div>`)).toBe(false);
            // Only empty lines.
            expect(isVsCodeHtml(`<div style="${VSCODE_STYLE}"><br></div>`)).toBe(false);
        });
    });

    describe("vsCodePasteHtml", () => {
        it("builds a code block from the plain text of a multi-line copy", () => {
            expect(vsCodePasteHtml(clipboard(VSCODE_TEXT, VSCODE_CSS_DATA, VSCODE_HTML)))
                .toBe(`<pre><code class="language-text-css">${VSCODE_TEXT}</code></pre>`);
        });

        it("builds inline code from a single line, trimmed", () => {
            expect(vsCodePasteHtml(clipboard("  font-size: 1.4em;  ", VSCODE_CSS_DATA))).toBe("<code>font-size: 1.4em;</code>");
            // A whole line copied with nothing selected ends in a line break.
            expect(vsCodePasteHtml(clipboard("margin: 0;\r\n", VSCODE_CSS_DATA))).toBe("<code>margin: 0;</code>");
        });

        it("escapes the code", () => {
            expect(vsCodePasteHtml(clipboard("a < b && c > d", VSCODE_CSS_DATA))).toBe("<code>a &lt; b &amp;&amp; c &gt; d</code>");
        });

        it("leaves the language out when VS Code names none or an unknown one", () => {
            expect(vsCodePasteHtml(clipboard("a\nb", `{"version":1}`))).toBe("<pre><code>a\nb</code></pre>");
            expect(vsCodePasteHtml(clipboard("a\nb", `{"mode":"makefile"}`))).toBe("<pre><code>a\nb</code></pre>");
        });

        it("falls back to the shape of the HTML when the editor data is missing, as in Firefox", () => {
            expect(vsCodePasteHtml(clipboard(VSCODE_TEXT, undefined, VSCODE_HTML))).toBe(`<pre><code>${VSCODE_TEXT}</code></pre>`);
            expect(vsCodePasteHtml(clipboard("margin: 0;", undefined, VSCODE_HTML))).toBe("<code>margin: 0;</code>");
        });

        it("declines a clipboard that does not come from VS Code or holds no code", () => {
            expect(vsCodePasteHtml(clipboard(VSCODE_TEXT, undefined, "<p>text</p>"))).toBeNull();
            expect(vsCodePasteHtml(clipboard(VSCODE_TEXT, "not json"))).toBeNull();
            expect(vsCodePasteHtml(clipboard(VSCODE_TEXT, "null"))).toBeNull();
            expect(vsCodePasteHtml(clipboard(" \n ", VSCODE_CSS_DATA))).toBeNull();
        });
    });

    describe("on paste", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createTestEditor([Essentials, Paragraph, Code, CodeBlock, PasteFromVsCode], {
                codeBlock: {
                    languages: [
                        { language: "text-x-trilium-auto", label: "Auto-detected" },
                        { language: "text-css", label: "CSS" }
                    ]
                }
            });
        });

        /** Fires a paste the way `ClipboardObserver` does, with the clipboard HTML as the content. */
        function paste(dataTransfer: ReturnType<typeof clipboard>) {
            editor.editing.view.document.fire("clipboardInput", {
                dataTransfer,
                content: dataTransfer.getData("text/html"),
                method: "paste"
            });

            return _getModelData(editor.model, { withoutSelection: true });
        }

        it("pastes a multi-line copy as a code block in its language, without the theme colors", () => {
            _setModelData(editor.model, "<paragraph>[]</paragraph>");

            expect(paste(clipboard(VSCODE_TEXT, VSCODE_CSS_DATA, VSCODE_HTML))).toBe(
                "<codeBlock language=\"text-css\">#trilium-error-overlay .tn-eo-title {<softBreak></softBreak>"
                + "    margin: 0;<softBreak></softBreak>    font-size: 1.4em;<softBreak></softBreak>"
                + "    font-weight: 600;<softBreak></softBreak>}</codeBlock>"
            );
        });

        it("pastes a single line as inline code within the paragraph", () => {
            _setModelData(editor.model, "<paragraph>Set []to zero.</paragraph>");

            expect(paste(clipboard("margin: 0;", VSCODE_CSS_DATA, "<span style=\"color: #9cdcfe;\">margin: 0;</span>")))
                .toBe("<paragraph>Set <$text code=\"true\">margin: 0;</$text>to zero.</paragraph>");
        });

        it("uses the default language for a language the editor does not offer", () => {
            _setModelData(editor.model, "<paragraph>[]</paragraph>");

            expect(paste(clipboard("a\nb", `{"mode":"python"}`))).toBe(
                "<codeBlock language=\"text-x-trilium-auto\">a<softBreak></softBreak>b</codeBlock>"
            );
        });

        it("pastes VS Code's HTML as a code block in the default language when the editor data is missing", () => {
            _setModelData(editor.model, "<paragraph>[]</paragraph>");

            expect(paste(clipboard(VSCODE_TEXT, undefined, VSCODE_HTML))).toBe(
                "<codeBlock language=\"text-x-trilium-auto\">#trilium-error-overlay .tn-eo-title {<softBreak></softBreak>"
                + "    margin: 0;<softBreak></softBreak>    font-size: 1.4em;<softBreak></softBreak>"
                + "    font-weight: 600;<softBreak></softBreak>}</codeBlock>"
            );
        });

        it("pastes plain text into an existing code block", () => {
            _setModelData(editor.model, "<codeBlock language=\"text-css\">[]</codeBlock>");

            expect(paste(clipboard("a\nb", VSCODE_CSS_DATA))).toBe(
                "<codeBlock language=\"text-css\">a<softBreak></softBreak>b</codeBlock>"
            );
        });

        it("leaves a paste from elsewhere alone", () => {
            _setModelData(editor.model, "<paragraph>[]</paragraph>");

            expect(paste(clipboard("a\nb", undefined, "<p>a</p><p>b</p>"))).toBe("<paragraph>a</paragraph><paragraph>b</paragraph>");
        });
    });
});
