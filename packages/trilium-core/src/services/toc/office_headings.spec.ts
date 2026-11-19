import { DOCX_MIME, MAX_TOC_HEADINGS, ODT_MIME } from "@triliumnext/commons";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { getHeadingIds } from "./index.js";
import {
    markOfficePreview, readBookmarkNames, readPreviewBookmarks, readPreviewHeadings
} from "./office_headings.js";

const BLOB_ID = "Kp3vXq0aB7abcdefghij";
const SOURCE = { blobId: BLOB_ID, isProtected: false };

describe("readPreviewHeadings", () => {
    it("reads the headings in document order, with levels made into depths", () => {
        const html = "<h2>Starts at two</h2><p>Text</p><h1>One</h1><h3>Skipped to three</h3>"
            + "<h2>Back to two</h2><h6>Six</h6><h6>Seven, also an h6</h6>";

        expect(titlesAndLevels(html)).toStrictEqual([
            [ "Starts at two", 1 ], [ "One", 1 ], [ "Skipped to three", 2 ], [ "Back to two", 2 ],
            [ "Six", 3 ], [ "Seven, also an h6", 3 ]
        ]);
    });

    it("skips an empty heading, so the heading after it nests under the one before it", () => {
        const html = "<h1>Chapter</h1><h2 class=\"empty-paragraph\"><br></h2><h3>Section</h3>"
            + "<h2> \u{a0} </h2><h2>Next</h2>";

        expect(titlesAndLevels(html)).toStrictEqual([
            [ "Chapter", 1 ], [ "Section", 2 ], [ "Next", 2 ]
        ]);
        expect(titlesAndLevels("<h1>A</h1><h1><br></h1><h2>B</h2>"))
            .toStrictEqual([ [ "A", 1 ], [ "B", 2 ] ]);
    });

    it("leaves note marks out, counts a break as a space, and decodes entities to text", () => {
        const html = "<h2>With footnote<sup data-footnote-ref=\"1\" id=\"footnote-ref-1\">"
            + "<a href=\"#footnote-1\">1</a></sup></h2>"
            + "<h2>With endnote<sup data-footnote-ref=\"edn1\" id=\"footnote-ref-edn1\">"
            + "<a href=\"#footnote-edn1\">i</a></sup></h2>"
            + "<h2>Tab\tand<br>break<sup>2</sup></h2>"
            + "<h2>&amp; &lt;b&gt;markup&lt;/b&gt; <a href=\"#x\">link</a> <b>bold</b></h2>";

        expect(titlesAndLevels(html).map(([ title ]) => title)).toStrictEqual([
            "With footnote", "With endnote", "Tab and break2", "& <b>markup</b> link bold"
        ]);
    });

    it("reads a heading inside a table cell, and normalizes and cuts titles", () => {
        const long = "x".repeat(600);
        const html = `<table><tr><td><h2 id="cell">In a cell</h2></td></tr></table>`
            + `<h2>  Spaced \u0007 out\n</h2><h2>${long}</h2>`;

        expect(titlesAndLevels(html)).toStrictEqual([
            [ "In a cell", 1 ], [ "Spaced out", 1 ], [ "x".repeat(500), 1 ]
        ]);
    });

    it("takes no escaped markup for a tag, nor a tag that only starts like a heading", () => {
        const html = "<p title=\"a &gt; b\">&lt;h2&gt;Not a heading&lt;/h2&gt;</p>"
            + "<header>Head</header><hr><h2 title=\"x &gt; y\">Real</h2>";

        const { headings } = readPreviewHeadings(html);

        expect(headings).toStrictEqual([
            { title: "Real", level: 1, tagOffset: html.indexOf("<h2 title") }
        ]);
        expect(readPreviewHeadings("<h2>Never closed<h3 id=\"cut\"").headings).toStrictEqual([]);
    });

    it("keeps MAX_TOC_HEADINGS headings and tells whether a heading with a title follows", () => {
        const exact = repeatHeadings(MAX_TOC_HEADINGS);

        expect(readPreviewHeadings(exact).isCut).toBe(false);
        expect(readPreviewHeadings(`${exact}<h2><br></h2>`).isCut).toBe(false);

        const cut = readPreviewHeadings(`${exact}<h2><br></h2><h3>Past the cut</h3>`);
        expect(cut.isCut).toBe(true);
        expect(cut.headings).toHaveLength(MAX_TOC_HEADINGS);
        expect(cut.headings.at(-1)?.title).toBe(`H${MAX_TOC_HEADINGS - 1}`);
    });
});

describe("readPreviewBookmarks", () => {
    it("finds each name on the one element whose id it is, in the order of the names", () => {
        const html = "<a id=\"Second\" name=\"Second\"></a><h2 id=\"First\">Heading</h2>"
            + "<p id=\"Twice\">a</p><p id=\"Twice\">b</p>"
            + "<p id=\"a&amp;b &quot;c&quot;\">Escaped</p><p data-id=\"Other\">Not an id</p>";
        const names = [ "First", "Second", "Twice", "a&b \"c\"", "Other", "Gone" ];

        const bookmarks = readPreviewBookmarks(html, names);

        expect(bookmarks.map(({ name }) => name)).toStrictEqual([ "First", "Second", "a&b \"c\"" ]);
        expect(bookmarks[0].tagOffset).toBe(html.indexOf("<h2"));
        expect(bookmarks[1].tagOffset).toBe(0);
    });
});

describe("readBookmarkNames", () => {
    it("reads the Word bookmarks that no editor made and no other id has", async () => {
        const names = [ "Intro", "_Toc123", "_GoBack", "footnote-1", "A&amp;B", "Intro" ];
        const xml = `<w:body>${names.map(wordBookmark).join("")}`
            + "<w:hyperlink w:anchor=\"Linked\"/>" + wordBookmark("Linked") + "</w:body>";

        expect(await readBookmarkNames(zip({ "word/document.xml": xml }), DOCX_MIME))
            .toStrictEqual([ "Intro", "A&B", "Linked" ]);
    });

    it("leaves out the ODT bookmarks whose name another source of ids gives", async () => {
        const xml = "<office:text><text:bookmark text:name=\"Kept\"/>"
            + "<text:bookmark-start text:name=\"Range\"/>"
            + "<text:bookmark-start text:name=\"__RefHeading___Toc1_2\"/>"
            + "<text:tracked-changes><text:changed-region><text:deletion><text:p>"
            + "<text:bookmark text:name=\"id123\"/><text:bookmark text:name=\"Table1\"/>"
            + "<text:bookmark text:name=\"Frame1\"/><text:bookmark text:name=\"note1\"/>"
            + "</text:p></text:deletion></text:changed-region></text:tracked-changes>"
            + "<text:h xml:id=\"id123\">H</text:h><table:table table:name=\"Table1\"/>"
            + "<draw:frame draw:name=\"Frame1\"/><text:note text:id=\"note1\"/>"
            + "<text:bookmark-ref text:ref-name=\"Kept\"/></office:text>";

        expect(await readBookmarkNames(zip({ "content.xml": xml }), ODT_MIME))
            .toStrictEqual([ "Kept", "Range" ]);
    });

    it("reads no names from a file that is not a package, lacks the part or has another type",
        async () => {
        const xml = wordBookmark("Intro");
        expect(await readBookmarkNames(new Uint8Array([ 1, 2, 3 ]), DOCX_MIME)).toStrictEqual([]);
        expect(await readBookmarkNames(zip({ "styles.xml": "<x/>" }), ODT_MIME)).toStrictEqual([]);
        expect(await readBookmarkNames(zip({ "word/document.xml": xml }), "application/pdf"))
            .toStrictEqual([]);
    });
});

describe("markOfficePreview", () => {
    it("writes the id of each heading into its start tag, and changes no other byte", () => {
        const html = "<p data-x=\"a\\b\">Intro</p><h1 id=\"one\">One</h1>"
            + "<h2 class=\"empty-paragraph\"><br></h2><h2>Summary</h2><h2>Summary</h2>"
            + "<h3>Deep</h3>";
        const ids = getHeadingIds(readPreviewHeadings(html).headings, BLOB_ID, false, false);

        const marked = markOfficePreview(html, SOURCE);

        expect(marked).toBe("<p data-x=\"a\\b\">Intro</p>"
            + `<h1 data-toc-heading="${ids[0]}" id="one">One</h1>`
            + "<h2 class=\"empty-paragraph\"><br></h2>"
            + `<h2 data-toc-heading="${ids[1]}">Summary</h2>`
            + `<h2 data-toc-heading="${ids[2]}">Summary</h2>`
            + `<h3 data-toc-heading="${ids[3]}">Deep</h3>`);
        expect(ids[1]).toMatch(/\.Kp3vXq0aB7$/);
    });

    it("writes the ids of the protected blob, and binds every heading of a cut preview", () => {
        const [ protectedId ] = getHeadingIds([ { title: "One", level: 1 } ], BLOB_ID, true, false);
        expect(markOfficePreview("<h1>One</h1>", { ...SOURCE, isProtected: true }))
            .toBe(`<h1 data-toc-heading="${protectedId}">One</h1>`);

        const marked = markOfficePreview(repeatHeadings(MAX_TOC_HEADINGS + 1), SOURCE);
        expect(marked.match(/data-toc-heading="[0-9a-z]{14}\.Kp3vXq0aB7"/g))
            .toHaveLength(MAX_TOC_HEADINGS);
        expect(marked.endsWith(`<h2>H${MAX_TOC_HEADINGS}</h2>`)).toBe(true);
    });

    it("marks the element of each bookmark, a heading's start tag after its id", () => {
        const html = "<a id=\"title\" name=\"title\"></a><h2 id=\"Appendix\">Appendix</h2>"
            + "<p id=\"x\">a</p>";
        const [ id ] = getHeadingIds(readPreviewHeadings(html).headings, BLOB_ID, false, false);

        const marked = markOfficePreview(html, SOURCE, [ "Appendix", "title", "say \"hi\"" ]);

        expect(marked).toBe("<a data-toc-bookmark=\"title\" id=\"title\" name=\"title\"></a>"
            + `<h2 data-toc-heading="${id}" data-toc-bookmark="Appendix" id="Appendix">`
            + "Appendix</h2><p id=\"x\">a</p>");
    });
});

/** A ZIP of `files`, each of them text. */
function zip(files: Record<string, string>) {
    const entries = Object.entries(files).map(([ path, text ]) => [ path, strToU8(text) ]);
    return zipSync(Object.fromEntries(entries));
}

/** The start of the Word bookmark `name`. */
function wordBookmark(name: string, index = 0) {
    return `<w:bookmarkStart w:id="${index}" w:name="${name}"/>`;
}

/** `count` headings, `H0` to `H<count - 1>`. */
function repeatHeadings(count: number) {
    return Array.from({ length: count }, (_, index) => `<h2>H${index}</h2>`).join("");
}

function titlesAndLevels(html: string) {
    return readPreviewHeadings(html).headings.map(({ title, level }) => [ title, level ]);
}
