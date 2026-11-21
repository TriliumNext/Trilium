import {
    ClassicEditor, Essentials, Paragraph, PasteFromOffice, _getModelData, _setModelData
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import PasteFromWps, { withoutSpacerunOnText } from "./paste_from_wps.js";

const NBSP = String.fromCharCode(0xa0);

/** The head WPS writes, claiming to be Word, as Word does. */
const OFFICE_HEAD = "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\""
    + " xmlns:w=\"urn:schemas-microsoft-com:office:word\"><head>"
    + "<meta name=ProgId content=Word.Document><meta name=Generator content=\"Microsoft Word 14\">"
    + "</head>";

/** The style of a text run in WPS: `mso-spacerun`, then the font. */
const WPS_TEXT_STYLE = "mso-spacerun:\"yes\";font-family:宋体;font-size:12.0000pt;";

/**
 * Two paragraphs copied from WPS Writer, in the shape of the sample in #11295: every text run sits
 * in a `mso-spacerun` span, and the second paragraph ends with a real run of spaces.
 */
const WPS_HTML = `${OFFICE_HEAD}<body><!--StartFragment-->`
    + `<p class=MsoNormal><span style='${WPS_TEXT_STYLE}'><font face="宋体">第一段文字</font></span>`
    + `<span style='mso-spacerun:"yes";font-family:宋体;'><o:p></o:p></span></p>`
    + `<p class=MsoNormal><span style='${WPS_TEXT_STYLE}'><font face="宋体">Second paragraph</font>`
    + `</span><span style='mso-spacerun:"yes";'>`
    + `<span style='mso-spacerun:"yes";font-family:宋体;'>    </span><o:p></o:p></span></p>`
    + "<!--EndFragment--></body></html>";

/** A paragraph copied from Word, which puts `mso-spacerun` only on a run of spaces. */
const WORD_HTML = `${OFFICE_HEAD}<body><!--StartFragment-->`
    + "<p class=MsoNormal>one<span style='mso-spacerun:yes'>   </span>two<o:p></o:p></p>"
    + "<!--EndFragment--></body></html>";

function clipboard(html: string) {
    const types: Record<string, string> = { "text/html": html, "text/plain": "" };
    return { getData: (type: string) => types[type] ?? "" };
}

describe("PasteFromWps", () => {
    describe("withoutSpacerunOnText", () => {
        it("takes mso-spacerun off the spans that hold text, and keeps their other styles", () => {
            const html = withoutSpacerunOnText(WPS_HTML)!;
            const parsed = new DOMParser().parseFromString(html, "text/html");
            const spans = parsed.querySelectorAll("span");

            expect([ ...spans ].map((span) => span.getAttribute("style"))).toEqual([
                "font-family:宋体;font-size:12.0000pt;",
                "mso-spacerun:\"yes\";font-family:宋体;",
                "font-family:宋体;font-size:12.0000pt;",
                "mso-spacerun:\"yes\";",
                "mso-spacerun:\"yes\";font-family:宋体;"
            ]);
        });

        it("keeps the head, which tells PasteFromOffice that the HTML comes from Word", () => {
            expect(withoutSpacerunOnText(WPS_HTML))
                .toContain("<meta name=\"Generator\" content=\"Microsoft Word 14\">");
        });

        it("returns null when only runs of spaces are marked, as Word does", () => {
            expect(withoutSpacerunOnText(WORD_HTML)).toBeNull();
            expect(withoutSpacerunOnText("<p>a<span style='mso-spacerun:yes'>&nbsp; </span>b</p>"))
                .toBeNull();
        });

        it("returns null for HTML without mso-spacerun", () => {
            expect(withoutSpacerunOnText("<p>plain <span style=\"color: red\">text</span></p>"))
                .toBeNull();
            expect(withoutSpacerunOnText("")).toBeNull();
        });
    });

    describe("on paste", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createTestEditor([
                Essentials, Paragraph, PasteFromOffice, PasteFromWps
            ]);
            _setModelData(editor.model, "<paragraph>[]</paragraph>");
        });

        /** Fires a paste the way `ClipboardObserver` does, with the clipboard HTML as content. */
        function paste(html: string, target = editor) {
            target.editing.view.document.fire("clipboardInput", {
                dataTransfer: clipboard(html),
                content: html,
                method: "paste"
            });

            return _getModelData(target.model, { withoutSelection: true });
        }

        it("keeps the text of a paste from WPS", () => {
            // The run of spaces at the end of the second paragraph stays PasteFromOffice's.
            expect(paste(WPS_HTML)).toBe(
                `<paragraph>第一段文字</paragraph><paragraph>Second paragraph${NBSP}  </paragraph>`
            );
        });

        it("pastes from Word the same as PasteFromOffice alone", async () => {
            const withoutPlugin = await createTestEditor([
                Essentials, Paragraph, PasteFromOffice
            ]);
            _setModelData(withoutPlugin.model, "<paragraph>[]</paragraph>");

            const pasted = paste(WORD_HTML);
            expect(pasted).toBe(paste(WORD_HTML, withoutPlugin));
            expect(pasted).toBe(`<paragraph>one${NBSP}  two</paragraph>`);
        });

        it("leaves content that another plugin has already converted alone", () => {
            editor.editing.view.document.fire("clipboardInput", {
                dataTransfer: clipboard(""),
                content: editor.data.processor.toView("<p>converted</p>"),
                method: "paste"
            });

            expect(_getModelData(editor.model, { withoutSelection: true }))
                .toBe("<paragraph>converted</paragraph>");
        });
    });
});
