/**
 * The values `page.ejs` prints, worked out from the note before the template runs. Custom
 * `~shareTemplate` templates receive them too.
 */

/** The parts of a note the page model reads; core's `SNote` and `BNote` both provide them. */
export interface ShareNote {
    noteId: string;
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
