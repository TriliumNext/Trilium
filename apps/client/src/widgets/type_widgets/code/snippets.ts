import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type VanillaCodeMirror from "@triliumnext/codemirror";
import { useCallback, useEffect, useRef } from "preact/hooks";

import type FNote from "../../../entities/fnote.js";
import type LoadResults from "../../../services/load_results.js";
import search from "../../../services/search.js";
import { useTriliumEvent } from "../../react/hooks";

/** Matches a `/command` token at the start of a line or after whitespace. Shared by every editor. */
export const SLASH_COMMAND_REGEX = /(?:^|(?<=\s))\/[\w:-]*/;

export interface CodeSnippet {
    noteId: string;
    title: string;
    description?: string;
    content: string;
}

/**
 * Loads the code snippets (notes carrying `#snippet`) accepted by `matches`, pre-fetching their
 * content and optional `#snippetDescription` so callers can insert them synchronously. The `matches`
 * predicate selects which snippets are relevant to a given editor (e.g. `note.isMarkdown()` for the
 * Markdown editor, or a MIME comparison for a code editor).
 */
export async function getCodeSnippets(matches: (note: FNote) => boolean): Promise<CodeSnippet[]> {
    try {
        // The `search` route includes archived notes, so drop archived ones; also skip protected
        // snippets whose content isn't available (no active protected session) — they can't be inserted.
        const notes = (await search.searchForNotes("#snippet"))
            .filter((note) => matches(note) && !note.isArchived && note.isContentAvailable());

        return await Promise.all(notes.map(async (note) => ({
            noteId: note.noteId,
            title: note.title,
            description: note.getLabelValue("snippetDescription") ?? undefined,
            content: (await note.getContent()) ?? ""
        })));
    } catch (e) {
        logError("Error while building code snippets: ", e);
        return [];
    }
}

/**
 * Whether the reloaded entities could change the snippet list — a snippet was created, deleted,
 * retitled, had its description changed, or its content edited. `knownNoteIds` are the note IDs of
 * the snippets currently held by the caller, used to detect content/title edits.
 */
export function isCodeSnippetChange(loadResults: LoadResults, knownNoteIds: Set<string>): boolean {
    const attributeChanged = loadResults.getAttributeRows().some((attr) => {
        if (attr.type === "label") {
            return attr.name === "snippet" || attr.name === "snippetDescription";
        }
        if (attr.type === "relation") {
            return attr.value === "_template_markdown_snippet" || attr.value === "_template_code_snippet";
        }
        return false;
    });

    return attributeChanged || loadResults.getNoteIds().some((noteId) => knownNoteIds.has(noteId));
}

/**
 * Builds the `/snippet:<title> - <description>` CodeMirror completions; applying one replaces the
 * typed `/snippet:…` token with the snippet's content and moves the caret to its end.
 */
export function buildSnippetCompletions(snippets: CodeSnippet[]): Completion[] {
    return snippets.map((snippet) => ({
        label: snippet.description
            ? `/snippet:${snippet.title} - ${snippet.description}`
            : `/snippet:${snippet.title}`,
        apply(view: EditorView, _completion: Completion, from: number, to: number) {
            view.dispatch({
                changes: { from, to, insert: snippet.content },
                selection: { anchor: from + snippet.content.length }
            });
        }
    }));
}

/**
 * Loads the snippets accepted by `matches` into a ref and keeps it fresh: reloaded on mount, when
 * `reloadKey` changes (e.g. the editor note's MIME), and when relevant entities change. Held in a
 * ref so consumers (a slash menu) read the latest list when invoked, without re-registering anything.
 * When `enabled` is false the ref stays empty and nothing is loaded.
 */
export function useCodeSnippets(matches: (note: FNote) => boolean, reloadKey: string, enabled = true) {
    const snippetsRef = useRef<CodeSnippet[]>([]);
    // Monotonic id so a slow fetch that resolves after a newer reload is discarded (avoids stale data).
    const reloadCountRef = useRef(0);
    // Keep the latest predicate without making it a dependency (it's a fresh closure each render);
    // `reloadKey` is the stable trigger for filter changes.
    const matchesRef = useRef(matches);
    useEffect(() => { matchesRef.current = matches; });

    const reload = useCallback(() => {
        if (!enabled) {
            snippetsRef.current = [];
            return;
        }
        const reloadId = ++reloadCountRef.current;
        void getCodeSnippets((note) => matchesRef.current(note)).then((snippets) => {
            if (reloadId === reloadCountRef.current) {
                snippetsRef.current = snippets;
            }
        });
    }, [enabled]);

    useEffect(() => { reload(); }, [reload, reloadKey]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (!enabled) return;
        const knownNoteIds = new Set(snippetsRef.current.map((snippet) => snippet.noteId));
        if (isCodeSnippetChange(loadResults, knownNoteIds)) {
            reload();
        }
    });

    return snippetsRef;
}

/**
 * Registers a `/snippet:<name>` slash command on a CodeMirror code editor, listing the snippets
 * accepted by `matches` (e.g. those whose MIME equals the editor note's). Inserting one drops its
 * content at the cursor. No-op when `enabled` is false (e.g. the Markdown editor, which builds its
 * own combined slash-command menu instead).
 */
export function useSnippetSlashCommands(editorView: VanillaCodeMirror | null, matches: (note: FNote) => boolean, reloadKey: string, enabled: boolean, currentNoteId: string) {
    const snippetsRef = useCodeSnippets(matches, reloadKey, enabled);
    // The note being edited, kept in a ref so the once-registered completion source always excludes
    // the current snippet from its own menu — even when the editor is reused for a different note.
    const currentNoteIdRef = useRef(currentNoteId);
    useEffect(() => { currentNoteIdRef.current = currentNoteId; });

    useEffect(() => {
        if (!editorView || !enabled) return;

        const extension = autocompletion({
            override: [(context: CompletionContext) => {
                const match = context.matchBefore(SLASH_COMMAND_REGEX);
                if (!match) return null;
                const options = buildSnippetCompletions(
                    snippetsRef.current.filter((snippet) => snippet.noteId !== currentNoteIdRef.current)
                );
                // No matching snippets (e.g. none for this MIME, or only the current note) → no source,
                // so an empty completion popup never appears when the user types "/".
                return options.length ? { from: match.from, options } : null;
            }],
            activateOnTyping: true
        });

        editorView.setNamedExtension("snippetCommands", extension);
    }, [editorView, enabled]);
}