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
    getParentNotes(): ShareNote[];
    getVisibleChildNotes(): ShareNote[];
    type: string;
    /** The icon's CSS classes, among the icon packs whose prefixes are given. */
    getIcon(iconPackPrefixes?: string[]): string;
}

/** Where a link to a note goes: its page, or the address of its external link. */
export interface ShareLink {
    href: string;
    /** Whether the link goes to `#shareExternalLink` or `#shareExternal`. */
    isExternal: boolean;
}

/** An entry of the navigation tree, with the entries below it. */
export interface NavigationItem extends ShareLink {
    title: string;
    type: string;
    icon: string;
    /** Whether the entry is the page being shown. */
    isActive: boolean;
    /** Whether the entry is the page being shown or one of its ancestors. */
    isExpanded: boolean;
    children: NavigationItem[];
}

/** A link to another page of the site. */
export interface PageLink {
    title: string;
    href: string;
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

/**
 * Returns where a link to `note` goes: the first of `#shareExternalLink` and `#shareExternal` that
 * is not blank, made safe by `sanitizeUrl`, otherwise the note's page.
 */
export function getShareLink(note: ShareNote, sanitizeUrl: (url: string) => string): ShareLink {
    const externalLink = note.getLabelValue("shareExternalLink")?.trim()
        || note.getLabelValue("shareExternal")?.trim();
    return externalLink
        ? { href: sanitizeUrl(externalLink), isExternal: true }
        : { href: `./${note.shareId}`, isExternal: false };
}

/** Returns the links to the visible children of `note`, for its list of subpages. */
export function getChildLinks(note: ShareNote, sanitizeUrl: (url: string) => string) {
    return note.getVisibleChildNotes().map((child) => ({
        ...getShareLink(child, sanitizeUrl),
        title: child.title,
        type: child.type
    }));
}

/** What {@link getNavigationTree} needs besides the notes. */
export interface NavigationTreeOptions {
    sanitizeUrl: (url: string) => string;
    /** The prefixes of the icon packs available to the page, for the notes' icons. */
    iconPackPrefixes?: string[];
}

/**
 * Returns the navigation tree of the site starting at `siteRoot`: its visible pages, below one
 * another as in the note tree. The entries of `activeNote` and of the notes in `ancestorIds` are
 * expanded.
 */
export function getNavigationTree(
    siteRoot: ShareNote, activeNote: ShareNote, ancestorIds: string[], options: NavigationTreeOptions
): NavigationItem[] {
    const expandedIds = new Set([ activeNote.noteId, ...ancestorIds ]);
    const toItem = (note: ShareNote): NavigationItem => ({
        ...getShareLink(note, options.sanitizeUrl),
        title: note.title,
        type: note.type,
        icon: note.getIcon(options.iconPackPrefixes),
        isActive: note.noteId === activeNote.noteId,
        isExpanded: expandedIds.has(note.noteId),
        children: note.getVisibleChildNotes().map(toItem)
    });
    return siteRoot.getVisibleChildNotes().map(toItem);
}

/**
 * Returns the IDs of the notes between `note` and `siteRoot`, from its parent up, following the
 * first parent inside the site.
 */
export function getSiteAncestorIds(note: ShareNote, siteRoot: ShareNote) {
    const ancestorIds: string[] = [];
    for (let position = getSitePosition(note, siteRoot);
        position && position.parent.noteId !== siteRoot.noteId;
        position = getSitePosition(position.parent, siteRoot)) {
        ancestorIds.push(position.parent.noteId);
    }
    return ancestorIds;
}

/**
 * Returns the pages before and after `note` when the site starting at `siteRoot` is read in tree
 * order: a page, then its children, then its next sibling. A note in several places follows the
 * first parent inside the site. A note hidden from the tree has neither link.
 */
export function getPrevNextLinks(note: ShareNote, siteRoot: ShareNote) {
    const previous = getPreviousPage(note, siteRoot);
    const next = getNextPage(note, siteRoot);
    return {
        previous: previous && toPageLink(previous),
        next: next && toPageLink(next)
    };
}

function getPreviousPage(note: ShareNote, siteRoot: ShareNote) {
    const position = getSitePosition(note, siteRoot);
    if (!position) {
        return null;
    }
    if (position.index === 0) {
        return position.parent;
    }

    let previous = position.siblings[position.index - 1];
    for (let children = previous.getVisibleChildNotes(); children.length;
        children = previous.getVisibleChildNotes()) {
        previous = children[children.length - 1];
    }
    return previous;
}

function getNextPage(note: ShareNote, siteRoot: ShareNote) {
    const notePosition = getSitePosition(note, siteRoot);
    if (!notePosition && note.noteId !== siteRoot.noteId) {
        return null;
    }
    const firstChild = note.getVisibleChildNotes()[0];
    if (firstChild) {
        return firstChild;
    }

    for (let position = notePosition; position;
        position = getSitePosition(position.parent, siteRoot)) {
        const nextSibling = position.siblings[position.index + 1];
        if (nextSibling) {
            return nextSibling;
        }
    }
    return null;
}

/**
 * Returns where `note` stands among the visible children of its first parent inside the site, or
 * `null` for the site root and for a note outside the site or hidden from the tree.
 */
function getSitePosition(note: ShareNote, siteRoot: ShareNote) {
    if (note.noteId === siteRoot.noteId) {
        return null;
    }

    const parent = note.getParentNotes().find((candidate) => isInSite(candidate, siteRoot));
    const siblings = parent?.getVisibleChildNotes() ?? [];
    const index = siblings.findIndex((sibling) => sibling.noteId === note.noteId);
    return parent && index !== -1 ? { parent, siblings, index } : null;
}

function isInSite(note: ShareNote, siteRoot: ShareNote): boolean {
    return note.noteId === siteRoot.noteId
        || note.getParentNotes().some((parent) => isInSite(parent, siteRoot));
}

function toPageLink(note: ShareNote): PageLink {
    return { title: note.title, href: `./${note.shareId}` };
}
