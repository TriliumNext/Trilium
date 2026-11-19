import { MAX_TOC_HEADINGS } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { readBookToc } from "./epub_package.js";
import { CONTAINER, navDocument, packageDocument, xhtml } from "./fixtures/epub_books.js";

describe("readBookToc", () => {
    it("reads the navigation's entries, levels from nesting, and ignores its other lists",
        async () => {
        const toc = await readToc({
            "OEBPS/text/nav.xhtml": navDocument(`<li><span>Part</span><ol>
                <li><a href="ch%201.xhtml">Chapter &amp; one</a><ol>
                    <li><a href="ch%201.xhtml#sec%20a">Section</a></li></ol></li>
                <li><a href="../other/ch2.xhtml#b">Chapter two</a></li></ol></li>`)
                + "<nav epub:type=\"landmarks\" hidden=\"\">"
                + "<ol><li><a href=\"x.xhtml\">Guide</a></li></ol></nav>"
                + "<nav epub:type=\"page-list\">"
                + "<ol><li><a href=\"x.xhtml#p1\">1</a></li></ol></nav>"
        }, { navPath: "text/nav.xhtml" });

        expect(toc?.entries).toStrictEqual([
            { title: "Part", level: 1 },
            { title: "Chapter & one", level: 2,
                target: { path: "OEBPS/text/ch 1.xhtml", fragment: "" } },
            { title: "Section", level: 3,
                target: { path: "OEBPS/text/ch 1.xhtml", fragment: "sec a" } },
            { title: "Chapter two", level: 2,
                target: { path: "OEBPS/other/ch2.xhtml", fragment: "b" } }
        ]);
        expect(toc?.isCut).toBe(false);
    });

    it("reads the NCX of a book without a navigation document, and prefers the navigation",
        async () => {
        const ncx = ncxDocument(navPoint("Chapter 1", "ch1.xhtml",
            navPoint("Section &lt;1&gt;", "ch1.xhtml#s1")) + navPoint("Chapter 2", "ch2.xhtml"));

        expect((await readToc({ "OEBPS/toc.ncx": ncx }, { ncxPath: "toc.ncx" }))?.entries)
            .toStrictEqual([
                { title: "Chapter 1", level: 1, target: { path: "OEBPS/ch1.xhtml", fragment: "" } },
                { title: "Section <1>", level: 2,
                    target: { path: "OEBPS/ch1.xhtml", fragment: "s1" } },
                { title: "Chapter 2", level: 1, target: { path: "OEBPS/ch2.xhtml", fragment: "" } }
            ]);
        const both = await readToc({
            "OEBPS/toc.ncx": ncx,
            "OEBPS/nav.xhtml": navDocument("<li><a href=\"ch1.xhtml\">From the navigation</a></li>")
        }, { ncxPath: "toc.ncx", navPath: "nav.xhtml" });
        expect(both?.entries.map(({ title }) => title)).toStrictEqual([ "From the navigation" ]);
        expect(await readToc({}, {})).toBeNull();
    });

    it("finds the navigation's list by the namespace of its type, whatever the prefix",
        async () => {
        const typed = (namespace: string) => readToc({
            "OEBPS/nav.xhtml": "<html xmlns=\"http://www.w3.org/1999/xhtml\" "
                + `xmlns:OPS="${namespace}"><body><nav OPS:type="toc"><ol>`
                + "<li><a href=\"a.xhtml\">Declared</a></li></ol></nav></body></html>"
        }, { navPath: "nav.xhtml" });

        expect((await typed("http://www.idpf.org/2007/ops"))?.entries)
            .toStrictEqual([ { title: "Declared", level: 1,
                target: { path: "OEBPS/a.xhtml", fragment: "" } } ]);
        expect(await typed("urn:other")).toBeNull();
    });

    it("finds a package without a usable container, and skips the parts it cannot use",
        async () => {
        const manifest = "<item id=\"nav\" href=\"gone.xhtml\" properties=\"nav\"/>"
            + "<item href=\"no-id.xhtml\" media-type=\"application/xhtml+xml\"/>"
            + "<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>"
            + "<item id=\"c\" href=\"c.xhtml\" media-type=\"application/xhtml+xml\"/>"
            + "<item id=\"img\" href=\"i.png\" media-type=\"image/png\"/>";
        const spine = "<itemref/><itemref idref=\"img\"/><itemref idref=\"c\"/>";
        const opf = packageDocument(manifest, " toc=\"ncx\"", spine);
        const ncx = ncxDocument(navPoint("Chapter", "c.xhtml"));
        const readFiles = (files: Record<string, string>) =>
            readBookToc(Object.keys(files), (path) => Promise.resolve(files[path]));

        const expected = {
            entries: [ { title: "Chapter", level: 1, target: { path: "c.xhtml", fragment: "" } } ],
            isCut: false,
            chapters: [ "c.xhtml" ]
        };
        expect(await readFiles({ "book.opf": opf, "toc.ncx": ncx })).toStrictEqual(expected);
        expect(await readFiles({ "META-INF/container.xml": CONTAINER, "book.opf": opf,
            "toc.ncx": ncx })).toStrictEqual(expected);
        expect(await readFiles({ "book.opf": opf })).toBeNull();
    });

    it("reads a navigation without a list, an NCX without a navMap, and unlabeled entries",
        async () => {
        const ncx = ncxDocument("<navPoint><content src=\"a.xhtml\"/>"
            + `${navPoint("Child", "a.xhtml#c")}</navPoint>`
            + "<navPoint><navLabel><text>No target</text></navLabel></navPoint>"
            + "<navPoint><navLabel/></navPoint>");
        const noList = xhtml("<nav epub:type=\"toc\"><h1>Contents</h1></nav>");

        expect((await readToc({ "OEBPS/toc.ncx": ncx }, { ncxPath: "toc.ncx" }))?.entries)
            .toStrictEqual([
                { title: "Child", level: 1, target: { path: "OEBPS/a.xhtml", fragment: "c" } },
                { title: "No target", level: 1 }
            ]);
        expect((await readToc({ "OEBPS/toc.ncx": "<ncx><head/></ncx>" }, { ncxPath: "toc.ncx" }))
            ?.entries).toStrictEqual([]);
        expect((await readToc({ "OEBPS/nav.xhtml": noList }, { navPath: "nav.xhtml" }))?.entries)
            .toStrictEqual([]);
    });

    it("reads a navigation whatever quirks its markup has, up to where it ends", async () => {
        const items = [
            "<li><a href=#top>Same file</a></li>",
            "<li><a href=\"./sub/../ch%201.xhtml\">Dot path</a></li>",
            "<li><a href=\"ch.xhtml#%E0%A4%A\">Bad escape</a></li>",
            "<li><a href=\"ch.xhtml#m\"><img src=\"x.png\"/>Area <math><mi>x</mi></math>"
                + "<br/>two</a></li>",
            "<li><a href=\"ch.xhtml#c\"><![CDATA[a < b]]> &amp; 1 < 2</a></li>",
            "<li>No label<ol><li><a href=\"ch.xhtml#n\">Nested</a></li></ol></li>"
        ].join("");
        const nav = "<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\" "
            + "xmlns:epub=\"http://www.idpf.org/2007/ops\"><head>"
            + "<script>if (a < b && c > d) {}</script></head><body></div>"
            + "<nav / =\"x\" hidden epub:type=toc epub:type=\"landmarks\">"
            + `<ol>${items}</ol></nav></body></html>`;
        const target = (path: string, fragment: string) => ({ path: `OEBPS/${path}`, fragment });
        const expected = [
            { title: "Same file", level: 1, target: target("nav.xhtml", "top") },
            { title: "Dot path", level: 1, target: target("ch 1.xhtml", "") },
            { title: "Bad escape", level: 1, target: target("ch.xhtml", "%E0%A4%A") },
            { title: "Area x two", level: 1, target: target("ch.xhtml", "m") },
            { title: "a < b & 1 < 2", level: 1, target: target("ch.xhtml", "c") },
            { title: "Nested", level: 2, target: target("ch.xhtml", "n") }
        ];

        const unclosed = [
            "", "text after the document", "<!-- comment", "<![CDATA[ section", "<?instruction",
            "<p title=\"value", "<p id=value", "<script>code"
        ];
        for (const tail of unclosed) {
            const toc = await readToc({ "OEBPS/nav.xhtml": nav + tail }, { navPath: "nav.xhtml" });
            expect(toc?.entries).toStrictEqual(expected);
        }
    });

    it("titles a label by its text, an image's alt, a formula's alttext, else its title",
        async () => {
        const toc = await readToc({
            "OEBPS/nav.xhtml": navDocument([
                "<li><a href=\"a.xhtml\"><b>Bold</b> &#8212; <i>text</i></a></li>",
                "<li><a href=\"a.xhtml#f\"><img src=\"f.png\" alt=\"Figure one\"/></a></li>",
                "<li><a href=\"a.xhtml#m\">Area <math alttext=\"x^2\"><mi>x</mi></math></a></li>",
                "<li><a href=\"a.xhtml#t\" title=\"By its title\"> </a></li>"
            ].join(""))
        }, { navPath: "nav.xhtml" });

        expect(toc?.entries.map(({ title, level }) => [ title, level ])).toStrictEqual([
            [ "Bold — text", 1 ], [ "Figure one", 1 ], [ "Area x^2", 1 ], [ "By its title", 1 ]
        ]);
    });

    it("leaves an untitled entry out as if absent, so its child nests under the entry before it",
        async () => {
        const toc = await readToc({
            "OEBPS/nav.xhtml": navDocument("<li><a href=\"a.xhtml#a\">A</a></li>"
                + "<li><a href=\"a.xhtml#x\"></a>"
                + "<ol><li><a href=\"a.xhtml#b\">B</a></li></ol></li>"
                + "<li><span>C</span></li>")
        }, { navPath: "nav.xhtml" });

        expect(toc?.entries.map(({ title, level }) => [ title, level ]))
            .toStrictEqual([ [ "A", 1 ], [ "B", 2 ], [ "C", 1 ] ]);
    });

    it("keeps MAX_TOC_HEADINGS entries and tells whether another one follows", async () => {
        const items = (count: number) => Array.from({ length: count },
            (_, index) => `<li><a href="a.xhtml#e${index}">Entry ${index}</a></li>`).join("");

        const full = await readToc({ "OEBPS/nav.xhtml": navDocument(items(MAX_TOC_HEADINGS)) },
            { navPath: "nav.xhtml" });
        const cut = await readToc({ "OEBPS/nav.xhtml": navDocument(items(MAX_TOC_HEADINGS + 1)) },
            { navPath: "nav.xhtml" });

        expect([ full?.entries.length, full?.isCut ]).toStrictEqual([ MAX_TOC_HEADINGS, false ]);
        expect([ cut?.entries.length, cut?.isCut ]).toStrictEqual([ MAX_TOC_HEADINGS, true ]);
    });
});

async function readToc(files: Record<string, string>, { navPath, ncxPath }: {
    navPath?: string; ncxPath?: string;
}) {
    const manifest = [
        navPath ? `<item id="nav" href="${navPath}" media-type="application/xhtml+xml"`
            + " properties=\"nav\"/>" : "",
        ncxPath ? `<item id="ncx" href="${ncxPath}" media-type="application/x-dtbncx+xml"/>` : ""
    ].join("");
    const all: Record<string, string> = {
        "META-INF/container.xml": CONTAINER,
        "OEBPS/content.opf": packageDocument(manifest, ncxPath ? " toc=\"ncx\"" : "", ""),
        ...files
    };
    return readBookToc(Object.keys(all), (path) => Promise.resolve(all[path]));
}

function ncxDocument(points: string) {
    return "<?xml version=\"1.0\"?>"
        + "<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">"
        + `<head/><docTitle><text>Book</text></docTitle><navMap>${points}</navMap></ncx>`;
}

function navPoint(title: string, src: string, children = "") {
    return `<navPoint id="${src}"><navLabel><text>${title}</text></navLabel><content src="${src}"/>`
        + `${children}</navPoint>`;
}
