/**
 * The values `page.ejs` prints, worked out from the note before the template runs. Custom
 * `~shareTemplate` templates receive them too.
 */

import {
    isRightToLeftLanguage, resolveContentLanguage, toLanguageTag
} from "@triliumnext/commons/src/lib/i18n.js";
import { isFullWidthNoteType } from "@triliumnext/commons/src/lib/notes.js";

/** The parts of a note the page model reads; core's `SNote` and `BNote` both provide them. */
export interface ShareNote {
    noteId: string;
    shareId: string;
    title: string;
    /** When the note was last changed, as Trilium stores it (`2026-10-09 12:00:00.000Z`). */
    utcDateModified?: string;
    getLabelValue(name: string): string | null | undefined;
    hasLabel(name: string): boolean;
    /** Whether the label is set to anything but `false`. */
    isLabelTruthy(name: string): boolean;
    getRelationValue(name: string): string | null | undefined;
    hasRelation(name: string): boolean;
    getRelations(name: string): { targetNote?: ShareNote | null }[];
    getContent(): string | Uint8Array | null | undefined;
    getParentNotes(): ShareNote[];
    getVisibleChildNotes(): ShareNote[];
    type: string;
    mime: string;
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
    /** `#shareDescription`; this and the other values are `null` when their label is blank. */
    description: string | null;
    /** Whether search engines are asked not to index the page (`#shareDisallowRobotIndexing`). */
    noIndex: boolean;
    openGraph: {
        url: string | null;
        domain: string | null;
        /** Absolute when `url` is set and is a valid address, relative to the page otherwise. */
        image: string | null;
        color: string | null;
        /** The kind of Twitter card: a large picture when there is an image. */
        card: "summary_large_image" | "summary";
    };
    /** The description, OpenGraph and Twitter `<meta>` tags of the values that are set. */
    metaTags: MetaTag[];
}

/** A `<meta>` tag, such as `<meta property="og:title" content="…">`. */
export interface MetaTag {
    attribute: "name" | "property";
    key: string;
    content: string;
}

/** The site logo in the page header. */
export interface SiteLogo {
    /** `#shareRootLink` when set, otherwise the site's root page. */
    href: string;
    /** The `~shareLogo` image, or `null` to show {@link SiteLogo.icon} instead. */
    image: string | null;
    /** The icon classes of the site root's note icon. */
    icon: string;
    /** The size to draw {@link SiteLogo.image} at. */
    width: number;
    height: number;
}

/** What {@link getSiteLogo} needs besides the site root. */
export interface SiteLogoOptions {
    /** Makes `#shareRootLink` safe to use as a link. */
    sanitizeUrl: (url: string) => string;
    /** The URL of the `~shareLogo` image, if any. */
    image: string | null;
    iconPackPrefixes?: string[];
}

/** A heading of the page's content, as core's `preparePageContent()` finds it. */
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
 * OpenGraph values come from the site root, so that every page of a site shares them. Sites that
 * show a link preview load the image from their own servers, so a relative image address is made
 * absolute against `#shareOpenGraphURL`, the only public address of the site Trilium knows.
 */
export function getPageHead(note: ShareNote, siteRoot: ShareNote): PageHead {
    const title = note.noteId === siteRoot.noteId
        ? note.title
        : `${note.title} - ${siteRoot.title}`;
    const url = readLabel(siteRoot, "shareOpenGraphURL");
    const image = siteRoot.hasRelation("shareOpenGraphImage")
        ? `api/images/${siteRoot.getRelationValue("shareOpenGraphImage")}/image.png`
        : readLabel(siteRoot, "shareOpenGraphImage");

    const description = readLabel(note, "shareDescription");
    const openGraph: PageHead["openGraph"] = {
        url,
        domain: readLabel(siteRoot, "shareOpenGraphDomain"),
        image: image && url ? toAbsoluteUrl(image, url) : image,
        color: readLabel(siteRoot, "shareOpenGraphColor"),
        card: image ? "summary_large_image" : "summary"
    };

    return {
        title,
        description,
        noIndex: note.hasLabel("shareDisallowRobotIndexing"),
        openGraph,
        metaTags: getMetaTags(title, description, openGraph)
    };
}

function getMetaTags(title: string, description: string | null, openGraph: PageHead["openGraph"]) {
    const tags: [ MetaTag["attribute"], string, string | null ][] = [
        [ "name", "description", description ],
        [ "property", "og:type", "website" ],
        [ "property", "og:title", title ],
        [ "property", "og:description", description ],
        [ "property", "og:url", openGraph.url ],
        [ "property", "og:image", openGraph.image ],
        [ "name", "twitter:card", openGraph.card ],
        [ "name", "twitter:title", title ],
        [ "name", "twitter:description", description ],
        [ "property", "twitter:domain", openGraph.domain ],
        [ "property", "twitter:url", openGraph.url ],
        [ "name", "twitter:image", openGraph.image ],
        [ "name", "theme-color", openGraph.color ]
    ];
    return tags.flatMap(([ attribute, key, content ]): MetaTag[] =>
        (content ? [ { attribute, key, content } ] : []));
}

/** A language and its writing direction, for the `lang` and `dir` attributes of an element. */
export interface PageLanguage {
    lang: string;
    dir: "ltr" | "rtl";
}

/** The languages Trilium is set to, as the `locale` and `defaultContentLanguage` options give them. */
export interface LanguageSettings {
    displayLanguage: string;
    defaultContentLanguage?: string | null;
}

/**
 * Returns the language of the page, which is the display language its own texts are translated
 * to, and the language of the note's content when it is another: the note's `#language`,
 * otherwise the default content language.
 */
export function getPageLanguages(note: ShareNote, settings: LanguageSettings) {
    const page = toPageLanguage(settings.displayLanguage);
    const content = toPageLanguage(resolveContentLanguage(note.getLabelValue("language"),
        settings.defaultContentLanguage, settings.displayLanguage) ?? settings.displayLanguage);
    return {
        page,
        content: content.lang === page.lang && content.dir === page.dir ? null : content
    };
}

function toPageLanguage(localeId: string): PageLanguage {
    return { lang: toLanguageTag(localeId), dir: isRightToLeftLanguage(localeId) ? "rtl" : "ltr" };
}

/**
 * Returns when `note` was last changed, as an ISO date for a `<time>` element and as a date
 * written out in the display language, or `null` when the note has no valid date.
 */
export function getLastUpdated(note: ShareNote, displayLanguage: string) {
    const date = new Date(note.utcDateModified ?? Number.NaN);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return {
        iso: date.toISOString(),
        text: new Intl.DateTimeFormat(toLanguageTag(displayLanguage), { dateStyle: "long" }).format(date)
    };
}

/** Returns the trimmed value of the label, or `null` when it is missing or blank. */
function readLabel(note: ShareNote, name: string) {
    return note.getLabelValue(name)?.trim() || null;
}

/** Resolves `address` against `base` unless it is already absolute or `base` is not a URL. */
function toAbsoluteUrl(address: string, base: string) {
    if (URL.canParse(address) || !URL.canParse(base)) {
        return address;
    }
    return new URL(address, base).href;
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
 * Returns the site logo of the site starting at `siteRoot`: the `~shareLogo` image when there is
 * one, otherwise the site root's note icon. `#shareLogoWidth` and `#shareLogoHeight` give the
 * image's proportions; a label that is not a positive number falls back to 53 by 40.
 */
export function getSiteLogo(siteRoot: ShareNote, options: SiteLogoOptions): SiteLogo {
    const width = readPositiveNumber(siteRoot.getLabelValue("shareLogoWidth")) ?? 53;
    const height = readPositiveNumber(siteRoot.getLabelValue("shareLogoHeight")) ?? 40;
    const rootLink = siteRoot.getLabelValue("shareRootLink");

    return {
        href: rootLink ? options.sanitizeUrl(rootLink) : `./${siteRoot.shareId}`,
        image: options.image,
        icon: siteRoot.getIcon(options.iconPackPrefixes),
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

/**
 * Returns the classes of the content element: the note's type, `ck-content` for content the text
 * editor's styles apply to (text notes and Markdown code notes), `full-content-width` for a note
 * with `#fullContentWidth` or of a type the app always shows at full width, and `no-content` when
 * empty. A Markdown note reads as text, so its type does not make it full width.
 */
export function getContentClasses(note: ShareNote, isEmpty = false) {
    const isEditorContent = note.type === "text"
        || (note.type === "code" && note.mime === "text/x-markdown");
    const isFullWidth = (!isEditorContent && isFullWidthNoteType(note.type, note.mime))
        || note.isLabelTruthy("fullContentWidth");
    return [
        `type-${note.type}`,
        isEditorContent && "ck-content",
        isFullWidth && "full-content-width",
        isEmpty && "no-content"
    ].filter(Boolean).join(" ");
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

    const answers = new Map<string, boolean>();
    const parent = note.getParentNotes().find((candidate) => isInSite(candidate, siteRoot, answers));
    const siblings = parent?.getVisibleChildNotes() ?? [];
    const index = siblings.findIndex((sibling) => sibling.noteId === note.noteId);
    return parent && index !== -1 ? { parent, siblings, index } : null;
}

/**
 * Whether `note` is `siteRoot` or below it. `answers` keeps the answer for each note checked, so
 * that clones reached by many paths are checked once.
 */
function isInSite(note: ShareNote, siteRoot: ShareNote, answers: Map<string, boolean>): boolean {
    let answer = answers.get(note.noteId);
    if (answer === undefined) {
        answer = note.noteId === siteRoot.noteId
            || note.getParentNotes().some((parent) => isInSite(parent, siteRoot, answers));
        answers.set(note.noteId, answer);
    }
    return answer;
}

function toPageLink(note: ShareNote): PageLink {
    return { title: note.title, href: `./${note.shareId}` };
}
