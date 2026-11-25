import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import type BAttachment from "../../becca/entities/battachment.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import { prepareHtml, renderTextNoteToDocx } from "./docx.js";

/** A 1×1 PNG. */
const PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
    31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 252, 207, 192, 80, 15, 0, 4, 133, 1, 128,
    132, 169, 140, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

const FEEDBACK_HTML = `<h2>Feedback</h2>`
    + `<p>Overall: <span style="color:hsl(120, 75%, 30%);--tn-color:hsl(120, 75%, 30%);"><strong>strong quarter</strong></span>,`
    + ` see <a class="reference-link" href="#root/abc">Goals</a> and <a href="https://example.com">the wiki</a>.</p>`
    + `<figure class="table" style="width:100%;"><table><colgroup><col style="width:30%;"><col style="width:70%;"></colgroup>`
    + `<thead><tr><th>Area</th><th>Notes</th></tr></thead><tbody>`
    + `<tr><td style="background-color:hsl(210, 75%, 85%);--tn-background:hsl(210, 75%, 85%);">Strengths</td>`
    + `<td><ul><li data-list-item-id="e1">Ownership</li></ul></td></tr>`
    + `<tr><td style="border-bottom:3px dashed hsl(0, 75%, 60%);">Improve</td>`
    + `<td><img src="api/attachments/att1/image/chart.png"></td></tr>`
    + `</tbody></table></figure>`;

describe("prepareHtml", () => {
    it("unwraps links to other notes and drops editor bookkeeping, keeping the text", () => {
        const html = prepareHtml(`<p><a class="reference-link" href="#root/abc">Goals</a> <a href="#root/x/y">Plan</a>`
            + ` <a href="https://example.com">Site</a></p><ul><li data-list-item-id="e1">Item</li></ul>`);

        expect(html).toBe(`<p>Goals Plan <a href="https://example.com">Site</a></p><ul><li>Item</li></ul>`);
    });

    it("moves the figure's width to the table and the column widths to the first row", () => {
        const html = prepareHtml(`<figure class="table" style="width:80%;"><table>`
            + `<colgroup><col style="width:20%;"><col style="width:30%;"><col style="width:50%;"></colgroup>`
            + `<tbody><tr><td colspan="2">a</td><td style="width:40%">b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr>`
            + `</tbody></table></figure>`, 10000);

        expect(html).toContain(`<table style="width:400pt;">`);
        expect(html).toContain(`<td colspan="2" style="width:50%;">a</td>`);
        expect(html).toContain(`<td style="width:40%">b</td>`);
        expect(html).toContain(`<td>c</td>`);
    });

    it("gives a table without a width the text's, and leaves one in a cell relative to it", () => {
        const html = prepareHtml(`<figure class="table"><table><tbody><tr><td>`
            + `<figure class="table" style="width:50%;"><table><tbody><tr><td>a</td></tr>`
            + `</tbody></table></figure></td></tr></tbody></table></figure>`, 10000);

        expect(html).toMatch(/^<figure class="table"><table style="width:500pt;">/);
        expect(html).toContain(`<figure class="table" style="width:50%;"><table style="width:50%;">`);
    });
});

describe("renderTextNoteToDocx", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps the colors, borders, column widths and images of a table", async () => {
        vi.spyOn(becca, "getAttachment").mockReturnValue({
            mime: "image/png",
            getContent: () => PNG
        } as unknown as BAttachment);
        const note = buildNote({ type: "text", title: "Feedback" });

        const files = unzipSync(await renderTextNoteToDocx(note, FEEDBACK_HTML));
        const xml = strFromU8(files["word/document.xml"]);

        expect(xml).toContain(`<w:pStyle w:val="Heading2"/>`);
        expect(xml).toMatch(/<w:color w:val="138613"\/>/);
        expect(xml).toContain(`w:fill="BCD9F5"`);
        expect(xml).toContain(`w:fill="F2F2F2"`);
        expect(xml).toMatch(/<w:bottom w:val="dashed" w:color="E64C4C"/);
        expect(xml).toMatch(/<w:gridCol w:w="(\d+)"\/><w:gridCol w:w="(\d+)"\/>/);
        const [ first, second ] = [ ...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g) ].map((match) => Number(match[1]));
        expect(second / first).toBeCloseTo(70 / 30, 1);
        expect(xml).toContain("<w:numPr>");
        expect(xml).not.toContain("root_abc");
        expect(xml).toContain("Goals");
        expect(Object.keys(files).some((path) => path.startsWith("word/media/"))).toBe(true);
        expect(strFromU8(files["docProps/core.xml"])).toContain("<dc:title>Feedback</dc:title>");
    });

    it("writes Word's defaults, bold headings, the editor's font sizes and its page breaks", async () => {
        const note = buildNote({ type: "text", title: "Styles" });
        const files = unzipSync(await renderTextNoteToDocx(note, `<h2>Heading</h2>`
            + `<p><span class="text-huge">Huge</span> <span class="text-small">small</span></p>`
            + `<figure class="table"><table><tbody><tr><td><p>Cell</p></td></tr></tbody></table></figure>`
            + `<div class="page-break" style="page-break-after:always;"><span style="display:none;">&nbsp;</span></div>`
            + `<p>Next page</p>`));
        const styles = strFromU8(files["word/styles.xml"]);
        const xml = strFromU8(files["word/document.xml"]);

        const defaults = styles.match(/<w:docDefaults>.*?<\/w:docDefaults>/s)?.[0];
        expect(defaults).toMatch(/<w:sz w:val="22"\/>/);
        expect(defaults).toMatch(/<w:spacing w:after="160" w:line="276"\/>/);
        const heading = styles.match(/<w:style [^>]*w:styleId="Heading2".*?<\/w:style>/s)?.[0];
        expect(heading).toContain("<w:b/>");
        expect(heading).not.toContain("2E74B5");
        expect(xml).toMatch(/<w:sz w:val="40"\/>.*Huge/s);
        expect(xml).toMatch(/<w:sz w:val="19"\/>.*small/s);
        expect(xml).toMatch(/<w:pStyle w:val="TableText"\/>.*Cell/s);
        expect(xml).toMatch(/<w:pageBreakBefore\/>.*Next page/s);
        expect(styles).toMatch(/<w:style [^>]*w:styleId="TableText">.*<w:spacing w:after="0"\/>/s);
    });
});
