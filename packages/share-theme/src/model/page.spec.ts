import { describe, expect, it } from "vitest";

import {
    getHtmlSnippets, getPageHead, getSiteLogo, getTableOfContents, type PageHeading, type ShareNote
} from "./page.js";

describe("getPageHead", () => {
    it("titles a page after the note and its site, and reads the site's OpenGraph labels", () => {
        const site = fakeNote({
            noteId: "site",
            title: "My site",
            labels: {
                shareOpenGraphColor: "#123456",
                shareOpenGraphURL: "https://example.com",
                shareOpenGraphDomain: "example.com",
                shareOpenGraphImage: "https://example.com/cover.png"
            }
        });
        const page = fakeNote({
            noteId: "page",
            title: "Page",
            labels: { shareDescription: "About the page", shareDisallowRobotIndexing: "" }
        });

        expect(getPageHead(page, site)).toStrictEqual({
            title: "Page - My site",
            description: "About the page",
            noIndex: true,
            openGraph: {
                url: "https://example.com",
                domain: "example.com",
                image: "https://example.com/cover.png",
                color: "#123456"
            }
        });
    });

    it("titles the site's own page after it alone and prefers an image relation to the label", () => {
        const site = fakeNote({
            noteId: "site",
            title: "My site",
            labels: { shareOpenGraphImage: "https://example.com/cover.png" },
            relations: { shareOpenGraphImage: "imageNote" }
        });

        expect(getPageHead(site, site)).toStrictEqual({
            title: "My site",
            description: null,
            noIndex: false,
            openGraph: {
                url: null,
                domain: null,
                image: "api/images/imageNote/image.png",
                color: null
            }
        });
    });
});

describe("getHtmlSnippets", () => {
    it("joins the snippets of each location, at the end of the content by default", () => {
        const page = fakeNote({
            noteId: "page",
            snippets: [
                fakeNote({ noteId: "a", content: "<meta a>", labels: { shareHtmlLocation: "head" } }),
                fakeNote({ noteId: "b", content: "<p>b</p>" }),
                fakeNote({ noteId: "c", content: "<meta c>", labels: { shareHtmlLocation: "head:end" } }),
                fakeNote({ noteId: "d", content: "<p>d</p>", labels: { shareHtmlLocation: "body:start" } }),
                null
            ]
        });

        expect(getHtmlSnippets(page)).toStrictEqual({
            "head:start": "",
            "head:end": "<meta a>\n<meta c>",
            "body:start": "<p>d</p>",
            "body:end": "",
            "content:start": "",
            "content:end": "<p>b</p>"
        });
    });

    it("leaves every location empty without snippets", () => {
        expect(Object.values(getHtmlSnippets(fakeNote({ noteId: "page" }))).join("")).toBe("");
    });
});

describe("getSiteLogo", () => {
    const sanitizeUrl = (url: string) => (url.startsWith("javascript:") ? "about:blank" : url);

    it("draws the logo 32 pixels wide, in the proportions of its labels", () => {
        const logo = (labels: Record<string, string>) =>
            getSiteLogo(fakeNote({ noteId: "site", labels }), sanitizeUrl);

        expect(logo({})).toStrictEqual({ href: "./site-alias", width: 32, height: 24 });
        expect(logo({ shareLogoWidth: "100", shareLogoHeight: "50" }).height).toBe(16);
        expect(logo({ shareLogoWidth: "auto", shareLogoHeight: "" }).height).toBe(24);
        expect(logo({ shareLogoWidth: "0", shareLogoHeight: "-5" }).height).toBe(24);
    });

    it("links to #shareRootLink, made safe", () => {
        const logo = (shareRootLink: string) => getSiteLogo(
            fakeNote({ noteId: "site", labels: { shareRootLink } }), sanitizeUrl);

        expect(logo("https://example.com").href).toBe("https://example.com");
        expect(logo("javascript:alert(1)").href).toBe("about:blank");
    });
});

describe("getTableOfContents", () => {
    const heading = (level: number, slug: string): PageHeading => ({ level, text: slug.toUpperCase(), slug });
    const outline = (entries: ReturnType<typeof getTableOfContents>): unknown[] =>
        entries.map((entry) => (entry.children.length
            ? [ entry.slug, outline(entry.children) ]
            : entry.slug));

    it("nests each heading under the closest heading of a higher level before it", () => {
        const toc = getTableOfContents([
            heading(2, "a"), heading(3, "a1"), heading(4, "a1x"), heading(3, "a2"),
            heading(2, "b"), heading(4, "b1"), heading(3, "b2")
        ]);

        expect(outline(toc)).toStrictEqual([
            [ "a", [ [ "a1", [ "a1x" ] ], "a2" ] ],
            [ "b", [ "b1", "b2" ] ]
        ]);
        expect(toc[0]).toMatchObject({ level: 2, text: "A", slug: "a" });
    });

    it("keeps a heading of a higher level than the first one at the top", () => {
        expect(outline(getTableOfContents([ heading(3, "x"), heading(2, "y"), heading(3, "z") ])))
            .toStrictEqual([ "x", [ "y", [ "z" ] ] ]);
        expect(getTableOfContents([])).toStrictEqual([]);
    });
});

interface FakeNoteOptions {
    noteId: string;
    title?: string;
    labels?: Record<string, string>;
    relations?: Record<string, string>;
    snippets?: (ShareNote | null)[];
    content?: string;
}

function fakeNote(options: FakeNoteOptions): ShareNote {
    const labels = options.labels ?? {};
    const relations = options.relations ?? {};
    return {
        noteId: options.noteId,
        shareId: `${options.noteId}-alias`,
        title: options.title ?? options.noteId,
        getLabelValue: (name) => labels[name] ?? null,
        hasLabel: (name) => name in labels,
        getRelationValue: (name) => relations[name] ?? null,
        hasRelation: (name) => name in relations,
        getRelations: (name) => (name === "shareHtml" ? options.snippets ?? [] : [])
            .map((targetNote) => ({ targetNote })),
        getContent: () => options.content ?? ""
    };
}
