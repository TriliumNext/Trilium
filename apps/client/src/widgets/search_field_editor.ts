import "./search_field_editor.css";

import { type NoteChip, triliumNoteChips } from "@triliumnext/codemirror/src/extensions/trilium_note_chips";
import { triliumSearchHighlighter } from "@triliumnext/codemirror/src/extensions/trilium_search_highlighter";
import { type SearchLintMessages, triliumSearchLinter } from "@triliumnext/codemirror/src/extensions/trilium_search_lint";
import { createFieldEditor, type FieldEditor, type FieldEditorConfig } from "@triliumnext/codemirror/src/field_editor";
import type { SearchLintResponse } from "@triliumnext/commons";

import froca from "../services/froca";
import { t } from "../services/i18n";
import server from "../services/server";
import { searchCompletionIcon, searchCompletionReactivates, searchCompletionSource } from "./ribbon/search_completions";

/** The class the styles in `search_field_editor.css` are scoped under. */
export const SEARCH_FIELD_EDITOR_CLASS = "search-string-editor";

/** What a caller supplies; the highlighting, linting and completions are fixed. */
export type SearchFieldEditorConfig = Omit<FieldEditorConfig, "extensions" | "completionSource" | "completionIcon" | "activateOnCompletion">;

/**
 * Builds the editor a search string is written in: the query highlighter, the linter and the
 * attribute/property completions over {@link createFieldEditor}. The quick search and the saved
 * search's ribbon both use it, so a query reads and reports the same way in either field.
 *
 * The parent element needs {@link SEARCH_FIELD_EDITOR_CLASS} for the styles to apply.
 */
export function createSearchFieldEditor(config: SearchFieldEditorConfig): FieldEditor {
    return createFieldEditor({
        ...config,
        extensions: [
            triliumSearchHighlighter,
            triliumSearchLinter(searchLintMessages(), validateOnServer),
            triliumNoteChips(resolveNoteChip)
        ],
        completionSource: searchCompletionSource,
        completionIcon: searchCompletionIcon,
        activateOnCompletion: searchCompletionReactivates
    });
}

/**
 * Names the note an id in the query stands for. Froca answers for one it already holds without a
 * round trip, so a chip for a note on screen is drawn in the same pass the id appears in.
 */
function resolveNoteChip(noteId: string): NoteChip | Promise<NoteChip | null> | null {
    const cached = froca.getNoteFromCache(noteId);
    if (cached) {
        return { title: cached.title, icon: cached.getIcon() };
    }

    return froca.getNote(noteId, true).then((note) => note && { title: note.title, icon: note.getIcon() });
}

/**
 * Asks the engine to read the query without running it, for the faults the rules in the editor do
 * not cover. Only reached once those rules are satisfied, so a query they already object to costs
 * no request.
 */
async function validateOnServer(searchString: string) {
    const { error } = await server.post<SearchLintResponse>("search/lint", { searchString });

    return error;
}

/** Read once the editor is built, so the wording follows a language switched while the app runs. */
function searchLintMessages(): SearchLintMessages {
    return {
        relationNeedsProperty: t("search_lint.relation_needs_property"),
        textNeedsContains: t("search_lint.text_needs_contains"),
        contentNotOrdered: t("search_lint.content_not_ordered"),
        compareTheTitle: t("search_lint.compare_the_title"),
        useOperator: (operator) => t("search_lint.use_operator", { operator })
    };
}
