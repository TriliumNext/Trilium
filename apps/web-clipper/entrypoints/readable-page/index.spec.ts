import type { Window as HappyDOMWindow } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type { PageVariant } from "@/utils";

import readablePage from "./index";

const PARAGRAPH = "Trilium is a hierarchical note taking application with focus on "
    + "building large personal knowledge bases. It supports rich text, code, canvas and many "
    + "other note types, scripting and sync. ";

describe("readable page", () => {
    beforeEach(() => {
        (window as unknown as HappyDOMWindow).happyDOM.setURL("https://example.com/blog/post.html?id=1#comments");
        document.head.innerHTML = "<title>Post title</title>";
        document.body.innerHTML = "";
    });

    it("returns the article with absolute links, image placeholders and its dates as labels", () => {
        document.head.innerHTML = `
            <title>Article title</title>
            <meta property="article:published_time" content="2026-01-02T10:00:00Z">
            <meta property="article:modified_time" content="2026-02-03T10:00:00Z">
            <meta property="og:description" content="About the article">
            <meta name="author" content="  Jane   Doe ">
            <script>window.tracked = true;</script>`;
        document.body.innerHTML = `
            <nav><a href="/">Home</a> <a href="/archive">Archive</a></nav>
            <article>
                <h1>Article title</h1>
                <p>${PARAGRAPH.repeat(3)}<a href="/docs">Docs</a>
                    <a href="mailto:jane@example.com">Jane</a></p>
                <p>${PARAGRAPH.repeat(3)}</p>
                <img src="figure.png" width="600" height="400">
                <img src="figure.png" width="600" height="400">
                <p onclick="alert(1)">${PARAGRAPH.repeat(3)}</p>
            </article>`;
        const pageBefore = document.documentElement.outerHTML;

        const page = readPage("article");

        expect(page).toMatchObject({
            title: "Article title",
            pageUrl: "https://example.com/blog/post.html?id=1",
            clipType: "page",
            labels: {
                pageDescription: "About the article",
                pageAuthor: "Jane Doe",
                publishedDate: "2026-01-02",
                modifiedDate: "2026-02-03"
            },
            images: [ {
                imageId: expect.stringMatching(/^[A-Za-z0-9]{20}$/),
                src: "https://example.com/blog/figure.png"
            } ]
        });
        expect(page?.content.match(/<img [^>]*>/g)).toEqual([
            expect.stringContaining(`src="${page?.images[0]?.imageId}"`),
            expect.stringContaining(`src="${page?.images[0]?.imageId}"`)
        ]);
        expect(page?.content).toContain("href=\"https://example.com/docs\"");
        expect(page?.content).toContain("href=\"mailto:jane@example.com\"");
        expect(page?.content).not.toContain("Archive");
        expect(page?.content).not.toContain("onclick");
        expect(document.documentElement.outerHTML).toBe(pageBefore);
    });

    it("dates the article from its structured data, and leaves out a date it cannot read", () => {
        const article = `<article><p>${PARAGRAPH.repeat(5)}</p></article>`;
        const structuredData = (datePublished: string) => `<script type="application/ld+json">${JSON.stringify({
            "@context": "https://schema.org", "@type": "NewsArticle", headline: "Post title", datePublished
        })}</script>`;

        document.head.innerHTML = `<title>Post title</title>${structuredData("2025-12-24T08:00:00Z")}
            <meta property="article:published_time" content="">`;
        document.body.innerHTML = article;
        expect(readPage("article")?.labels).toEqual({ publishedDate: "2025-12-24" });

        document.head.innerHTML = `<title>Post title</title>${structuredData("next week")}
            <meta property="article:modified_time" content="not a date">`;
        document.body.innerHTML = article;
        expect(readPage("article")?.labels).toEqual({});
    });

    it("keeps the day the page states, whatever its offset from UTC", () => {
        document.head.innerHTML = `
            <title>Post title</title>
            <meta property="article:published_time" content="2022-02-09T00:30:00+01:00">
            <meta property="article:modified_time" content="2022-02-10T23:30:00-05:00">`;
        document.body.innerHTML = `<article><p>${PARAGRAPH.repeat(5)}</p></article>`;
        expect(readPage("article")?.labels).toEqual({ publishedDate: "2022-02-09", modifiedDate: "2022-02-10" });

        document.head.innerHTML = "<title>Post title</title>";
        document.body.innerHTML = `<article><p>${PARAGRAPH.repeat(5)}</p>
            <p>Published <time>February 8, 2022</time></p></article>`;
        expect(readPage("article")?.labels).toEqual({});
    });

    it("keeps an article that is only a picture, and the whole page of a page without one", () => {
        document.body.innerHTML = `<article><img src="photo.jpg" width="800" height="600"></article>`;
        expect(readPage("article")?.images.map(({ src }) => src)).toEqual([ "https://example.com/blog/photo.jpg" ]);

        document.body.innerHTML = "<nav><a href=\"/\">Home</a> <a href=\"/archive\">Archive</a></nav>";
        expect(readPage("article")).toBeUndefined();
        expect(readPage("wholePage")?.content).toContain("href=\"https://example.com/archive\"");

        document.body.innerHTML = "<div> </div>";
        expect(readPage("article")).toBeUndefined();
        expect(readPage("wholePage")).toBeUndefined();
    });

    it("keeps every card of a card grid in the whole page, without hidden elements", () => {
        document.head.innerHTML = `<title>Image formats</title><meta name="description" content="Test page">`;
        // The page of issue #9611, with enough text that Defuddle does not read it as an index page.
        const cards = [ "png", "jpg", "webp", "gif" ].map((format) => `
            <div class="card"><h2>${format.toUpperCase()} image test</h2>
                <img src="images/sample.${format}" alt="${format.toUpperCase()} Test" />
                <strong>Format:</strong> ${format.toUpperCase()} <code>.${format}</code></div>`);
        document.body.innerHTML = `
            <h1>Image formats</h1>
            <div class="desc">
                <p>This page tests how the web clipper saves each image format.</p>
                <p>${PARAGRAPH}</p>
                <p>Test method:</p>
                <ol><li>Open this page</li><li>Save the page with the web clipper</li>
                    <li>Check that Trilium saved every image</li></ol>
            </div>
            <div class="grid">${cards.join("")}</div>
            <div class="footer"><h3>What to check</h3>
                <ul><li>Whether every image is saved as an attachment</li>
                    <li>Whether the GIF stays animated</li></ul></div>
            <div style="display: none">Cookie banner</div>
            <script>window.tracked = true;</script>`;

        const article = readPage("article");
        const wholePage = readPage("wholePage");

        expect(article?.images.length).toBeLessThan(4);
        expect(article?.content).not.toContain("What to check");
        expect(wholePage).toMatchObject({
            title: "Image formats",
            pageUrl: "https://example.com/blog/post.html?id=1",
            clipType: "page",
            labels: { pageDescription: "Test page" }
        });
        expect(wholePage?.images.map(({ src }) => src)).toEqual([ "png", "jpg", "webp", "gif" ]
            .map((format) => `https://example.com/blog/images/sample.${format}`));
        expect(wholePage?.content).toContain("This page tests how the web clipper saves each image format.");
        expect(wholePage?.content).toContain("What to check");
        expect(wholePage?.content).not.toContain("Cookie banner");
        expect(wholePage?.content).not.toContain("window.tracked");
    });
});

function readPage(variant: PageVariant) {
    readablePage.main();
    return globalThis.triliumReadPage(variant);
}
