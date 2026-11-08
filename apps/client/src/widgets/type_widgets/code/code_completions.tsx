import type VanillaCodeMirror from "@triliumnext/codemirror";
import type { TypeCompletionEntry } from "@triliumnext/codemirror";
import { hostedCompletion, type HostedCompletionInsert, type HostedCompletionState } from "@triliumnext/codemirror/src/extensions/hosted_completion";

import { type CommandEntry, CommandMentionList, createHostedList, filterCommandEntries } from "../../react/NoteAutocomplete";
import { type CodeSnippet, SLASH_COMMAND_REGEX, snippetCommand } from "./snippets";

/** What a code editor completes before the caret: a snippet after `/`, or a TypeScript symbol. */
export interface CodeCompletionMatch {
    kind: "snippets" | "types";
    from: number;
    /** What the list filters by: the text after the `/`, or the identifier typed so far. */
    query: string;
}

/** An entry of the code completion list, and what picking it puts in place of the match. */
export interface CodeCompletionEntry extends CommandEntry {
    apply: HostedCompletionInsert;
}

/**
 * Completes code in the text editor's command list, as its `/` palette does: the code snippets
 * after a `/`, and in a script note the completions of the TypeScript language service. Nothing is
 * offered in a read-only editor.
 */
export function codeCompletions(editor: VanillaCodeMirror, getSnippets: () => CodeSnippet[]) {
    return hostedCompletion<CodeCompletionMatch>({
        match: (before, explicit) => (editor.state.readOnly ? null : codeCompletionAt(before, explicit, {
            snippets: getSnippets().length > 0,
            types: editor.hasTypeCompletions()
        })),
        opensOnCaretMove: false,
        list: () => createCodeCompletionList(editor, getSnippets)
    });
}

/**
 * The `/command` typed at the start of a line or after whitespace where there are snippets, or
 * where there are type completions, the identifier typed before the caret. An identifier opens the
 * list from its first character, a `.` before the caret opens it on the members, and Ctrl-Space
 * opens it anywhere.
 */
export function codeCompletionAt(before: string, explicit: boolean, available: { snippets: boolean; types: boolean }): CodeCompletionMatch | null {
    const command = available.snippets ? COMMAND_TYPED.exec(before) : null;
    if (command) {
        return { kind: "snippets", from: command.index, query: command[0].slice(1) };
    }
    if (!available.types) {
        return null;
    }

    const word = IDENTIFIER_TYPED.exec(before)?.[0] ?? "";
    if (!word && !explicit && !before.endsWith(".")) {
        return null;
    }
    return { kind: "types", from: before.length - word.length, query: word };
}

const COMMAND_TYPED = new RegExp(`${SLASH_COMMAND_REGEX.source}$`);
/** An identifier, which a digit cannot start. */
const IDENTIFIER_TYPED = /[A-Za-z_$][\w$]*$/;
/** As many rows as CodeMirror's own completion renders, since a script's globals run to hundreds. */
const MAX_ENTRIES = 100;

/**
 * The completions of the TypeScript language service as rows: each symbol with the icon of its kind,
 * picked as its name.
 */
export function typeCompletionEntries(completions: TypeCompletionEntry[]): CodeCompletionEntry[] {
    return completions.map(({ label, type }, index) => ({
        id: `${index}:${label}`,
        title: label,
        icon: `bx ${(type && TYPE_ICONS[type]) ?? "bx-code-alt"}`,
        apply: label
    }));
}

/** The icon of each kind of symbol CodeMirror names (see `DEFAULT_CODEMIRROR_TYPE_ICONS`). */
const TYPE_ICONS: Record<string, string> = {
    class: "bx-cube",
    constant: "bx-lock-alt",
    enum: "bx-list-ol",
    function: "bx-math",
    interface: "bx-shape-square",
    keyword: "bx-key",
    method: "bx-math",
    namespace: "bx-package",
    property: "bx-wrench",
    text: "bx-text",
    type: "bx-category",
    variable: "bx-box"
};

/**
 * The list of {@link codeCompletions}. The language service is asked once per place the list opens
 * at, and the entries it gives are filtered as the identifier is typed further.
 */
function createCodeCompletionList(editor: VanillaCodeMirror, getSnippets: () => CodeSnippet[]) {
    let cached: { key: string; entries: Promise<CodeCompletionEntry[]> } | undefined;

    const list = createHostedList<HostedCompletionState<CodeCompletionMatch>>((state, props) => {
        const { match } = state;
        // `match.from` counts from the start of the line, so the key also holds the line's place and
        // its text before the match: a paste that ends at the same column elsewhere asks again.
        const line = editor.state.doc.lineAt(editor.state.selection.main.head);
        const key = `${match.kind}:${line.from + match.from}:${line.text.slice(0, match.from)}`;
        if (cached?.key !== key) {
            cached = { key, entries: entriesFor(match) };
        }
        const { entries } = cached;

        return (
            <CommandMentionList<CodeCompletionEntry>
                key={key}
                {...props}
                query={match.query}
                source={async (query) => filterCommandEntries(await entries, query).slice(0, MAX_ENTRIES)}
                className="slash-command-menu"
                onPick={(entry) => state.commit(entry.apply)}
            />
        );
    });

    async function entriesFor(match: CodeCompletionMatch): Promise<CodeCompletionEntry[]> {
        if (match.kind === "snippets") {
            return getSnippets().map(snippetCommand);
        }
        return typeCompletionEntries(await editor.getTypeCompletions() ?? []);
    }

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
