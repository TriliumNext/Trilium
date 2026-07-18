import { describe, expect, it } from "vitest";
import { extractHighlightsFromStaticHtml } from "./HighlightsList.js";

describe("extractHighlightsFromStaticHtml", () => {
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
});
