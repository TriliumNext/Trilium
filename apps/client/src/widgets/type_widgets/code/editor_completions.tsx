import type VanillaCodeMirror from "@triliumnext/codemirror";
import {
    hostedCompletion, type HostedCompletionApply, type HostedCompletionState
} from "@triliumnext/codemirror/src/extensions/hosted_completion";
import { isMarkdownMime, type TaskStateDef } from "@triliumnext/commons";
import { useCallback, useEffect, useRef } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { getTaskStateDefinitions } from "../../../services/task_states";
import {
    type CommandEntry, CommandMentionList, createHostedList, filterCommandEntries, NoteMentionList
} from "../../react/NoteAutocomplete";
import {
    buildMarkdownCommands, codeFenceCompletionSource, linkToNote, markdownCompletionAt
} from "../markdown/completions";
import { type CodeSnippet, snippetCommand, useCodeSnippets } from "./snippets";

/** A `/` command of a code editor, listed as the text editor lists its own. */
export interface SlashCommand extends CommandEntry {
    /** Runs the command on the typed `/command`, from `from` to the caret at `to`. */
    apply: HostedCompletionApply;
}

/** A `/command` or a note typed before the caret, from its `/`, its `@` or its `[[`. */
export interface CompletionMatch {
    kind: "command" | "note";
    from: number;
    /** What follows the `/`, the `@` or the `[[`, which the list filters by. */
    query: string;
}

/** The content that a code editor completes. */
export interface CompletionTarget {
    /** The note being edited, which its own `/` list leaves out, or `null` for other content. */
    note: FNote | null;
    /** The note that images upload to and new notes go under. `note` by default. */
    ownerNote?: FNote | null;
    /** The path that new notes go under. The best path of the owner note by default. */
    getNotePath?(): string | null | undefined;
}

/**
 * Loads the code snippets for `mime` and returns them, without the note being edited, for
 * `codeCompletions()` to list after a `/`. For Markdown, registers the `/` list of `view` instead,
 * drawn as the text editor's: its commands and the snippets, the notes typed after `@` or `[[`,
 * and the code-fence languages. Nothing loads or registers while `target` is `undefined`.
 */
export function useEditorCompletions(
    view: VanillaCodeMirror | null,
    mime: string,
    target: CompletionTarget | undefined
): () => CodeSnippet[] {
    const isEnabled = target !== undefined;
    const isMarkdown = isMarkdownMime(mime);
    // Read when the list opens, as switching notes reuses the editor.
    const targetRef = useRef(target);
    targetRef.current = target;
    const snippetsRef = useCodeSnippets(mime, isEnabled);
    const taskStatesRef = useRef<TaskStateDef[]>([]);
    const getSnippets = useCallback(() => snippetsRef.current.filter(
        (snippet) => snippet.noteId !== targetRef.current?.note?.noteId
    ), [ snippetsRef ]);

    useEffect(() => {
        if (!isEnabled || !isMarkdown) return;
        void getTaskStateDefinitions().then((states) => { taskStatesRef.current = states; });
    }, [ isEnabled, isMarkdown ]);

    useEffect(() => {
        if (!view || !isEnabled || !isMarkdown) return;

        const getOwnerNote = () => targetRef.current?.ownerNote ?? targetRef.current?.note ?? null;
        const getNotePath = () => (
            targetRef.current?.getNotePath?.() ?? getOwnerNote()?.getBestNotePathString()
        );
        const commands = (): SlashCommand[] => [
            ...buildMarkdownCommands({
                editorView: view, getOwnerNote, taskStates: taskStatesRef.current
            }),
            ...getSnippets().map(snippetCommand)
        ];

        // Bridges the codemirror package's own @codemirror/state identity.
        type CmMatcher = Parameters<typeof hostedCompletion<CompletionMatch>>[0]["match"];
        view.setNamedExtension("markdownCompletions", hostedCompletion({
            match: markdownCompletionAt as unknown as CmMatcher,
            list: () => createCompletionList(commands, getNotePath)
        }));
        // CodeMirror allows one `override` config per editor, so the fence languages go through
        // `setCompletionSource()`. Bridges the package's own @codemirror/autocomplete identity.
        type CmCompletionSource = Parameters<VanillaCodeMirror["setCompletionSource"]>[1];
        view.setCompletionSource(
            "markdownCodeFence", codeFenceCompletionSource as unknown as CmCompletionSource
        );
        return () => {
            view.setNamedExtension("markdownCompletions", []);
            view.setCompletionSource("markdownCodeFence", null);
        };
    }, [ view, isEnabled, isMarkdown, getSnippets ]);

    // A Markdown editor lists the snippets with its commands.
    return isMarkdown ? noSnippets : getSnippets;
}

const noSnippets = (): CodeSnippet[] => [];

/**
 * The `/` list or the `@` list, drawn as the text editor's: the first runs the command picked on
 * the typed `/command`, the second puts a link to the note picked or created in place of the typed
 * note. A note created goes under `getNotePath()`.
 */
function createCompletionList(
    commands: () => SlashCommand[],
    getNotePath: () => string | null | undefined
) {
    return createHostedList<HostedCompletionState<CompletionMatch>>((state, list) => {
        const { kind, from, query } = state.match;
        if (kind === "note") {
            return (
                <NoteMentionList
                    key={`note:${from}`}
                    {...list}
                    query={query}
                    allowCreatingNotes
                    parentNotePath={getNotePath()}
                    onPick={(notePath) => state.commit(typeof notePath === "string"
                        ? linkToNote(notePath)
                        : notePath.then((path) => path ? linkToNote(path) : undefined))}
                />
            );
        }

        return (
            <CommandMentionList<SlashCommand>
                key={`command:${from}`}
                {...list}
                query={query}
                source={async (typed) => filterCommandEntries(commands(), typed)}
                className="slash-command-menu"
                onPick={(entry) => state.commit(entry.apply)}
            />
        );
    });
}
