import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type VanillaCodeMirror from "@triliumnext/codemirror";
import { isAnchorState, type TaskStateDef } from "@triliumnext/commons";
import { useEffect, useRef } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import mime_types from "../../../services/mime_types";
import { getTaskStateDefinitions } from "../../../services/task_states";
import { buildSnippetCompletions, SLASH_COMMAND_REGEX, useCodeSnippets } from "../code/snippets";
import SAMPLE_DIAGRAMS from "../mermaid/sample_diagrams";
import type { TypeWidgetProps } from "../type_widget";
import { uploadImageAndInsert } from "./editor_utils";

/**
 * Adds `/`-triggered autocomplete to the CodeMirror editor.
 * Typing `/` at the start of a line (or after whitespace) shows a menu of commands.
 */
export function useSlashCommands(parentComponent: TypeWidgetProps["parentComponent"], editorView: VanillaCodeMirror | null, note: FNote) {
    // Held in refs so the slash-command closures always read the current note
    // and parent component without re-registering the autocomplete extension —
    // `appendConfig` would otherwise stack a duplicate extension on each switch.
    const noteRef = useRef(note);
    const parentRef = useRef(parentComponent);
    // The user-configured todo task states (from the `_taskStates` subtree), loaded once.
    // Read inside the autocomplete closure, so `/todo:*` commands reflect the current config.
    const taskStatesRef = useRef<TaskStateDef[]>([]);
    // Markdown snippets (#snippet code notes with a markdown MIME) plus generic plain-text snippets,
    // inserted via `/snippet:<name>`. useCodeSnippets keeps the ref fresh so the menu reads the latest.
    const snippetsRef = useCodeSnippets(
        (candidate) => candidate.isMarkdown() || (candidate.type === "code" && candidate.mime === "text/plain"),
        "markdown"
    );
    useEffect(() => { noteRef.current = note; }, [note]);
    useEffect(() => { parentRef.current = parentComponent; }, [parentComponent]);
    useEffect(() => { void getTaskStateDefinitions().then((states) => { taskStatesRef.current = states; }); }, []);

    useEffect(() => {
        if (!editorView) return;

        const ext = autocompletion({
            override: [(ctx) => {
                // `:` and `-` are allowed so `/todo:<state>` (e.g. `/todo:in-progress`) matches as one token.
                const match = ctx.matchBefore(SLASH_COMMAND_REGEX);
                if (!match) return null;

                // Suppress slash menu inside fenced/indented code blocks and inline code spans —
                // a leading `/` there is part of the code, not a command trigger.
                for (let node: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); node; node = node.parent) {
                    if (node.name.includes("Code")) return null;
                }

                return {
                    from: match.from,
                    options: [
                        {
                            label: "/date",
                            detail: t("markdown_slash_commands.date"),
                            apply(view, _completion, from, to) {
                                view.dispatch({ changes: { from, to } });
                                parentRef.current?.triggerCommand("insertDateTimeToText");
                            }
                        },
                        {
                            label: "/include",
                            detail: t("markdown_slash_commands.include"),
                            apply(view, _completion, from, to) {
                                view.dispatch({ changes: { from, to } });
                                parentRef.current?.triggerCommand("addIncludeNoteToText");
                            }
                        },
                        {
                            label: "/image",
                            detail: t("markdown_slash_commands.image"),
                            apply(view, _completion, from, to) {
                                view.dispatch({ changes: { from, to } });
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = "image/*";
                                input.addEventListener("change", () => {
                                    const file = input.files?.[0];
                                    if (file) uploadImageAndInsert(editorView, noteRef.current, file);
                                });
                                input.click();
                            }
                        },
                        {
                            label: "/link",
                            detail: t("markdown_slash_commands.link"),
                            apply(view, _completion, from, to) {
                                view.dispatch({ changes: { from, to } });
                                parentRef.current?.triggerCommand("addLinkToText");
                            }
                        },
                        {
                            label: "/math",
                            detail: t("markdown_slash_commands.math"),
                            apply(view, _completion, from, to) {
                                const placeholder = `\\text{${t("markdown_slash_commands.placeholders.math")}}`;
                                const template = `$$\n${placeholder}\n$$`;
                                view.dispatch({
                                    changes: { from, to, insert: template },
                                    selection: { anchor: from + 3, head: from + 3 + placeholder.length }
                                });
                            }
                        },
                        {
                            label: "/footnote",
                            detail: t("markdown_slash_commands.footnote"),
                            apply(view, _completion, from, to) {
                                const doc = view.state.doc.toString();
                                let maxFootnote = 0;
                                for (const m of doc.matchAll(/\[\^(\d+)\]/g)) {
                                    maxFootnote = Math.max(maxFootnote, parseInt(m[1], 10));
                                }
                                const n = maxFootnote + 1;
                                const ref = `[^${n}]`;
                                const def = `\n\n[^${n}]: `;
                                const docEnd = view.state.doc.length;
                                const newDocEnd = docEnd - (to - from) + ref.length + def.length;
                                view.dispatch({
                                    changes: [
                                        { from, to, insert: ref },
                                        { from: docEnd, insert: def }
                                    ],
                                    selection: { anchor: newDocEnd }
                                });
                            }
                        },
                        {
                            label: "/mermaid",
                            detail: t("markdown_slash_commands.mermaid"),
                            apply(view, _completion, from, to) {
                                const placeholder = "graph TD\n    A --> B";
                                const template = `\`\`\`mermaid\n${placeholder}\n\`\`\``;
                                view.dispatch({
                                    changes: { from, to, insert: template },
                                    selection: { anchor: from + 11, head: from + 11 + placeholder.length }
                                });
                            }
                        },
                        // One `/mermaid:<type>` per sample diagram (e.g. `/mermaid:flowchart`),
                        // pre-filling the fenced block with that template's source.
                        ...SAMPLE_DIAGRAMS.map((sample) => ({
                            label: `/mermaid:${sample.name.toLowerCase().replace(/\s+/g, "-")}`,
                            detail: t("markdown_slash_commands.mermaid_template", { name: sample.name }),
                            apply(view: import("@codemirror/view").EditorView, _c: unknown, from: number, to: number) {
                                const template = `\`\`\`mermaid\n${sample.content.trimEnd()}\n\`\`\``;
                                view.dispatch({
                                    changes: { from, to, insert: template },
                                    selection: { anchor: from + 11 }
                                });
                            }
                        })),
                        {
                            label: "/collapsible",
                            detail: t("markdown_slash_commands.collapsible"),
                            apply(view, _completion, from, to) {
                                // No native markdown syntax — round-trips through the
                                // importer as raw <details>/<summary> HTML (see markdown.ts).
                                const placeholder = t("markdown_slash_commands.placeholders.collapsible_summary");
                                const open = `<details class="trilium-collapsible">\n<summary>`;
                                const close = `</summary>\n\n${t("markdown_slash_commands.placeholders.collapsible_details")}\n\n</details>`;
                                const anchor = from + open.length;
                                view.dispatch({
                                    changes: { from, to, insert: open + placeholder + close },
                                    selection: { anchor, head: anchor + placeholder.length }
                                });
                            }
                        },
                        {
                            label: "/page-break",
                            detail: t("markdown_slash_commands.page_break"),
                            apply(view, _completion, from, to) {
                                // No native markdown syntax — round-trips through the
                                // importer as raw HTML and drives the print/PDF page break (see print.css).
                                // The trailing blank line terminates the raw-HTML block; without it the
                                // text on the next line is swallowed into the <div> and never rendered.
                                const insert = `<div class="page-break"></div>\n\n`;
                                view.dispatch({
                                    changes: { from, to, insert },
                                    selection: { anchor: from + insert.length }
                                });
                            }
                        },
                        {
                            label: "/table",
                            detail: t("markdown_slash_commands.table"),
                            apply(view, _completion, from, to) {
                                // GFM table skeleton. The trailing blank line terminates the table block
                                // so following text isn't absorbed into it (see page break above).
                                const header = t("markdown_slash_commands.placeholders.table_column", { number: 1 });
                                const table = [
                                    `| ${header} | ${t("markdown_slash_commands.placeholders.table_column", { number: 2 })} |`,
                                    `| -------- | -------- |`,
                                    `|          |          |`
                                ].join("\n");
                                // Select the first header cell so the user can type the first column name.
                                const anchor = from + 2; // skip the leading "| "
                                view.dispatch({
                                    changes: { from, to, insert: `${table}\n\n` },
                                    selection: { anchor, head: anchor + header.length }
                                });
                            }
                        },
                        ...["note", "tip", "important", "caution", "warning"].map((admonitionType) => ({
                            label: `/${admonitionType}`,
                            detail: t("markdown_slash_commands.admonition", { type: admonitionType }),
                            apply(view: import("@codemirror/view").EditorView, _c: unknown, from: number, to: number) {
                                const template = `> [!${admonitionType.toUpperCase()}]\n> `;
                                view.dispatch({
                                    changes: { from, to, insert: template },
                                    selection: { anchor: from + template.length }
                                });
                            }
                        })),
                        // One `/todo:<state>` per configured task state that has a markdown marker —
                        // the ` ` (unchecked) and `x` (checked) anchors are markers too, so both are covered.
                        ...taskStatesRef.current
                            .filter((state) => state.markdownSymbol)
                            .map((state) => {
                                // Anchors (`none`/`done`) are the standard `[ ]`/`[x]`; custom states
                                // use non-standard markers (e.g. `[/]`), so flag those in the description.
                                const detailKey = isAnchorState(state.name)
                                    ? "markdown_slash_commands.todo"
                                    : "markdown_slash_commands.todo_nonstandard";
                                return {
                                    label: `/todo:${state.name}`,
                                    detail: t(detailKey, { title: state.title }),
                                    apply(view: import("@codemirror/view").EditorView, _c: unknown, from: number, to: number) {
                                        const precededByBullet = from >= 2 && view.state.doc.sliceString(from - 2, from) === "- ";
                                        const insert = buildTaskItemInsert(state.markdownSymbol, precededByBullet);
                                        view.dispatch({ changes: { from, to, insert } });
                                    }
                                };
                            }),
                        ...buildSnippetCompletions(snippetsRef.current.filter((snippet) => snippet.noteId !== noteRef.current.noteId))
                    ]
                };
            }, codeFenceCompletionSource],
            activateOnTyping: true
        });

        editorView.setNamedExtension("slashCommands", ext);
    }, [editorView]);
}

/**
 * Builds the markdown a `/todo:<state>` command inserts. Omits the leading `- `
 * bullet when the slash was typed right after an existing one (e.g. `- /todo:doing`),
 * so the existing bullet is reused instead of producing a doubled `- - [ ] ` marker.
 */
export function buildTaskItemInsert(symbol: string, precededByBullet: boolean): string {
    return `${precededByBullet ? "" : "- "}[${symbol}] `;
}

/**
 * Parses the text of a line up to the cursor to detect a fenced code block opener being typed
 * (e.g. "```", "```py", or an indented "    ```js"). Returns the offset within the line where the
 * language token starts (right after the run of backticks) and the partial language already typed,
 * or `null` when the text isn't a fence opener. Pure helper, unit-tested.
 */
export function parseCodeFencePrefix(lineBeforeCursor: string): { langStart: number; typed: string } | null {
    const match = /^(\s*)(`{3,})([A-Za-z0-9+#._-]*)$/.exec(lineBeforeCursor);
    if (!match) return null;
    return { langStart: match[1].length + match[2].length, typed: match[3] };
}

/**
 * Whether the fence on the line starting at `lineFrom` closes an already-open code block rather than
 * opening a new one. A bare ``` is both opener and closer in Markdown, so language completions are
 * only offered on openers: inside a `FencedCode` node that began on an earlier line, the ``` closes it.
 */
export function isClosingFence(state: EditorState, lineFrom: number): boolean {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(lineFrom, 1); node; node = node.parent) {
        if (node.name === "FencedCode") return node.from < lineFrom;
    }
    return false;
}

/** Builds the fence-language completions from the user's enabled code-note languages. */
export function buildCodeFenceOptions(): Completion[] {
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const mimeType of mime_types.getMimeTypes()) {
        const code = mimeType.mdLanguageCode;
        if (!mimeType.enabled || !code || seen.has(code)) continue;
        seen.add(code);
        options.push({ label: code, detail: mimeType.title });
    }
    return options;
}

/**
 * Completion source for code-fence languages: triggers only right after a ``` fence opener and lists
 * the user's enabled languages. Returns `null` everywhere else, so it never pollutes the slash menu.
 */
export function codeFenceCompletionSource(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const parsed = parseCodeFencePrefix(line.text.slice(0, context.pos - line.from));
    if (!parsed || isClosingFence(context.state, line.from)) return null;

    const options = buildCodeFenceOptions();
    return options.length ? { from: line.from + parsed.langStart, options } : null;
}
