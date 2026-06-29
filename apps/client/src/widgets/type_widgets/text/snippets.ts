import debounce from "../../../services/debounce.js";
import froca from "../../../services/froca.js";
import type LoadResults from "../../../services/load_results.js";
import search from "../../../services/search.js";
import type { TemplateDefinition } from "@triliumnext/ckeditor5";
import type FNote from "../../../entities/fnote.js";
import { escapeHtml } from "../../../services/utils.js";

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
        const definitions: TemplateDefinition[] = [];
        for (const snippet of snippets) {
            const { description } = await invalidateCacheFor(snippet);

            definitions.push({
                title: snippet.title,
                data: () => templateCache.get(snippet.noteId)?.content ?? "",
                icon: buildIcon(snippet),
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
    const data: TemplateData = {
        title: snippet.title,
        description: description ?? undefined,
        content: await snippet.getContent()
    };
    templateCache.set(snippet.noteId, data);
    return data;
}

function buildIcon(snippet: FNote) {
    return /*xml*/`\
<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <foreignObject x="0" y="0" width="20" height="20">
    <span class="note-icon ${escapeHtml(snippet.getIcon())} ${escapeHtml(snippet.getColorClass())}" xmlns="http://www.w3.org/1999/xhtml"></span>
  </foreignObject>
</svg>`
}

async function handleContentUpdate(affectedNoteIds: string[], setTemplates: (value: TemplateDefinition[]) => void) {
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

            const newTitle = template.title;
            if (templateCache.get(affectedTemplateNoteId)?.title !== newTitle) {
                fullReloadNeeded = true;
                break;
            }

            await invalidateCacheFor(template);
        } catch (e) {
            // If a note was not found while updating the cache, it means we need to do a full reload.
            fullReloadNeeded = true;
        }
    }

    if (fullReloadNeeded) {
        setTemplates(await getTemplates());
    }
}

export async function updateTemplateCache(loadResults: LoadResults, setTemplates: (value: TemplateDefinition[]) => void) {
    const affectedNoteIds = loadResults.getNoteIds();

    // React to creation or deletion of text snippets.
    if (loadResults.getAttributeRows().find((attr) => {
        if (attr.type === "label") {
            return (attr.name === "textSnippet" || attr.name === "textSnippetDescription");
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
