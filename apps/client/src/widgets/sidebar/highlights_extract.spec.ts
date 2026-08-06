import { describe, expect, it } from "vitest";
import { extractHighlightsFromStaticHtml, htmlForRun } from "./highlights_extract.js";

describe("extractHighlightsFromStaticHtml", () => {
    /** Extracts from `html` rendered into an attached container, which is then cleaned up. */
    function extract(html: string) {
        const container = document.createElement("div");
        container.innerHTML = html;
        document.body.appendChild(container);

        try {
            return extractHighlightsFromStaticHtml(container);
        } finally {
            document.body.removeChild(container);
        }
    }

    it("extracts a single highlight containing text and math equation together", () => {
        const container = document.createElement("div");
        container.innerHTML = `<p>
            <span style="background-color:hsl(30,75%,60%);">
                Highlighted&nbsp;
                <span class="math-tex">
                    \\(e=mc^2\\)
                </span>
                &nbsp;math
            </span>
        </p>`;
        document.body.appendChild(container);

        const highlights = extractHighlightsFromStaticHtml(container);

        // Should extract 1 combined highlight, not 3 separate ones
        expect(highlights.length).toBe(1);

        // The highlight should contain the full innerHTML of the styled span
        const highlight = highlights[0];
        expect(highlight.text).toContain("Highlighted");
        expect(highlight.text).toContain("math-tex");
        expect(highlight.text).toContain("e=mc^2");
        expect(highlight.text).toContain("math");
        expect(highlight.attrs.background).toBeTruthy();

        document.body.removeChild(container);
    });

    it("extracts separate highlights for differently styled spans", () => {
        const container = document.createElement("div");
        container.innerHTML = `<p>
            <span style="background-color:yellow;">Yellow text</span>
            normal text
            <span style="background-color:red;">Red text</span>
        </p>`;
        document.body.appendChild(container);

        const highlights = extractHighlightsFromStaticHtml(container);

        // Should extract 2 separate highlights (yellow and red)
        expect(highlights.length).toBe(2);
        expect(highlights[0].text).toBe("Yellow text");
        expect(highlights[1].text).toBe("Red text");

        document.body.removeChild(container);
    });

    describe("formatting nested with a coloured run", () => {
        // Both nestings render identically, so both must report the run once rather than
        // once per element. Only the first shape used to double up.
        it("reports a coloured run inside formatting once, carrying both", () => {
            const highlights = extract(`<p><strong><span style="color:red">text</span></strong></p>`);

            expect(highlights.length).toBe(1);
            expect(highlights[0].text).toBe("text");
            expect(highlights[0].attrs).toMatchObject({ bold: true, color: "red" });
        });

        it("reports formatting inside a coloured run once", () => {
            const highlights = extract(`<p><span style="color:red"><strong>text</strong></span></p>`);

            expect(highlights.length).toBe(1);
            expect(highlights[0].text).toBe("<strong>text</strong>");
            expect(highlights[0].attrs).toMatchObject({ color: "red" });
        });

        // `**==hl==**` in a Markdown note renders as exactly this.
        it("reports a bold highlight once", () => {
            const highlights = extract(`<p><strong><span style="background-color:hsl(60, 75%, 60%)">hl</span></strong></p>`);

            expect(highlights.length).toBe(1);
            expect(highlights[0].attrs).toMatchObject({ bold: true, background: "hsl(60, 75%, 60%)" });
        });

        it("keeps formatting that only partly covers a coloured run", () => {
            // The bold "a … c" is a run of its own — dropping it as a duplicate would lose it.
            const highlights = extract(`<p><strong>a <span style="color:red">b</span> c</strong></p>`);

            expect(highlights.map(h => h.text)).toEqual([ "b", `a <span style="color:red">b</span> c` ]);
        });

        it("keeps sibling formatting alongside a coloured run", () => {
            const highlights = extract(`<p><span style="color:red">a</span> <strong>b</strong></p>`);

            expect(highlights.map(h => h.text)).toEqual([ "a", "b" ]);
        });

        it("reports formatting split across several coloured runs once", () => {
            // Every character of the <strong> is inside a run already reported as bold, so the
            // <strong> itself would only repeat them — with the colours lost.
            const highlights = extract(
                `<p><strong><span style="color:red">a</span><span style="color:blue">b</span></strong></p>`
            );

            expect(highlights.map(h => h.text)).toEqual([ "a", "b" ]);
        });

        it("ignores whitespace between the runs when deciding that", () => {
            const highlights = extract(
                `<p><strong><span style="color:red">a</span>\n <span style="color:blue">b</span></strong></p>`
            );

            expect(highlights.map(h => h.text)).toEqual([ "a", "b" ]);
        });

        it("keeps formatting holding text of its own between coloured runs", () => {
            const highlights = extract(
                `<p><strong><span style="color:red">a</span> and <span style="color:blue">b</span></strong></p>`
            );

            expect(highlights.map(h => h.text)).toEqual([
                "a",
                "b",
                `<span style="color:red">a</span> and <span style="color:blue">b</span>`
            ]);
        });
    });

    describe("runs with nothing to report", () => {
        it("returns nothing when there is no content element", () => {
            // The sidebar asks before the note's content is on screen.
            expect(extractHighlightsFromStaticHtml(null)).toEqual([]);
        });

        it("ignores an element holding only whitespace", () => {
            expect(extract(`<p><span style="color:red"> </span><strong> </strong></p>`)).toEqual([]);
        });

        it("ignores a style that names a colour without setting one", () => {
            // `border-color` satisfies the `[style*="color"]` selector but is not a text colour.
            expect(extract(`<p><span style="border-color:red">plain</span></p>`)).toEqual([]);
        });

        it("reports an element that is both formatted and coloured once", () => {
            // Matches both passes; the second must recognise it as already reported.
            const highlights = extract(`<p><strong style="color:red">both</strong></p>`);

            expect(highlights.length).toBe(1);
            expect(highlights[0].attrs).toMatchObject({ bold: true, color: "red" });
        });
    });
});

describe("htmlForRun", () => {
    function element(html: string) {
        const el = document.createElement("div");
        el.innerHTML = html;
        return el;
    }

    it("keeps the markup when the element holds the run and nothing else", () => {
        // What a formatting element wrapping the run looks like — nested content has to survive.
        const el = element(`Mass <span class="math-tex">\\(e=mc^2\\)</span>`);

        expect(htmlForRun(el, "Mass \\(e=mc^2\\)")).toBe(`Mass <span class="math-tex">\\(e=mc^2\\)</span>`);
    });

    it("falls back to the run's text when the element holds more than the run", () => {
        // The mapper lands on the block for a run at its start, so the element here is the whole
        // paragraph; taking its markup would list every word as a single highlight.
        const paragraph = element(`<span style="color:red">One</span> Two Three`);

        expect(htmlForRun(paragraph, "One")).toBe("One");
    });

    it("ignores whitespace around the run when comparing", () => {
        const el = element(`\n    <b>One</b>\n`);

        expect(htmlForRun(el, "One ")).toBe(`\n    <b>One</b>\n`);
    });
});
