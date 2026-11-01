import debounce from "../../../services/debounce.js";
import froca from "../../../services/froca.js";
import type LoadResults from "../../../services/load_results.js";
import search from "../../../services/search.js";
import type { SnippetDefinition } from "@triliumnext/ckeditor5";
import type FNote from "../../../entities/fnote.js";

interface TemplateData {
    title: string;
    description?: string;
    content?: string;
}

let templateCache: Map<string, TemplateData> = new Map();
const debouncedHandleContentUpdate = debounce(handleContentUpdate, 1000);

/**
 * Generates the list of snippets based on the user's notes to be passed down to the CKEditor configuration.
 *
 * @returns the list of templates.
 */
export default async function getTemplates() {
    try {
        // Text snippets carry the legacy `#textSnippet` label; the unified `#snippet` notes also
        // cover Markdown/Code. Restrict to text notes so only HTML/rich-text snippets reach the
        // CKEditor list. The type filter is applied client-side rather than in the query: a query
        // starting with "(" trips the search lexer (the leading paren is dropped, see lex.ts), which
        // corrupts the parse and matches every note.
        const snippets = (await search.searchForNotes("#textSnippet OR #snippet"))
            .filter((snippet) => snippet.type === "text" && !snippet.isArchived && snippet.isContentAvailable());
        const definitions: SnippetDefinition[] = [];
        for (const snippet of snippets) {
            const { description } = await invalidateCacheFor(snippet);

            definitions.push({
                title: snippet.title,
                data: () => templateCache.get(snippet.noteId)?.content ?? "",
                iconClass: snippet.getIcon(),
                iconColorClass: snippet.getColorClass() || undefined,
                description
            });
        }
        return definitions;
    } catch (e) {
        logError("Error while building text snippet templates: ", e);
        return [];
    }
}

async function invalidateCacheFor(snippet: FNote) {
    // Prefer the unified `snippetDescription`, falling back to the legacy `textSnippetDescription`
    // so existing text snippets keep showing their description without any migration.
    const description = snippet.getLabelValue("snippetDescription") ?? snippet.getLabelValue("textSnippetDescription");
    const content = await snippet.getContent();
    const data: TemplateData = {
        title: snippet.title,
        // The user's own description always wins; without one, preview the snippet's content so
        // the entry still reads as "this inserts that text" in the palette and the dropdown.
        description: description ?? buildContentPreview(content),
        content
    };
    templateCache.set(snippet.noteId, data);
    return data;
}

async function handleContentUpdate(affectedNoteIds: string[], setTemplates: (value: SnippetDefinition[]) => void) {
    const updatedNoteIds = new Set(affectedNoteIds);
    const templateNoteIds = new Set(templateCache.keys());
    const affectedTemplateNoteIds = templateNoteIds.intersection(updatedNoteIds);

    await froca.getNotes(affectedNoteIds, true);

    let fullReloadNeeded = false;
    for (const affectedTemplateNoteId of affectedTemplateNoteIds) {
        try {
            const template = await froca.getNote(affectedTemplateNoteId);
            if (!template) {
                console.warn("Unable to obtain template with ID ", affectedTemplateNoteId);
                continue;
            }

            const previous = templateCache.get(affectedTemplateNoteId);
            const updated = await invalidateCacheFor(template);

            // A changed title or description is baked into the definition list (unlike content,
            // which stays live through the `data` getter), so the list must be rebuilt. Content
            // edits land here too: without a user description they shift the derived preview.
            if (previous?.title !== updated.title || previous?.description !== updated.description) {
                fullReloadNeeded = true;
                break;
            }
        } catch (e) {
            // If a note was not found while updating the cache, it means we need to do a full reload.
            fullReloadNeeded = true;
        }
    }

    if (fullReloadNeeded) {
        setTemplates(await getTemplates());
    }
}

/** Longest content-derived description shown under a snippet's title. */
const PREVIEW_MAX_LENGTH = 80;

/**
 * Derives a plain-text preview from a snippet's HTML content, used as the description when the
 * note carries no `#snippetDescription` of its own. Returns `undefined` for empty content, so
 * such snippets keep rendering without a description element.
 */
export function buildContentPreview(html: string | undefined): string | undefined {
    if (!html) {
        return undefined;
    }

    // Block boundaries carry an implicit line break that `textContent` drops, gluing paragraphs
    // together ("<p>a</p><p>b</p>" → "ab"); turn them into spaces before parsing.
    const withBreaks = html.replace(/<(?:br\b|\/(?:p|div|li|h[1-6]|blockquote|figcaption|pre|td|th|tr)\b)[^>]*>/gi, " ");
    const text = (new DOMParser().parseFromString(withBreaks, "text/html").body.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();

    if (!text) {
        return undefined;
    }

    if (text.length <= PREVIEW_MAX_LENGTH) {
        return text;
    }

    // Cut at the last word boundary that fits, unless the text is one giant word.
    const cut = text.lastIndexOf(" ", PREVIEW_MAX_LENGTH);
    return `${text.slice(0, cut > 0 ? cut : PREVIEW_MAX_LENGTH)}…`;
}

export async function updateTemplateCache(loadResults: LoadResults, setTemplates: (value: SnippetDefinition[]) => void) {
    const affectedNoteIds = loadResults.getNoteIds();

    // React to creation or deletion of text snippets.
    if (loadResults.getAttributeRows().find((attr) => {
        if (attr.type === "label") {
            // Both the unified `#snippet(Description)` labels and their legacy `#textSnippet`
            // forms mark a note as a snippet, so all four must trigger a rebuild.
            return (attr.name === "snippet" || attr.name === "snippetDescription"
                || attr.name === "textSnippet" || attr.name === "textSnippetDescription");
        } else if (attr.type === "relation") {
            return (attr.value === "_template_text_snippet");
        }
    })) {
        setTemplates(await getTemplates());
    } else if (affectedNoteIds.length > 0) {
        // Update content and titles if one of the template notes were updated.
        debouncedHandleContentUpdate(affectedNoteIds, setTemplates);
    }
}
