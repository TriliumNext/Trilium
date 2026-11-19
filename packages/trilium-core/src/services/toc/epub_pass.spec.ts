import { EPUB_MIME_TYPES, MAX_TOC_HEADINGS } from "@triliumnext/commons";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { OfficeConverter } from "officeparser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { convertOfficeToHtml } from "../office_preview.js";
import {
    EPUB_TOC_READER, type TocPassOutcome, type TocPassRecord, TocPassRefusal
} from "./epub.js";
import { findLandings, markEpubPreview, readEpubToc, runTocPass } from "./epub_pass.js";
import { buildEpub, xhtml } from "./fixtures/epub_books.js";
import { getHeadingIds } from "./index.js";

const EPUB_MIME = EPUB_MIME_TYPES[0];
const SOURCE = { blobId: "blob0123456789", isProtected: false };

afterEach(() => {
    vi.restoreAllMocks();
});

describe("runTocPass", () => {
    it("places one marker per destination by the kind of its target, and changes nothing else",
        async () => {
        const chapter = [
            "<!-- <p id='scope'>a comment</p> --><![CDATA[ <p id=\"scope\"> ]]>",
            "<h2 id='scope'>Scope</h2>",
            "<p>See <a id=\"ref\" href=\"#x\">a <span id=\"inner\">link</span></a>.</p>",
            "<img id=\"cover\" src=\"c.png\" alt=\"\"/><hr id=\"rule\"></hr>",
            "<p>Page <span id=\"p45\" epub:type=\"pagebreak\"/>break</p>",
            "<div><p>Unclosed</div>",
            "<table><tr id=\"row\"><td>Cell</td></tr><tr id=\"empty\"></tr></table>",
            "<p><a name=\"legacy\"></a>Named</p><a name=\"both\"></a><p id=\"both\">By id</p>"
        ].join("");
        const nav = [
            [ "Whole", "c.xhtml" ], [ "Scope", "c.xhtml#scope" ],
            [ "Scope again", "c.xhtml#scope" ],
            [ "Link", "c.xhtml#ref" ], [ "Inner", "c.xhtml#inner" ], [ "Cover", "c.xhtml#cover" ],
            [ "Rule", "c.xhtml#rule" ], [ "Page", "c.xhtml#p45" ], [ "Row", "c.xhtml#row" ],
            [ "Empty row", "c.xhtml#empty" ], [ "Legacy", "c.xhtml#legacy" ],
            [ "Both", "c.xhtml#both" ], [ "Missing", "c.xhtml#missing" ]
        ].map(([ title, href ]) => `<li><a href="${href}">${title}</a></li>`).join("")
            + "<li><span>Group</span></li>";
        const bytes = buildEpub({ "c.xhtml": chapter }, { nav });

        const outcome = await runTocPass(bytes);
        const marked = readMarked(outcome);

        const m = (n: number) => `<a id="trilium_toc_${n}"></a>`;
        expect(readChapter(marked.bytes, "c.xhtml")).toBe(xhtml([
            "<!-- <p id='scope'>a comment</p> --><![CDATA[ <p id=\"scope\"> ]]>",
            `<h2 id='scope'>${m(1)}Scope</h2>`,
            `<p>See ${m(2)}${m(3)}<a id="ref" href="#x">a <span id="inner">link</span></a>.</p>`,
            `${m(4)}<img id="cover" src="c.png" alt=""/>${m(5)}<hr id="rule"></hr>`,
            `<p>Page ${m(6)}<span id="p45" epub:type="pagebreak"/>break</p>`,
            "<div><p>Unclosed</div>",
            `<table><tr id="row"><td>${m(7)}Cell</td></tr><tr id="empty"></tr></table>`,
            `<p>${m(8)}<a name="legacy"></a>Named</p>`
                + `<a name="both"></a><p id="both">${m(9)}By id</p>`
        ].join(""), m(0) + m(10)));
        expect(marked.record.entries.map(({ title, destination }) => [ title, destination ]))
            .toStrictEqual([
                [ "Whole", 0 ], [ "Scope", 1 ], [ "Scope again", 1 ], [ "Link", 2 ], [ "Inner", 3 ],
                [ "Cover", 4 ], [ "Rule", 5 ], [ "Page", 6 ], [ "Row", 7 ], [ "Empty row", -1 ],
                [ "Legacy", 8 ], [ "Both", 9 ], [ "Missing", 10 ], [ "Group", undefined ]
            ]);
        // Every other entry of the archive is the same, and so is the archive the next time.
        const before = unzipSync(bytes);
        const after = unzipSync(marked.bytes);
        delete before["OEBPS/c.xhtml"];
        delete after["OEBPS/c.xhtml"];
        expect(after).toStrictEqual(before);
        expect(readMarked(await runTocPass(bytes)).bytes).toStrictEqual(marked.bytes);
    });

    it("chooses a prefix that no id or name of the book starts with", async () => {
        const bytes = buildEpub({
            "a.xhtml": "<p id=\"trilium_toc_0\">Taken</p>",
            "b.xhtml": "<p><a name=\"trilium_toc_x\"></a>Taken too</p>"
        }, { nav: "<li><a href=\"a.xhtml\">A</a></li>" });

        const marked = readMarked(await runTocPass(bytes));

        expect(marked.record.prefix).toBe("trilium_toc2_");
        expect(marked.record.destinations).toStrictEqual([ { marker: "trilium_toc2_0" } ]);
    });

    it("tells the outcomes of a book apart", async () => {
        expect(await runTocPass(buildEpub({ "a.xhtml": "<p>A</p>" })))
            .toStrictEqual({ status: "none" });
        expect(await runTocPass(buildEpub({ "a.xhtml": "<p>A</p>" }, { nav: "" })))
            .toStrictEqual({ status: "none" });

        const nav = "<li><a href=\"a.xhtml\">A</a></li>";
        const encrypted = patchCentral(buildEpub({ "a.xhtml": "<p>A</p>" }, { nav }),
            "OEBPS/a.xhtml",
            (view, at) => view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true));
        const methods = patchCentral(buildEpub({ "a.xhtml": "<p>A</p>" }, { nav }), "OEBPS/a.xhtml",
            (view, at) => view.setUint16(at + 10, 12, true));
        const altered = patchCentral(buildEpub({ "a.xhtml": "<p>A</p>" }, { nav }), "OEBPS/a.xhtml",
            (view, at) => view.setUint32(at + 16, 1, true));
        expect(await runTocPass(encrypted))
            .toStrictEqual({ status: "refused", reason: "ENCRYPTED_ENTRY" });
        expect(await runTocPass(methods)).toStrictEqual({ status: "refused", reason: "METHOD" });
        expect(await runTocPass(altered)).toStrictEqual({ status: "refused", reason: "CRC" });
        expect(await runTocPass(new Uint8Array(64)))
            .toStrictEqual({ status: "refused", reason: "DIRECTORY" });

        const failure = new RangeError("Out of memory");
        const failing = Object.assign(buildEpub({ "a.xhtml": "<p>A</p>" }, { nav }), {
            subarray: () => {
                throw failure;
            }
        });
        await expect(runTocPass(failing)).rejects.toBe(failure);
    });

    it("reads the first entry of a name, and marks only the chapters it can read as text",
        async () => {
        const invalid = new Uint8Array([ ...strToU8(xhtml("<p id=\"i\">Invalid</p>")), 0xff ]);
        const bytes = buildEpub({
            "café.xhtml": "<table><tr id=\"head\"><th>Head</th></tr></table>",
            "nul.xhtml": "<p id=\"n\">\0</p>",
            "invalid.xhtml": invalid,
            "a1.xhtml": "<p id=\"f\">First</p>",
            "a2.xhtml": "<p id=\"s\">Second</p>"
        }, { nav: navList([
            [ "Head", "café.xhtml#head" ], [ "Nul", "nul.xhtml#n" ],
            [ "Invalid", "invalid.xhtml#i" ], [ "First", "a1.xhtml#f" ],
            [ "Second", "a2.xhtml#s" ], [ "Navigation", "nav.xhtml" ]
        ]) });
        // Renames the entry `a2.xhtml` to `a1.xhtml`, after the real one.
        patchCentral(bytes, "OEBPS/a2.xhtml", (view, at) =>
            view.setUint8(at + 46 + "OEBPS/a".length, "1".charCodeAt(0)));

        const marked = readMarked(await runTocPass(bytes));

        expect(marked.record.entries.map(({ title, destination }) => [ title, destination ]))
            .toStrictEqual([
                [ "Head", 0 ], [ "Nul", -1 ], [ "Invalid", -1 ], [ "First", 1 ],
                [ "Second", undefined ], [ "Navigation", -1 ]
            ]);
        expect(marked.record.destinations).toStrictEqual([
            { marker: "trilium_toc_0", bookId: "head" }, { marker: "trilium_toc_1", bookId: "f" }
        ]);
        expect(readChapter(marked.bytes, "café.xhtml"))
            .toContain("<th><a id=\"trilium_toc_0\"></a>Head</th>");

        const unplaced = buildEpub({ "a.xhtml": "<p>A</p>" },
            { nav: navList([ [ "Navigation", "nav.xhtml" ] ]) });
        expect(readMarked(await runTocPass(unplaced)).bytes).toBe(unplaced);
    });

    it("refuses a part declared past what remains of the budget, before inflating it", async () => {
        const bytes = buildEpub({ "a.xhtml": "<p>A</p>" },
            { nav: "<li><a href=\"a.xhtml\">A</a></li>" });
        const declared = Object.values(unzipSync(bytes))
            .reduce((total, part) => total + part.length, 0)
            - "application/epub+zip".length;
        const marker = "<a id=\"trilium_toc_0\"></a>".length;

        expect(await runTocPass(bytes, declared + marker)).toMatchObject({ status: "marked" });
        expect(await runTocPass(bytes, declared + marker - 1))
            .toStrictEqual({ status: "refused", reason: "TEXT_TOO_LARGE" });
        expect(await runTocPass(bytes, declared - 1))
            .toStrictEqual({ status: "refused", reason: "TEXT_TOO_LARGE" });
    });

    it("places 10,000 markers for 10,000 nested groups over 10,000 leaves, without recursion",
        async () => {
        const count = MAX_TOC_HEADINGS / 2;
        const leaves = Array.from({ length: count },
            (_, index) => `<li><a href="a.xhtml#p${index}">Leaf ${index}</a></li>`).join("");
        const nav = "<li><span>Group</span><ol>".repeat(count - 1) + "<li><span>Group</span><ol>"
            + leaves + "</ol></li>" + "</ol></li>".repeat(count - 1);
        const chapter = Array.from({ length: count },
            (_, index) => `<p id="p${index}">${index}</p>`)
            .join("");
        const bytes = buildEpub({ "a.xhtml": chapter }, { nav });

        const marked = readMarked(await runTocPass(bytes));
        expect(marked.record.entries).toHaveLength(MAX_TOC_HEADINGS);
        expect(marked.record.isCut).toBe(false);
        expect(marked.record.destinations).toHaveLength(count);

        const html = await convertOfficeToHtml(marked.bytes, EPUB_MIME);
        const preview = markEpubPreview(html, marked.record, SOURCE);
        const marks = readMarks(preview);
        expect(marks).toHaveLength(count);
        expect(marks[0].split(" ")).toHaveLength(count + 1);
    });
});

describe("the landings of a converted book", () => {
    it("lands an entry on the element its marker stands for, whatever the kind of target",
        async () => {
        const { landed } = await convertBook({
            "c.xhtml": "<p>Intro</p><img id=\"cover\" src=\"c.png\" alt=\"A cover\"/>"
                + "<h2>After the cover</h2>"
                + "<p>See <a id=\"ref\" href=\"#dest\">a link</a>.</p>"
                + "<p>Go <a href=\"#dest\">to <span id=\"inner\">here</span></a>.</p>"
                + "<hr id=\"rule\"/><p>After the rule</p>"
                + "<p>Page <span id=\"p45\" epub:type=\"pagebreak\" title=\"45\"/>break</p>"
                + "<h2><a id=\"chap01\"></a>CHAPTER I.</h2>"
                + "<table id=\"table\"><tr><td>One</td></tr><tr><td id=\"cell\">Two</td></tr>"
                + "<tr id=\"row3\"><td>Three</td></tr>"
                + "<tr id=\"row4\"><td id=\"cell4\">Four</td></tr>"
                + "</table><p id=\"dest\">Destination</p>"
        }, [
            [ "Cover", "c.xhtml#cover" ], [ "Link", "c.xhtml#ref" ], [ "Inner", "c.xhtml#inner" ],
            [ "Rule", "c.xhtml#rule" ], [ "Page", "c.xhtml#p45" ],
            [ "Chapter I", "c.xhtml#chap01" ], [ "Table", "c.xhtml#table" ],
            [ "Cell", "c.xhtml#cell" ], [ "Cell again", "c.xhtml#cell" ],
            [ "Row three", "c.xhtml#row3" ], [ "Row four", "c.xhtml#row4" ]
        ]);

        expect(landed).toStrictEqual([
            [ "Cover", "<div>" ], [ "Link", "<p>See <a href=\"#dest\"" ],
            [ "Inner", "<p>Go <a href=\"#dest\"" ], [ "Rule", "<hr id=\"rule\">" ],
            [ "Page", "<p>Page" ],
            [ "Chapter I", "<h2>CHAPTER I." ], [ "Table", "<div class=\"table-container\">" ],
            [ "Cell", "<td id=\"cell\">Two" ], [ "Cell again", "<td id=\"cell\">Two" ],
            [ "Row three", "<td>Three" ], [ "Row four", "<td id=\"cell4\">Four" ]
        ]);
    });

    it("lands a group where its first shown part does, and leaves out entries it cannot show",
        async () => {
        const { landed, preview } = await convertBook({
            "locked.xhtml": "<h2 id=\"part\">Locked</h2>",
            "open.xhtml": "<h2>Open</h2><p id=\"part\">Part</p>"
        }, [
            [ "Group", null,
                [ [ "Locked first", "locked.xhtml" ], [ "Open second", "open.xhtml" ] ] ],
            [ "Own place", "locked.xhtml#part", [ [ "Readable child", "open.xhtml#part" ] ] ],
            [ "Not in the book", "gone.xhtml" ]
        ], { encrypted: [ "OEBPS/locked.xhtml" ] });

        expect(landed).toStrictEqual([
            [ "Group", "<h2>Open" ], [ "Locked first", undefined ], [ "Open second", "<h2>Open" ],
            [ "Own place", undefined ], [ "Readable child", "<p id=\"part\">Part" ],
            [ "Not in the book", undefined ]
        ]);
        // The group shares the element of its part, in one attribute, in the order of the entries.
        expect(readMarks(preview).map((value) => value.split(" ").length)).toStrictEqual([ 2, 1 ]);
    });

    it("checks a landing against the book's own id only when nothing else can give that id",
        async () => {
        const { landed, record } = await convertBook({
            "c1.xhtml": "<section id=\"sec\"><h2>First chapter</h2></section>"
                + "<section id=\"introduction\"><p>An epigraph</p><h2>Introduction</h2></section>"
                + "<section id=\"legacy\"><h2>Legacy</h2></section>"
                + "<p id=\"footnote-1\">Named like a note</p>",
            "c2.xhtml": "<h2 id=\"sec\">Another chapter</h2>",
            "c3.xhtml": "<a name=\"legacy\"></a><p>A named anchor</p>",
            "c4.xhtml": "<p>Before</p><h2><a id=\"chap01\" name=\"chap01\"></a>CHAPTER I.</h2>"
                + "<p>Before</p><h2><a name=\"chap02\"></a>CHAPTER II.</h2>"
        }, [
            [ "Sec", "c1.xhtml#sec" ], [ "Introduction", "c1.xhtml#introduction" ],
            [ "Legacy", "c1.xhtml#legacy" ], [ "Note", "c1.xhtml#footnote-1" ],
            [ "Chapter I", "c4.xhtml#chap01" ], [ "Chapter II", "c4.xhtml#chap02" ]
        ]);

        expect(landed).toStrictEqual([
            [ "Sec", "<h2>First chapter" ], [ "Introduction", "<p>An epigraph" ],
            [ "Legacy", "<h2>Legacy" ], [ "Note", "<p id=\"footnote-1\">Named" ],
            [ "Chapter I", "<h2>CHAPTER I." ], [ "Chapter II", "<h2>CHAPTER II." ]
        ]);
        expect(record.destinations.map(({ bookId }) => bookId)).toStrictEqual([
            undefined, "introduction", undefined, undefined, "chap01", "chap02"
        ]);
    });

    it("finds no destination where the book's own id stands for another element", () => {
        const record: TocPassRecord = {
            prefix: "trilium_toc_",
            entries: [ { title: "Cover", level: 1, destination: 0 } ],
            isCut: false,
            destinations: [ { marker: "trilium_toc_0", bookId: "cover" } ]
        };
        const image = "<div><div class=\"image-container\">"
            + "<img id=\"cover\" src=\"c.png\"></div></div>";

        const onHeading = `${image}<h2 id="trilium_toc_0">Unrelated</h2>`;
        const onWrapper = `<a id="trilium_toc_0" name="trilium_toc_0"></a>`
            + `${image}<h2>Unrelated</h2>`;
        expect(findLandings(onHeading, record)).toStrictEqual([ undefined ]);
        expect(findLandings(onWrapper, record)).toStrictEqual([ onWrapper.indexOf("<div>") + 4 ]);
        // Without the book's id, or with it twice, the marker stands.
        expect(findLandings(onHeading.replace(" id=\"cover\"", ""), record))
            .not.toStrictEqual([ undefined ]);
        expect(findLandings(onHeading + image, record)).not.toStrictEqual([ undefined ]);
        // A run of the converter's anchors with no start tag after it stands for nothing.
        const dangling = "<p>Text</p><a id=\"trilium_toc_0\" name=\"trilium_toc_0\"></a></div>";
        expect(findLandings(dangling, { ...record, destinations: [ { marker: "trilium_toc_0" } ] }))
            .toStrictEqual([ undefined ]);
    });
});

describe("readEpubToc and markEpubPreview", () => {
    it("binds sibling entries of one title by the authored outline, whichever of them shows",
        async () => {
        const nav = navList([
            [ "Summary", "a.xhtml#s1" ], [ "Summary", "b.xhtml#s2" ], [ "Part", "locked.xhtml",
                [ [ "Scope", "a.xhtml#scope" ] ] ]
        ]);
        const first = buildEpub({
            "a.xhtml": "<h2 id=\"s1\">Summary</h2><h3 id=\"scope\">Scope</h3>",
            "b.xhtml": "<p>B</p>",
            "locked.xhtml": "<p>Locked</p>"
        }, { nav, encrypted: [ "OEBPS/locked.xhtml" ] });
        const second = buildEpub({
            "a.xhtml": "<p>A</p><h3 id=\"scope\">Scope</h3>",
            "b.xhtml": "<h2 id=\"s2\">Summary</h2>",
            "locked.xhtml": "<p>Locked</p>"
        }, { nav, encrypted: [ "OEBPS/locked.xhtml" ] });

        const firstToc = await readEpubToc(first);
        const secondToc = await readEpubToc(second);

        expect(firstToc.headings).toStrictEqual([
            { title: "Summary", level: 1 }, { title: "Summary", level: 1 },
            { title: "Part", level: 1, isShown: false }, { title: "Scope", level: 2 }
        ]);
        expect(secondToc.headings.map(({ isShown }) => isShown))
            .toStrictEqual([ undefined, undefined, false, undefined ]);
        const outline = firstToc.headings as { title: string; level: number }[];
        const ids = getHeadingIds(outline, "blob1", false, false);
        expect(ids[0]).not.toBe(ids[1]);
        expect(ids[0]).toContain(".blob1");
        expect(getHeadingIds(outline, "blob2", false, false)[0]).not.toBe(ids[0]);
        expect(firstToc.properties).toStrictEqual({ reader: EPUB_TOC_READER });
    });

    it("marks nothing for an entry of a chapter it cannot read, whatever the preview's ids",
        async () => {
        const bytes = buildEpub({
            "locked.xhtml": "<p>Locked</p>",
            "open.xhtml": "<h2>Trilium Toc 0</h2><h2 id=\"x\">trilium_toc_0</h2>"
        }, { nav: navList([ [ "Locked", "locked.xhtml" ] ]), encrypted: [ "OEBPS/locked.xhtml" ] });

        const toc = await readEpubToc(bytes);
        const outcome = await runTocPass(bytes);
        const html = await convertOfficeToHtml(readMarked(outcome).bytes, EPUB_MIME);

        expect(toc.headings).toStrictEqual([ { title: "Locked", level: 1, isShown: false } ]);
        expect(readMarks(markEpubPreview(html, readMarked(outcome).record, SOURCE)))
            .toStrictEqual([]);
    });

    it("throws a refusal and rethrows a failure, and reads a book without a table of contents",
        async () => {
        const nav = navList([ [ "A", "a.xhtml" ] ]);
        const altered = patchCentral(buildEpub({ "a.xhtml": "<p>A</p>" }, { nav }), "OEBPS/a.xhtml",
            (view, at) => view.setUint32(at + 16, 1, true));
        await expect(readEpubToc(altered)).rejects.toThrow(TocPassRefusal);
        expect(await readEpubToc(buildEpub({ "a.xhtml": "<p>A</p>" })))
            .toStrictEqual({ headings: [], properties: { reader: EPUB_TOC_READER } });

        const failure = new RangeError("Out of memory");
        const convert = OfficeConverter.convert.bind(OfficeConverter);
        vi.spyOn(OfficeConverter, "convert").mockImplementationOnce(() => Promise.reject(failure))
            .mockImplementation(convert);
        await expect(readEpubToc(buildEpub({ "a.xhtml": "<p>A</p>" }, { nav })))
            .rejects.toBe(failure);
    });
});

type NavItem = [ title: string, href: string | null, children?: NavItem[] ];

/** The `<li>` items of a navigation of `items`, nested. */
function navList(items: NavItem[]): string {
    return items.map(([ title, href, children ]) => {
        const label = href === null ? `<span>${title}</span>` : `<a href="${href}">${title}</a>`;
        return `<li>${label}${children ? `<ol>${navList(children)}</ol>` : ""}</li>`;
    }).join("");
}

/**
 * Converts the book of `chapters` and the navigation `items`, and answers where each entry lands:
 * the start of the landing element's markup in the unmarked preview, or `undefined`.
 */
async function convertBook(
    chapters: Record<string, string>, items: NavItem[], options: { encrypted?: string[] } = {}
) {
    let outcome: TocPassOutcome | undefined;
    const bytes = buildEpub(chapters, { nav: navList(items), ...options });
    const html = await convertOfficeToHtml(bytes, EPUB_MIME, {
        onTocPass: (passed) => {
            outcome = passed;
        }
    });
    const marked = readMarked(outcome);
    const landings = findLandings(html, marked.record);
    // The markup from the landing element on, without the markers.
    const landed = marked.record.entries.map(({ title }, index) => {
        const at = landings[index];
        const markup = at === undefined ? undefined : html.slice(html.lastIndexOf("<", at))
            .replace(/<a id="trilium_toc_\d+" name="trilium_toc_\d+"><\/a>/g, "")
            .replace(/ id="trilium_toc_\d+"/g, "");
        return [ title, markup && prefixOf(markup, LANDED_PREFIXES) ];
    });
    return { record: marked.record, preview: markEpubPreview(html, marked.record, SOURCE), landed };
}

/** The starts of the landing elements that the specs name. */
const LANDED_PREFIXES = [
    "<div class=\"table-container\">", "<p>See <a href=\"#dest\"", "<p>Go <a href=\"#dest\"",
    "<td id=\"cell\">Two", "<td id=\"cell4\">Four", "<p id=\"footnote-1\">Named", "<h2>CHAPTER II.",
    "<h2>First chapter", "<h2>CHAPTER I.", "<p>An epigraph", "<td>Three", "<h2>Legacy", "<h2>Open",
    "<p>Page", "<p id=\"part\">Part", "<div>", "<hr id=\"rule\">"
];

function prefixOf(markup: string, prefixes: string[]) {
    return prefixes.find((prefix) => markup.startsWith(prefix)) ?? markup.slice(0, 40);
}

function readMarked(outcome: TocPassOutcome | undefined) {
    if (outcome?.status !== "marked") {
        throw new Error(`The pass did not mark the book: ${JSON.stringify(outcome)}`);
    }
    return outcome;
}

/** The values of `data-toc-heading` in `html`, in document order. */
function readMarks(html: string) {
    return Array.from(html.matchAll(/data-toc-heading="([^"]*)"/g), ([ , value ]) => value);
}

function readChapter(bytes: Uint8Array, name: string) {
    return strFromU8(unzipSync(bytes)[`OEBPS/${name}`]);
}

/** Applies `patch` to the central directory header of the entry `name` of `zip`. */
function patchCentral(
    zip: Uint8Array, name: string, patch: (view: DataView, offset: number) => void
) {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let at = 0; at + 46 <= zip.length; at++) {
        if (view.getUint32(at, true) === 0x02014b50) {
            const nameLength = view.getUint16(at + 28, true);
            if (strFromU8(zip.subarray(at + 46, at + 46 + nameLength)) === name) {
                patch(view, at);
                return zip;
            }
        }
    }
    throw new Error(`No entry '${name}'.`);
}
