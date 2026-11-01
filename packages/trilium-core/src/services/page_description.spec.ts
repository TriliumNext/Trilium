import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";

import { findPageDescription } from "./page_description.js";

const describedBy = (html: string) => findPageDescription(parse(html));

/** A paragraph long enough to pass for a summary, in `length` characters. */
const prose = (length: number, word = "sentence ") => word.repeat(Math.ceil(length / word.length)).slice(0, length).trim();

describe("findPageDescription", () => {
    it("takes the opening sentence of the page's own writing", () => {
        // The case this exists for: a Wikipedia article publishes og:title and nothing else, while
        // opening with a perfectly good sentence saying what it is about.
        const html = `<html><body>
            <div id="mw-content-text">
                <p>Fowler–Noll–Vo (or FNV) is a non-cryptographic hash function created by Glenn Fowler and others.</p>
                <p>${prose(120)}</p>
            </div>
        </body></html>`;

        expect(describedBy(html)).toBe("Fowler–Noll–Vo (or FNV) is a non-cryptographic hash function created by Glenn Fowler and others.");
    });

    it("looks inside the article before the page at large", () => {
        // A banner above the content is earlier in the document and long enough to pass; the
        // article is where the page's own writing is.
        const html = `<html><body>
            <div class="cookie-banner"><p>${prose(150, "We value your privacy ")}</p></div>
            <article><p>${prose(150, "The article itself ")}</p></article>
        </body></html>`;

        expect(describedBy(html)?.startsWith("The article itself")).toBe(true);
    });

    it("passes over what is too short to be a summary", () => {
        // Captions, bylines and stray lines of chrome.
        const html = `<html><body><article>
            <p>By A. Writer</p>
            <p>3 min read</p>
            <p>${prose(120, "The actual summary ")}</p>
        </article></body></html>`;

        expect(describedBy(html)?.startsWith("The actual summary")).toBe(true);
    });

    it("passes over the furniture, wherever in the document it sits", () => {
        for (const tag of [ "nav", "aside", "header", "footer", "figure", "table", "form" ]) {
            const html = `<html><body>
                <${tag}><p>${prose(150, "Furniture text ")}</p></${tag}>
                <p>${prose(150, "The page itself ")}</p>
            </body></html>`;

            expect(describedBy(html)?.startsWith("The page itself"), tag).toBe(true);
        }
    });

    it("passes over a paragraph that is mostly links", () => {
        // A cookie notice, a row of breadcrumbs or a footer of policy links can each be long enough
        // to pass for a summary. What they are not is prose.
        const links = Array.from({ length: 12 }, (_, i) => `<a href="/p${i}">Some policy link ${i}</a>`).join(" · ");
        const html = `<html><body>
            <p>${links}</p>
            <p>${prose(150, "Actual prose ")}</p>
        </body></html>`;

        expect(describedBy(html)?.startsWith("Actual prose")).toBe(true);
    });

    it("keeps a paragraph that merely contains a link", () => {
        // The guard is about navigation, not about prose that happens to cite something.
        const html = `<html><body><p>`
            + `${prose(140, "Ordinary prose ")} and see <a href="/x">this page</a> for more.`
            + `</p></body></html>`;

        expect(describedBy(html)?.startsWith("Ordinary prose")).toBe(true);
    });

    it("bounds what it keeps, this ending up in the note's HTML", () => {
        const description = describedBy(`<html><body><p>${prose(900)}</p></body></html>`) ?? "";

        expect(description.length).toBeLessThanOrEqual(201);
        expect(description.endsWith("…")).toBe(true);
        // Cut on the text, not mid-collapse: no trailing space before the ellipsis.
        expect(description).not.toContain(" …");
    });

    it("reads the text as it would be read, not as it is laid out", () => {
        const html = `<html><body><p>
            Broken   across
            several\tlines ${prose(90)}
        </p></body></html>`;

        expect(describedBy(html)?.startsWith("Broken across several lines")).toBe(true);
    });

    it("says nothing for a page that has no prose in it", () => {
        // Hacker News, and anything else that is a list rather than a document.
        expect(describedBy(`<html><body><table><tr><td><a href="/x">A link</a></td></tr></table></body></html>`)).toBeUndefined();
        expect(describedBy(`<html><body><p>Too short</p></body></html>`)).toBeUndefined();
        expect(describedBy("<html><body></body></html>")).toBeUndefined();
    });

    it("leaves the document as it found it", () => {
        // It reads a tree already parsed for the preview's other parts, so removing the furniture
        // would take the favicon and the icon candidates with it.
        const document = parse(`<html><head><link rel="icon" href="/fav.ico"></head><body>
            <nav><p>${prose(150, "Navigation ")}</p></nav>
            <p>${prose(150, "The page itself ")}</p>
        </body></html>`);

        findPageDescription(document);

        expect(document.querySelector(`link[rel="icon"]`)?.getAttribute("href")).toBe("/fav.ico");
        expect(document.querySelectorAll("nav")).toHaveLength(1);
        expect(document.querySelectorAll("p")).toHaveLength(2);
    });
});
