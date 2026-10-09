/**
 * The values `page.ejs` prints, worked out from the note before the template runs. Custom
 * `~shareTemplate` templates receive them too.
 */

/** The parts of a note the page model reads; core's `SNote` and `BNote` both provide them. */
export interface ShareNote {
    noteId: string;
    shareId: string;
    title: string;
    getLabelValue(name: string): string | null | undefined;
    hasLabel(name: string): boolean;
    getRelationValue(name: string): string | null | undefined;
    hasRelation(name: string): boolean;
    getRelations(name: string): { targetNote?: ShareNote | null }[];
    getContent(): string | Uint8Array | null | undefined;
}

/** What goes into the `<head>` of a shared page, besides the stylesheets and scripts. */
export interface PageHead {
    /** The note's title, followed by the site's unless the note is the site's root. */
    title: string;
    description: string | null | undefined;
    /** Whether search engines are asked not to index the page (`#shareDisallowRobotIndexing`). */
    noIndex: boolean;
    openGraph: {
        url: string | null | undefined;
        domain: string | null | undefined;
        image: string | null | undefined;
        color: string | null | undefined;
    };
}

/** The site logo in the page header. */
export interface SiteLogo {
    /** `#shareRootLink` when set, otherwise the site's root page. */
    href: string;
    width: number;
    height: number;
}

/** A heading of the page's content, as core's `anchorHeadings()` finds it. */
export interface PageHeading {
    /** 1 for `<h1>`, up to 6 for `<h6>`. */
    level: number;
    /** The heading's plain text. */
    text: string;
    /** The ID of the heading's anchor, unique on the page. */
    slug: string;
}

/** An entry of the table of contents, with the headings it contains. */
export interface TableOfContentsEntry extends PageHeading {
    children: TableOfContentsEntry[];
}

/** Where an HTML snippet can go, as `#shareHtmlLocation` names it. */
export type HtmlSnippetLocation =
    `${"head" | "body" | "content"}:${"start" | "end"}`;

/**
 * Returns the `<head>` values of the page of `note`, whose site starts at `siteRoot`. The
 * OpenGraph values come from the site root, so that every page of a site shares them.
 */
export function getPageHead(note: ShareNote, siteRoot: ShareNote): PageHead {
    const title = note.noteId === siteRoot.noteId
        ? note.title
        : `${note.title} - ${siteRoot.title}`;
    const image = siteRoot.hasRelation("shareOpenGraphImage")
        ? `api/images/${siteRoot.getRelationValue("shareOpenGraphImage")}/image.png`
        : siteRoot.getLabelValue("shareOpenGraphImage");

    return {
        title,
        description: note.getLabelValue("shareDescription"),
        noIndex: note.hasLabel("shareDisallowRobotIndexing"),
        openGraph: {
            url: siteRoot.getLabelValue("shareOpenGraphURL"),
            domain: siteRoot.getLabelValue("shareOpenGraphDomain"),
            image,
            color: siteRoot.getLabelValue("shareOpenGraphColor")
        }
    };
}

/**
 * Returns the HTML of the `~shareHtml` snippets of `note`, joined per location. A snippet goes to
 * `#shareHtmlLocation`, `content:end` without one, and to the end of a location named without a
 * position. Every location is present, empty when no snippet goes there.
 */
export function getHtmlSnippets(note: ShareNote): Record<HtmlSnippetLocation, string> {
    const snippets: Record<string, string[]> = {
        "head:start": [],
        "head:end": [],
        "body:start": [],
        "body:end": [],
        "content:start": [],
        "content:end": []
    };

    for (const { targetNote } of note.getRelations("shareHtml")) {
        if (!targetNote) {
            continue;
        }

        let location = targetNote.getLabelValue("shareHtmlLocation") || "content:end";
        if (!location.includes(":")) {
            location = `${location}:end`;
        }
        const content = targetNote.getContent();
        (snippets[location] ??= []).push(typeof content === "string" ? content : "");
    }

    return Object.fromEntries(Object.entries(snippets)
        .map(([ location, contents ]) => [ location, contents.join("\n") ])
    ) as Record<HtmlSnippetLocation, string>;
}

/** The width the header draws the site logo at, in pixels. */
const LOGO_WIDTH = 32;

/**
 * Returns the site logo of the site starting at `siteRoot`. `#shareLogoWidth` and
 * `#shareLogoHeight` give the logo's proportions; a label that is not a positive number falls back
 * to the default logo's. `sanitizeUrl` makes `#shareRootLink` safe to use as a link.
 */
export function getSiteLogo(siteRoot: ShareNote, sanitizeUrl: (url: string) => string): SiteLogo {
    const width = readPositiveNumber(siteRoot.getLabelValue("shareLogoWidth")) ?? 53;
    const height = readPositiveNumber(siteRoot.getLabelValue("shareLogoHeight")) ?? 40;
    const rootLink = siteRoot.getLabelValue("shareRootLink");

    return {
        href: rootLink ? sanitizeUrl(rootLink) : `./${siteRoot.shareId}`,
        width: LOGO_WIDTH,
        height: Math.round(LOGO_WIDTH * height / width)
    };
}

function readPositiveNumber(value: string | null | undefined) {
    const number = Number(value);
    return value && number > 0 ? number : undefined;
}

/**
 * Returns the table of contents of a page with `headings`. Each heading goes under the closest
 * heading before it of a higher level, such as an `<h3>` under the `<h2>` before it, and at the top
 * when there is none.
 */
export function getTableOfContents(headings: PageHeading[]): TableOfContentsEntry[] {
    const toc: TableOfContentsEntry[] = [];
    const open: TableOfContentsEntry[] = [];

    for (const heading of headings) {
        const entry = { ...heading, children: [] };
        while (open.length && open[open.length - 1].level >= heading.level) {
            open.pop();
        }
        (open.at(-1)?.children ?? toc).push(entry);
        open.push(entry);
    }
    return toc;
}
