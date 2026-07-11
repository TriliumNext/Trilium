import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";

import converter from "./converter.js";
import { extractPageId, type LinkTarget, rewritePageLinks } from "./links.js";

// Real OneNote source (debug-captured): the "First page" links to "Second page" with an internal
// `onenote:` link (carrying page-id) immediately followed by an external "Web view" https link.
const FIRST_PAGE_SOURCE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">Go to <a href="onenote:#Second%20page&amp;section-id={4d9d9af6-7f91-4f16-956a-8bf2c330f6ab}&amp;page-id={eb2c4f67-8d3f-4fdb-a93b-32d6b3ba780d}&amp;end">Second page</a> (<a href="https://onedrive.live.com/personal/9b3de8eeb5fefd37/_layouts/15/Doc.aspx?sourcedoc=%7Bb9c20b8c%7D&amp;wd=target%28Link%20test.one%7C4d9d9af6%2FSecond%20page%7Ceb2c4f67-8d3f-4fdb-a93b-32d6b3ba780d%2F%29">Web view</a>)</p>
        </div>
    </body>
</html>`;

const SECOND_PAGE_GUID = "eb2c4f67-8d3f-4fdb-a93b-32d6b3ba780d";
const SECOND_PAGE_CLIENT_URL = `onenote:https://d.docs.live.net/abc/Link%20test.one#Second%20page&section-id={4d9d9af6-7f91-4f16-956a-8bf2c330f6ab}&page-id={${SECOND_PAGE_GUID.toUpperCase()}}&end`;

// A resolver that maps the Second page GUID to a note titled "Second page".
const resolveSecondPage = (title = "Second page"): ((pageId: string) => LinkTarget | null) => (pageId) =>
    pageId === SECOND_PAGE_GUID ? { noteId: "noteABC123", title } : null;

const internalLink = (text: string) => `<a href="onenote:#x&page-id={${SECOND_PAGE_GUID}}&end">${text}</a>`;

describe("extractPageId", () => {
    it("pulls the lowercased page-id GUID from an internal link and from a client URL", () => {
        expect(extractPageId(`onenote:#Second%20page&page-id={${SECOND_PAGE_GUID}}&end`)).toBe(SECOND_PAGE_GUID);
        expect(extractPageId(SECOND_PAGE_CLIENT_URL)).toBe(SECOND_PAGE_GUID); // upper-cased GUID normalized
    });

    it("returns null when there is no page-id (web-view URL, external link, empty input)", () => {
        // The "Web view" onedrive URL embeds the GUID inside wd=target(...), not as a page-id= param.
        expect(extractPageId("https://onedrive.live.com/...wd=target%28Link.one%7Csec%2FSecond%7Ceb2c4f67-8d3f-4fdb-a93b-32d6b3ba780d%2F%29")).toBeNull();
        expect(extractPageId("https://example.com")).toBeNull();
        expect(extractPageId(null)).toBeNull();
        expect(extractPageId(undefined)).toBeNull();
    });
});

describe("rewritePageLinks", () => {
    it("turns a link whose text matches the page title into a reference link", () => {
        const out = rewritePageLinks(`<p>${internalLink("Second page")}</p>`, resolveSecondPage());
        const anchor = parse(out).querySelector("a");
        expect(anchor?.getAttribute("href")).toBe("#root/noteABC123");
        expect(anchor?.getAttribute("class")).toBe("reference-link");
    });

    it("keeps the original text on a plain link when it does not match the title", () => {
        const out = rewritePageLinks(`<p>${internalLink("click here")}</p>`, resolveSecondPage());
        const anchor = parse(out).querySelector("a");
        expect(anchor?.getAttribute("href")).toBe("#root/noteABC123");
        expect(anchor?.getAttribute("class")).toBeFalsy(); // not a reference link
        expect(anchor?.textContent).toBe("click here");
    });

    it("leaves a link untouched when its target was not imported", () => {
        const html = `<p>${internalLink("Second page")}</p>`;
        expect(rewritePageLinks(html, () => null)).toBe(html); // resolve returns null -> verbatim input
    });

    it("never touches non-onenote links (external / web-view) or link-free content", () => {
        const webView = `<p><a href="https://onedrive.live.com/...">Web view</a></p>`;
        expect(rewritePageLinks(webView, resolveSecondPage())).toBe(webView);
        expect(rewritePageLinks("<p>no links here</p>", resolveSecondPage())).toBe("<p>no links here</p>");
    });

    it("resolves each link independently in mixed content", () => {
        const html =
            `<p><a href="onenote:#A&page-id={11111111-1111-1111-1111-111111111111}&end">A</a></p>` +
            `<p><a href="onenote:#B&page-id={22222222-2222-2222-2222-222222222222}&end">B</a></p>` +
            `<p><a href="https://example.com">external</a></p>`;
        const out = rewritePageLinks(html, (pageId) => (pageId.startsWith("11111111") ? { noteId: "noteA", title: "A" } : null));

        const hrefs = parse(out).querySelectorAll("a").map((a) => a.getAttribute("href"));
        expect(hrefs).toEqual(["#root/noteA", "onenote:#B&page-id={22222222-2222-2222-2222-222222222222}&end", "https://example.com"]);
    });

    it("drops the redundant '(Web view)' link and its parentheses next to a reference link", () => {
        const html = `<p>Go to ${internalLink("Second page")} (<a href="https://onedrive.live.com/x?wd=target(${SECOND_PAGE_GUID})">Web view</a>).</p>`;
        const out = rewritePageLinks(html, resolveSecondPage());
        const paragraph = parse(out).querySelector("p");

        expect(paragraph?.querySelectorAll("a")).toHaveLength(1); // only the reference link remains
        expect(out).not.toContain("onedrive");
        expect(paragraph?.textContent).toBe("Go to Second page."); // "( )" wrapper cleaned up
    });

    it("keeps the web-view link when the internal link is a plain (non-matching) link", () => {
        const html = `<p>Go to ${internalLink("click here")} (<a href="https://onedrive.live.com/x?wd=target(${SECOND_PAGE_GUID})">Web view</a>).</p>`;
        const out = rewritePageLinks(html, resolveSecondPage());
        expect(parse(out).querySelectorAll("a")).toHaveLength(2); // web link not dropped
    });
});

// Guards the load-bearing assumption that the sanitizer keeps the `onenote:` href (the scheme is in
// ALLOWED_PROTOCOLS): the importer rewrites links on the *converted* HTML, so if conversion dropped
// the href, cross-page links would silently never resolve.
describe("convertPageHtml + rewritePageLinks (end to end)", () => {
    it("preserves the link through conversion, makes a reference link and drops the web view", () => {
        const converted = converter.convertPageHtml(FIRST_PAGE_SOURCE);
        expect(extractPageId(parse(converted).querySelector("a")?.getAttribute("href"))).toBe(SECOND_PAGE_GUID);

        const out = rewritePageLinks(converted, resolveSecondPage());
        const paragraph = parse(out).querySelector("p");
        const anchors = paragraph?.querySelectorAll("a") ?? [];

        expect(anchors).toHaveLength(1);
        expect(anchors[0]?.getAttribute("href")).toBe("#root/noteABC123");
        expect(anchors[0]?.getAttribute("class")).toBe("reference-link");
        expect(out).not.toContain("onedrive");
        expect(paragraph?.textContent?.replace(/\s+/g, " ").trim()).toBe("Go to Second page");
    });
});
