// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
    findRequestedHeading, getHeadingLevel, getHeadingText, isAnchor, toReferenceTargets
} from "./reference_targets.js";

/** The first node that `html` parses into. */
function parse(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstChild as ChildNode;
}

describe("getHeadingText", () => {
    it("reads a heading as plain text, as the text editor lists it", () => {
        const cases: [ string, string ][] = [
            [ "<h2>Tom &amp; <strong>Jerry</strong></h2>", "Tom & Jerry" ],
            [ "<h2>Line<br>break</h2>", "Line break" ],
            [ `<h2>Area<span class="x math-tex">\\(r\\)</span>formula</h2>`, "Area formula" ],
            [ `<h2><img src="x">Image</h2>`, "Image" ],
            [ `<h2>Book<a id="mark"></a>mark</h2>`, "Book mark" ],
            [ "<h2>  Spaced \n\t out&nbsp; </h2>", "Spaced out" ],
            [ "<h2>&lt;b&gt;Not bold&lt;/b&gt;</h2>", "<b>Not bold</b>" ],
            [ "<h2> <br> </h2>", "" ]
        ];

        for (const [ html, title ] of cases) {
            expect(getHeadingText(parse(html)), html).toBe(title);
        }
    });

    it("reads an <a> with an href as a link, and leaves out comments and nested headings", () => {
        const outer = parse("<h2>Outer<!-- comment --></h2>");
        outer.appendChild(parse("<h3>Inner</h3>"));
        outer.appendChild(document.createTextNode(" end"));

        expect(getHeadingText(parse(`<h2>A<a href="">link</a>B<a href="#x">C</a></h2>`)))
            .toBe("AlinkBC");
        expect(getHeadingText(outer)).toBe("Outer end");
    });
});

describe("getHeadingLevel and isAnchor", () => {
    it("tells headings and anchors from other nodes", () => {
        const levels = [ "<h1>a</h1>", "<H6>a</H6>", "<p>a</p>", "<header>a</header>", "text" ]
            .map((html) => getHeadingLevel(parse(html)));
        const anchors = [
            `<a id="a"></a>`, "<A>a</A>", `<a href="">a</a>`, `<a href="#b">b</a>`,
            "<abbr>a</abbr>", "text"
        ].map((html) => isAnchor(parse(html)));

        expect(levels).toEqual([ 1, 6, 0, 0, 0 ]);
        expect(anchors).toEqual([ true, true, false, false, false, false ]);
    });
});

describe("toReferenceTargets", () => {
    it("lists the headings in their order, then each anchor once, sorted by name", () => {
        const headings = [ { title: "B", level: 2, id: "b" }, { title: "A", level: 3 } ];

        expect(toReferenceTargets(headings, [ "z", "a", "z" ])).toStrictEqual([
            { kind: "heading", title: "B", level: 2, params: { block: "b" } },
            { kind: "heading", title: "A", level: 3 },
            { kind: "anchor", title: "a", params: { bookmark: "a" } },
            { kind: "anchor", title: "z", params: { bookmark: "z" } }
        ]);
    });
});

describe("findRequestedHeading", () => {
    it("finds the heading by index while its title holds, else the only one with the title", () => {
        const headings = [ "New", "Target", "Twin", "Twin" ].map((title) => ({ title, level: 2 }));
        const find = (index: number, title: string) =>
            findRequestedHeading(headings, { index, title });

        expect(find(2, "Twin")).toBe(headings[2]);
        for (const index of [ 0, 9, -1 ]) {
            expect(find(index, "Target")).toBe(headings[1]);
        }
        expect(find(0, "Twin")).toBeNull();
        expect(find(1, "Gone")).toBeNull();
    });
});
