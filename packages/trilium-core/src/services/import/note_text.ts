import type { ContentJobEnv } from "../content_jobs/env.js";
import { sanitizeHtml } from "../sanitizer.js";
import { extractFrontmatter, type FrontmatterAttribute } from "./frontmatter.js";
import markdownService from "./markdown.js";

/** One text entry of a ZIP import, with every decision that needs becca or the archive already made. */
export interface PrepareNoteTextInput {
    content: string;
    /** The resolved note title, compared against an `<h1>` to drop or demote it. */
    title: string;
    /** Lifts a leading YAML front matter block into labels before anything else. */
    extractFrontmatter: boolean;
    /** Renders the content from Markdown to HTML. */
    renderMarkdown: boolean;
    /** Runs the HTML steps for a `text` or `book` note. */
    isTextLike: boolean;
    safeImport: boolean;
}

export interface PreparedNoteText {
    content: string;
    frontmatterAttributes: FrontmatterAttribute[];
}

/**
 * The part of importing a text entry that depends only on the entry itself: front matter, Markdown
 * rendering, removing the export's own wrapper and title, and sanitizing on a safe import. What
 * follows (rewriting relative links onto the imported notes) needs the IDs of the import and runs on
 * the thread that owns becca.
 */
export function prepareNoteText(input: PrepareNoteTextInput, env?: ContentJobEnv): PreparedNoteText {
    let { content } = input;
    let frontmatterAttributes: FrontmatterAttribute[] = [];

    if (input.extractFrontmatter) {
        const parsed = extractFrontmatter(content);
        content = parsed.body;
        frontmatterAttributes = parsed.attributes;
    }

    if (input.renderMarkdown) {
        content = markdownService.renderToHtml(content, input.title, {
            taskStates: env?.taskStates,
            allowedTags: env?.allowedHtmlTags
        });
    }

    if (input.isTextLike) {
        content = removeTriliumTags(content);

        content = content.replace(/<h1>([^<]*)<\/h1>/gi, (match, text) => {
            if (input.title.trim() === text.trim()) {
                return ""; // remove whole H1 tag
            }
            return `<h2>${text}</h2>`;
        });

        if (input.safeImport) {
            content = sanitizeHtml(content, env?.allowedHtmlTags);
        }

        content = removeDocumentHead(content);
        content = unwrap(content, /<\/body>/gi, /<\/html>/gi, false);
    }

    return { content, frontmatterAttributes };
}

export function removeTriliumTags(content: string) {
    const tagsToRemove = [
        "<h1 data-trilium-h1>([^<]*)<\/h1>",
        "<title data-trilium-title>([^<]*)<\/title>"
    ];
    for (const tag of tagsToRemove) {
        const re = new RegExp(tag, "gi");
        content = content.replace(re, "");
    }

    // Remove ckeditor tags
    content = unwrap(content, /<div class="ck-content">/g, /<\/div>/g, true);
    content = unwrap(content, /<div class="content">/g, /<\/div>/g, true);

    return content;
}

/**
 * Removes the span from the first match of `open` to the last match of `close` after it, keeping
 * what lies between when `keepInner` is set. This is what a greedy `open(.*)close` regex replaces,
 * found in linear time: the regex backtracks over the rest of the input from every `open` that has
 * no `close` after it. Both patterns must have the `g` flag.
 */
function unwrap(content: string, open: RegExp, close: RegExp, keepInner: boolean) {
    open.lastIndex = 0;
    const opening = open.exec(content);
    if (!opening) {
        return content;
    }

    const innerStart = opening.index + opening[0].length;
    const closing = lastMatch(content, close, innerStart, content.length);
    if (!closing) {
        return content;
    }

    const inner = keepInner ? content.slice(innerStart, closing.index) : "";
    const after = content.slice(closing.index + closing[0].length);
    return content.slice(0, opening.index) + inner + after;
}

/** Removes what `/<html.*<body[^>]*>/is` matches, in linear time. */
function removeDocumentHead(content: string) {
    const opening = /<html/i.exec(content);
    if (!opening) {
        return content;
    }

    // `[^>]*>` matches after a `<body` only when some `>` follows it, so take the last `<body`
    // before the last `>`.
    const lastGt = content.lastIndexOf(">");
    const body = lastMatch(content, /<body/gi, opening.index + opening[0].length, lastGt);
    if (!body) {
        return content;
    }

    const end = content.indexOf(">", body.index + body[0].length) + 1;
    return content.slice(0, opening.index) + content.slice(end);
}

/** The last match of the global `pattern` that starts at or after `from` and ends by `until`. */
function lastMatch(content: string, pattern: RegExp, from: number, until: number) {
    let last: RegExpExecArray | null = null;
    pattern.lastIndex = from;
    for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
        if (match.index + match[0].length > until) {
            break;
        }
        last = match;
    }
    return last;
}
