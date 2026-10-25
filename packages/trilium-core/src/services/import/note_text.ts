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

        content = content.replace(/<html.*<body[^>]*>/gis, "");
        content = content.replace(/<\/body>.*<\/html>/gis, "");
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
    content = content.replace(/<div class="ck-content">(.*)<\/div>/gms, "$1");
    content = content.replace(/<div class="content">(.*)<\/div>/gms, "$1");

    return content;
}
