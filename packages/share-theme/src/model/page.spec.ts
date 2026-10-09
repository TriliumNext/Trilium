import { describe, expect, it } from "vitest";

import { getHtmlSnippets, getPageHead, getSiteLogo, type ShareNote } from "./page.js";

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
