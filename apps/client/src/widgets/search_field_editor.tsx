import "./search_field_editor.css";

import { hostedCompletion, type HostedCompletionState } from "@triliumnext/codemirror/src/extensions/hosted_completion";
import { type NoteChip, triliumNoteChips } from "@triliumnext/codemirror/src/extensions/trilium_note_chips";
import { triliumSearchHighlighter } from "@triliumnext/codemirror/src/extensions/trilium_search_highlighter";
import { type SearchLintMessages, triliumSearchLinter } from "@triliumnext/codemirror/src/extensions/trilium_search_lint";
import { createFieldEditor, type FieldEditor, type FieldEditorConfig } from "@triliumnext/codemirror/src/field_editor";

import froca from "../services/froca";
import { t } from "../services/i18n";
import { AttributeNameSuggestion, fetchAttributeNames } from "./attribute_widgets/attribute_detail";
import { AutocompleteList } from "./react/FormAutocomplete";
import { CommandMentionList, createHostedList, filterCommandEntries, NoteMentionList } from "./react/NoteAutocomplete";
import { type SearchCompletion, searchCompletionAt, type SearchEntry } from "./search/search_completions";

/** The class the styles in `search_field_editor.css` are scoped under. */
export const SEARCH_FIELD_EDITOR_CLASS = "search-string-editor";

/** What a caller supplies; the highlighting, linting and completions are fixed. */
export type SearchFieldEditorConfig = Omit<FieldEditorConfig, "extensions">;

/**
 * Builds the editor a search string is written in: the query highlighter, the linter and the
 * completions over {@link createFieldEditor}. The quick search and the saved search's parameters both
 * use it, so a query reads and reports the same way in either field.
 *
 * The completions are the app's own lists: a note picked with `@` from the note autocomplete's, a
 * label or relation name from the attribute panel's, and the rest of the syntax from the command
 * palette's.
 *
 * The parent element needs {@link SEARCH_FIELD_EDITOR_CLASS} for the styles to apply.
 */
export function createSearchFieldEditor(config: SearchFieldEditorConfig): FieldEditor {
    return createFieldEditor({
        ...config,
        extensions: [
            triliumSearchHighlighter,
            triliumSearchLinter(searchLintMessages(), validateOnServer),
            triliumNoteChips(resolveNoteChip),
            hostedCompletion({ match: searchCompletionAt, list: createSearchCompletionList })
        ]
    });
}

/**
 * Lists what {@link searchCompletionAt} finds at the cursor, and puts what is picked in place of
 * what it covers. A note goes into the query as its id, which goes on matching the note after a
 * rename.
 */
function createSearchCompletionList() {
    // The entries a list was opened on, kept while it stays open at the same place, so the values
    // of a label are fetched once rather than per keystroke.
    let cached: { key: string; entries: Promise<SearchEntry[]> } | undefined;

    const list = createHostedList<HostedCompletionState<SearchCompletion>>((state, props) => {
        const { match } = state;
        const at = `${match.kind}:${match.from}`;

        switch (match.kind) {
            case "notes":
                return (
                    <NoteMentionList
                        key={at}
                        {...props}
                        query={match.query}
                        onPick={(notePath) => {
                            // Without creation rows, a pick is always a note that exists.
                            if (typeof notePath === "string") {
                                state.commit(notePath.split("/").at(-1) ?? notePath);
                            }
                        }}
                    />
                );
            case "attributes":
                return (
                    <AutocompleteList
                        key={`${at}:${match.type}`}
                        {...props}
                        query={match.query}
                        source={(query) => fetchAttributeNames(match.type, query)}
                        renderItem={(name, query) => <AttributeNameSuggestion type={match.type} name={name} query={query} />}
                        onPick={state.commit}
                    />
                );
            case "entries": {
                const key = `${at}:${match.key}`;
                if (cached?.key !== key) {
                    cached = { key, entries: Promise.resolve(match.entries()) };
                }
                const { entries } = cached;

                return (
                    <CommandMentionList<SearchEntry>
                        key={key}
                        {...props}
                        query={match.query}
                        preselect={match.preselect}
                        source={async (query) => filterCommandEntries(await entries, query)}
                        onPick={(entry) => state.commit(entry.insert)}
                    />
                );
            }
        }
    });

    return {
        show: list.show,
        hide() {
            cached = undefined;
            list.hide();
        },
        handleKeyDown: list.handleKeyDown,
        get element() {
            return list.element;
        },
        destroy: list.destroy
    };
}

/**
 * Names the note an id stands for, for the chips of the search field and of a Markdown note's links.
 * Froca answers for one it already holds without a round trip, so a chip for a note on screen is drawn
 * in the same pass the id appears in.
 */
export function resolveNoteChip(noteId: string): NoteChip | Promise<NoteChip | null> | null {
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
    const { error } = await froca.lintSearch(searchString);

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
