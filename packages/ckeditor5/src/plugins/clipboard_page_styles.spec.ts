import { Bold, ClassicEditor, ClipboardPipeline, Code, Essentials, Font, GeneralHtmlSupport, Italic, Link, Paragraph, Strikethrough, Subscript, Superscript, Table, TableCellProperties, TableProperties, Underline } from "ckeditor5";
import type { ViewDocumentFragment, ViewElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ClipboardPageStyles, { isComputedStyleDump, stripPageStyles } from "./clipboard_page_styles.js";

/** A selection copied out of the Claude Code panel in VS Code under a dark theme, verbatim. */
const VS_CODE_SELECTION = `<meta charset='utf-8'><span style="color: rgb(191, 191, 191); font-family: -apple-system, &quot;system-ui&quot;, &quot;Segoe UI&quot;, Roboto, sans-serif; font-size: 13px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: pre-wrap; background-color: rgb(25, 26, 27); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; display: inline !important; float: none;">I'd start with (1).</span>`;

/**
 * A heading and a table copied out of the same panel, verbatim but cut after the first body row.
 * Each top-level element carries a dump; the cells and the code span carry only the styles that the
 * page's stylesheet matched.
 */
const VS_CODE_TABLE = `<meta charset='utf-8'><p style="white-space: pre-wrap; margin-top: 0.1em; margin-bottom: 0.2em; unicode-bidi: plaintext; color: rgb(191, 191, 191); font-family: -apple-system, &quot;system-ui&quot;, &quot;Segoe UI&quot;, Roboto, sans-serif; font-size: 13px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(25, 26, 27); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><strong>What competitors do:</strong></p><table style="border-collapse: collapse; border-color: rgb(42, 43, 44); border-style: solid; border-width: 1px; border-image: none 100% / 1 / 0 stretch; color: rgb(191, 191, 191); font-family: -apple-system, &quot;system-ui&quot;, &quot;Segoe UI&quot;, Roboto, sans-serif; font-size: 13px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; background-color: rgb(25, 26, 27); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><thead><tr><th style="unicode-bidi: plaintext; border-color: rgb(42, 43, 44); border-style: solid; border-width: 1px; border-image: none 100% / 1 / 0 stretch; padding: 2px;">App</th><th style="unicode-bidi: plaintext; border-color: rgb(42, 43, 44); border-style: solid; border-width: 1px; border-image: none 100% / 1 / 0 stretch; padding: 2px;">Behaviour</th></tr></thead><tbody><tr><td style="unicode-bidi: plaintext; border-color: rgb(42, 43, 44); border-style: solid; border-width: 1px; border-image: none 100% / 1 / 0 stretch; padding: 2px;"><strong>Tiptap / ProseMirror editors</strong><span> </span>(and products built on them)</td><td style="unicode-bidi: plaintext; border-color: rgb(42, 43, 44); border-style: solid; border-width: 1px; border-image: none 100% / 1 / 0 stretch; padding: 2px;">Tiptap's code-block extension reads<span> </span><code style="font-family: monospace; color: rgb(140, 140, 140); background: none 0% 0% / auto repeat scroll padding-box border-box rgb(38, 38, 38); padding: 2px 4px; border-radius: 3px; word-break: break-word; font-size: 0.9em;">vscode-editor-data</code>: the paste becomes a real code block in the right language, and the colors are thrown away. That's from my memory of its source; I didn't verify it today.</td></tr></tbody></table>`;

/** The computed-style dump that Chromium writes on the element wrapping a copied selection. */
const DUMP = "color: rgb(191, 191, 191); background-color: rgb(25, 26, 27); font-family: Roboto, sans-serif; font-size: 13px; "
    + "font-style: normal; font-weight: 400; orphans: 2; widows: 2; -webkit-text-stroke-width: 0px; "
    + "font-variant-ligatures: normal; font-variant-caps: normal; text-decoration-thickness: initial;";

/**
 * A selection spanning formatted text: inside the dump, Chromium writes only the styles that the
 * page's stylesheet matched on each element.
 */
const FORMATTED_SELECTION = `<p style="${DUMP}">`
    + `<code style="background-color: rgb(40, 40, 40); color: rgb(230, 120, 120); font-family: monospace; padding: 2px;">npm</code> `
    + `<span style="font-weight: 700; color: rgb(255, 255, 255);">bold</span> `
    + `<span style="font-style: italic;">italic</span> `
    + `<span style="text-decoration: underline;">under</span> `
    + `<span style="vertical-align: super;">sup</span> `
    + `<a href="https://example.com" style="color: rgb(120, 160, 255);">link</a>`
    + `</p>`;

describe("ClipboardPageStyles", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor(
            [
                Essentials, Paragraph, Bold, Italic, Underline, Strikethrough, Subscript, Superscript, Code, Link, Font,
                Table, TableProperties, TableCellProperties, GeneralHtmlSupport, ClipboardPageStyles
            ],
            {
                // As in Trilium with HTML support on: every tag with every style, so whatever the
                // plugin leaves behind would reach the note.
                htmlSupport: { allow: [{ name: /^(p|span|code|a|table|thead|tbody|tr|th|td)$/, attributes: true, classes: true, styles: true }] }
            }
        );
        editor.setData("<p></p>");
    });

    function toView(html: string) {
        return editor.data.processor.toView(html) as ViewDocumentFragment;
    }

    function firstElement(html: string) {
        const fragment = toView(html);
        for (const { item } of editor.editing.view.createRangeIn(fragment)) {
            if (item.is("element")) {
                return item as ViewElement;
            }
        }
        throw new Error("No element in fixture");
    }

    function paste(html: string) {
        editor.plugins.get(ClipboardPipeline).fire("inputTransformation", {
            content: toView(html),
            dataTransfer: { getData: () => "", setData: () => {} },
            method: "paste"
        });

        return editor.getData();
    }

    describe("isComputedStyleDump", () => {
        it("recognizes the dump that Chromium writes on a copied selection", () => {
            expect(isComputedStyleDump(firstElement(VS_CODE_SELECTION))).toBe(true);
            expect(isComputedStyleDump(firstElement(`<span style="${DUMP}">x</span>`))).toBe(true);
        });

        it("rejects styles that an application or an author wrote", () => {
            expect(isComputedStyleDump(firstElement(`<span style="color: red; background-color: yellow;">x</span>`))).toBe(false);
            expect(isComputedStyleDump(firstElement(`<span>x</span>`))).toBe(false);
            // Under the threshold: a print stylesheet can set `orphans` and `widows` on purpose.
            expect(isComputedStyleDump(firstElement(`<p style="orphans: 3; widows: 3; color: red;">x</p>`))).toBe(false);
        });
    });

    describe("stripPageStyles", () => {
        it("reports whether the fragment was a dump", () => {
            const view = editor.editing.view;

            expect(stripPageStyles(view, toView(VS_CODE_SELECTION))).toBe(true);
            expect(stripPageStyles(view, toView(`<p><span style="color: red;">x</span></p>`))).toBe(false);
        });

        it("drops a style attribute with nothing left to keep", () => {
            const fragment = toView(`<p style="${DUMP}">x</p>`);

            stripPageStyles(editor.editing.view, fragment);

            const paragraph = fragment.getChild(0) as ViewElement;
            expect(paragraph.is("element", "p")).toBe(true);
            expect(paragraph.hasAttribute("style")).toBe(false);
        });

        it("unwraps spans that are left with no attributes, and keeps the rest", () => {
            const fragment = toView(`<p style="${DUMP}"><span style="color: red;">a</span><span class="x">b</span></p>`);

            stripPageStyles(editor.editing.view, fragment);

            const paragraph = fragment.getChild(0) as ViewElement;
            const children = [...paragraph.getChildren()];
            expect(children[0].is("$text") && children[0].data).toBe("a");
            expect(children[1].is("element", "span")).toBe(true);
        });
    });

    describe("on paste", () => {
        it("pastes the VS Code selection as plain text", () => {
            expect(paste(VS_CODE_SELECTION)).toBe("<p>I'd start with (1).</p>");
        });

        it("keeps the formatting of a dump and drops the page's colors and fonts", () => {
            const data = paste(FORMATTED_SELECTION);

            expect(data).toBe("<p><code>npm</code> <strong>bold</strong> <i>italic</i> <u>under</u> <sup>sup</sup> "
                + "<a href=\"https://example.com\">link</a></p>");
        });

        it("pastes a table without the page's borders, backgrounds and padding", () => {
            const data = paste(VS_CODE_TABLE);

            expect(data).toContain("<p><strong>What competitors do:</strong></p>");
            expect(data).toContain("<th>App</th>");
            expect(data).toContain("<code>vscode-editor-data</code>");
            expect(data).not.toContain("style=");
            expect(data).not.toContain("<span");
        });

        it("leaves colors alone when the HTML is not a dump", () => {
            const data = paste(`<p><span style="color: rgb(255, 0, 0);">red</span> <span style="background-color: rgb(255, 255, 0);">marked</span></p>`);

            expect(data).toContain("<span style=\"color:rgb(255,0,0);\">red</span>");
            expect(data).toContain("<span style=\"background-color:rgb(255,255,0);\">marked</span>");
        });
    });
});
