import { describe, expect, it } from "vitest";

import {
    getChildLinks, getHtmlSnippets, getNavigationTree, getPageHead, getPrevNextLinks, getShareLink, getSiteAncestorIds,
    getSiteLogo, getTableOfContents, type NavigationItem, type PageHeading, type ShareNote
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

describe("getPrevNextLinks", () => {
    // share root ─┬─ elsewhere ── a2 (clone, first parent)
    //             ├─ site ─┬─ a ─┬─ a1
    //             │        │     └─ a2
    //             │        ├─ b
    //             │        └─ hidden (hidden from the tree) ── h1
    //             └─ lonely (a site without pages)
    const shareRoot = fakeNote({ noteId: "shareRoot" });
    const [ elsewhere, site, lonely ] = [ "elsewhere", "site", "lonely" ]
        .map((noteId) => addChild(shareRoot, fakeNote({ noteId })));
    const a = addChild(site, fakeNote({ noteId: "a" }));
    const a1 = addChild(a, fakeNote({ noteId: "a1" }));
    const a2 = addChild(elsewhere, fakeNote({ noteId: "a2" }));
    addChild(a, a2);
    const b = addChild(site, fakeNote({ noteId: "b" }));
    const hidden = addChild(site, fakeNote({ noteId: "hidden" }), true);
    const h1 = addChild(hidden, fakeNote({ noteId: "h1" }));
    const links = (note: ShareNote, siteRoot = site) => {
        const { previous, next } = getPrevNextLinks(note, siteRoot);
        return [ previous?.title ?? null, next?.title ?? null ];
    };

    it("walks the site's pages in tree order, inside the site", () => {
        expect(links(site)).toStrictEqual([ null, "a" ]);
        expect(links(a)).toStrictEqual([ "site", "a1" ]);
        expect(links(a1)).toStrictEqual([ "a", "a2" ]);
        expect(links(a2)).toStrictEqual([ "a1", "b" ]);
        expect(links(b)).toStrictEqual([ "a2", null ]);
        expect(getPrevNextLinks(a, site).next).toStrictEqual({ title: "a1", href: "./a1-alias" });
    });

    it("gives no links to a note hidden from the tree, nor past a site without pages", () => {
        expect(links(hidden)).toStrictEqual([ null, null ]);
        expect(links(h1)).toStrictEqual([ "hidden", null ]);
        expect(links(lonely, lonely)).toStrictEqual([ null, null ]);
    });
});

describe("getShareLink", () => {
    const sanitizeUrl = (url: string) => (url.startsWith("javascript:") ? "about:blank" : url);
    const link = (labels: Record<string, string>) =>
        getShareLink(fakeNote({ noteId: "page", labels }), sanitizeUrl);

    it("links to the page itself without an external link", () => {
        expect(link({})).toStrictEqual({ href: "./page-alias", isExternal: false });
        expect(link({ shareExternal: "" })).toStrictEqual({ href: "./page-alias", isExternal: false });
        expect(link({ shareExternalLink: "   " }).isExternal).toBe(false);
    });

    it("links to the first non-empty external link, #shareExternalLink first, made safe", () => {
        const external = (href: string) => ({ href, isExternal: true });

        expect(link({ shareExternal: "https://example.com/legacy" }))
            .toStrictEqual(external("https://example.com/legacy"));
        expect(link({
            shareExternal: "https://example.com/legacy",
            shareExternalLink: "https://example.com/documented"
        })).toStrictEqual(external("https://example.com/documented"));
        expect(link({ shareExternal: "https://example.com/legacy", shareExternalLink: "   " }))
            .toStrictEqual(external("https://example.com/legacy"));
        expect(link({ shareExternalLink: " javascript:alert(1) " })).toStrictEqual(external("about:blank"));
    });
});

describe("getNavigationTree", () => {
    // site ─┬─ a ─┬─ a1
    //       │     └─ hidden (hidden from the tree)
    //       └─ b (external) ── b1
    const site = fakeNote({ noteId: "site" });
    const a = addChild(site, fakeNote({ noteId: "a", icon: "bx bx-folder" }));
    const a1 = addChild(a, fakeNote({ noteId: "a1", type: "code" }));
    addChild(a, fakeNote({ noteId: "hidden" }), true);
    const b = addChild(site, fakeNote({ noteId: "b", labels: { shareExternalLink: "https://example.com" } }));
    addChild(b, fakeNote({ noteId: "b1" }));
    const outline = (items: NavigationItem[]): unknown[] => items.map((item) => {
        const flags = `${item.isActive ? "*" : ""}${item.isExpanded ? "+" : ""}`;
        return item.children.length
            ? [ item.title + flags, outline(item.children) ]
            : item.title + flags;
    });

    it("lists the visible pages below the site root, expanding the active one and its ancestors", () => {
        const tree = getNavigationTree(site, a1, [ "a" ], { sanitizeUrl: (url) => url });

        expect(outline(tree)).toStrictEqual([ [ "a+", [ "a1*+" ] ], [ "b", [ "b1" ] ] ]);
        expect(tree[0]).toMatchObject({
            type: "text", icon: "bx bx-folder", href: "./a-alias", isExternal: false
        });
        expect(tree[0].children[0].type).toBe("code");
        expect(tree[1]).toMatchObject({ href: "https://example.com", isExternal: true });
    });

    it("passes the icon pack prefixes to the notes", () => {
        const tree = getNavigationTree(site, site, [], {
            sanitizeUrl: (url) => url,
            iconPackPrefixes: [ "custom" ]
        });

        expect(tree[1].icon).toBe("bx bx-note custom");
        expect(outline(tree)).toStrictEqual([ [ "a", [ "a1" ] ], [ "b", [ "b1" ] ] ]);
    });
});

describe("getChildLinks", () => {
    it("links to the visible children of a note, in order", () => {
        const parent = fakeNote({ noteId: "parent" });
        addChild(parent, fakeNote({ noteId: "x", type: "book" }));
        addChild(parent, fakeNote({ noteId: "hidden" }), true);
        addChild(parent, fakeNote({ noteId: "y", labels: { shareExternal: "https://example.com" } }));

        expect(getChildLinks(parent, (url) => url)).toStrictEqual([
            { href: "./x-alias", isExternal: false, title: "x", type: "book" },
            { href: "https://example.com", isExternal: true, title: "y", type: "text" }
        ]);
    });
});

describe("getSiteAncestorIds", () => {
    // elsewhere ── deep (clone, first parent)
    // site ── a ── b ── deep
    const elsewhere = fakeNote({ noteId: "elsewhere" });
    const site = fakeNote({ noteId: "site" });
    const a = addChild(site, fakeNote({ noteId: "a" }));
    const b = addChild(a, fakeNote({ noteId: "b" }));
    const deep = addChild(elsewhere, fakeNote({ noteId: "deep" }));
    addChild(b, deep);

    it("lists the parents up to the site root, following the first parent inside the site", () => {
        expect(getSiteAncestorIds(deep, site)).toStrictEqual([ "b", "a" ]);
        expect(getSiteAncestorIds(a, site)).toStrictEqual([]);
        expect(getSiteAncestorIds(site, site)).toStrictEqual([]);
    });
});

interface FakeNoteOptions {
    noteId: string;
    title?: string;
    labels?: Record<string, string>;
    relations?: Record<string, string>;
    snippets?: (ShareNote | null)[];
    content?: string;
    type?: string;
    icon?: string;
}

function fakeNote(options: FakeNoteOptions): FakeNote {
    const labels = options.labels ?? {};
    const relations = options.relations ?? {};
    const parents: ShareNote[] = [];
    const children: { note: ShareNote; hidden: boolean }[] = [];
    return {
        parents,
        children,
        getParentNotes: () => parents,
        getVisibleChildNotes: () => children.filter((child) => !child.hidden).map((child) => child.note),
        noteId: options.noteId,
        shareId: `${options.noteId}-alias`,
        title: options.title ?? options.noteId,
        type: options.type ?? "text",
        getIcon: (prefixes) => [ options.icon ?? "bx bx-note", ...prefixes ?? [] ].join(" "),
        getLabelValue: (name) => labels[name] ?? null,
        hasLabel: (name) => name in labels,
        getRelationValue: (name) => relations[name] ?? null,
        hasRelation: (name) => name in relations,
        getRelations: (name) => (name === "shareHtml" ? options.snippets ?? [] : [])
            .map((targetNote) => ({ targetNote })),
        getContent: () => options.content ?? ""
    };
}

interface FakeNote extends ShareNote {
    parents: ShareNote[];
    children: { note: ShareNote; hidden: boolean }[];
}

function addChild(parent: FakeNote, child: FakeNote, hidden = false) {
    parent.children.push({ note: child, hidden });
    child.parents.push(parent);
    return child;
}
