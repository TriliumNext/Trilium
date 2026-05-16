import "./Markdown.css";

import { autocompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import VanillaCodeMirror from "@triliumnext/codemirror";
import { CustomMarkdownRenderer, renderToHtml } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { Marked, type Tokens } from "marked";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import keyboard_actions from "../../../services/keyboard_actions";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import server from "../../../services/server";
import { removeIndividualBinding } from "../../../services/shortcuts";
import toast from "../../../services/toast";
import tree from "../../../services/tree";
import utils, { isDesktop } from "../../../services/utils";
import { useLegacyImperativeHandlers, useTriliumEvent } from "../../react/hooks";
import SplitEditor from "../helpers/SplitEditor";
import { ReadOnlyTextContent } from "../text/ReadOnlyText";
import { TypeWidgetProps } from "../type_widget";

const marked = new Marked({ breaks: true, gfm: true });

/**
 * The default {@link CustomMarkdownRenderer} falls back to
 * `language-text-x-trilium-auto` on unlabeled fences, which drives
 * `syntax_highlight.ts` into `highlightAuto` — that dynamic-imports every hljs
 * language bundle on first render and runs detection on each block, which is
 * both slow and often wrong on short snippets. For the live preview we instead
 * emit unlabeled fences without a `language-` class so the highlighter skips
 * them entirely.
 */
class MarkdownPreviewRenderer extends CustomMarkdownRenderer {
    override code(token: Tokens.Code): string {
        const html = super.code(token);
        if (token.lang) return html;
        return html.replace('<code class="language-text-x-trilium-auto">', `<code class="language-text-plain">`);
    }
}

export interface MarkdownHeading {
    id: string;
    level: number;
    text: string;
    line: number;
}

interface MarkdownContextValue {
    html: string;
    headings: MarkdownHeading[];
    setEditorView: (view: VanillaCodeMirror | null) => void;
    setPreviewEl: (el: HTMLDivElement | null) => void;
}

const MarkdownContext = createContext<MarkdownContextValue | null>(null);

function useMarkdownContext() {
    const ctx = useContext(MarkdownContext);
    if (!ctx) throw new Error("useMarkdownContext must be used within a Markdown component");
    return ctx;
}

export default function Markdown(props: TypeWidgetProps) {
    const [ content, setContent ] = useState("");
    const [ editorView, setEditorView ] = useState<VanillaCodeMirror | null>(null);
    const [ previewEl, setPreviewEl ] = useState<HTMLDivElement | null>(null);
    const { html, headings } = useMemo(() => renderWithSourceLines(content), [ content ]);

    // Bind text-detail shortcuts (e.g. Ctrl+L for add link) to CodeMirror's contentDOM,
    // since the outer `dom` only receives events after CodeMirror has already handled them.
    useEffect(() => {
        if (!editorView || !props.parentComponent) return;
        const $el = $(editorView.contentDOM);
        const bindingPromise = keyboard_actions.setupActionsForElement("text-detail", $el, props.parentComponent, props.ntxId);
        return () => {
            bindingPromise.then(bindings => {
                for (const binding of bindings) {
                    removeIndividualBinding(binding);
                }
            });
        };
    }, [editorView, props.parentComponent, props.ntxId]);

    useSyncedScrolling(editorView, previewEl);
    useSyncedHighlight(editorView, previewEl, html);
    usePublishToc(props.noteContext, editorView, headings, props.note);
    useImageDrop(props.note, editorView);
    useTextCommands(props.parentComponent, editorView);
    useSlashCommands(props.parentComponent, editorView, props.note);
    useMarkdownKeymap(editorView);

    const ctx = useMemo<MarkdownContextValue>(
        () => ({ html, headings, setEditorView, setPreviewEl }),
        [ html, headings ]
    );

    return (
        <MarkdownContext.Provider value={ctx}>
            <SplitEditor
                noteType="code"
                {...props}
                editorRef={setEditorView}
                onContentChanged={setContent}
                previewContent={<MarkdownPreview ntxId={props.ntxId} />}
                forceOrientation={isDesktop() ? "horizontal" : "vertical"}
            />
        </MarkdownContext.Provider>
    );
}

function MarkdownPreview({ ntxId }: { ntxId: TypeWidgetProps["ntxId"] }) {
    const { html, setPreviewEl } = useMarkdownContext();
    return (
        <ReadOnlyTextContent
            html={html}
            ntxId={ntxId}
            className="markdown-preview"
            contentRef={setPreviewEl}
        />
    );
}

//#region Table of contents
/**
 * Publishes heading data via `setContextData("toc", ...)` so the sidebar
 * Table of Contents can display headings extracted from the markdown source,
 * independent of whether the preview pane is visible.
 */
function usePublishToc(
    noteContext: NoteContext | undefined,
    editorView: VanillaCodeMirror | null,
    headings: MarkdownHeading[],
    note: FNote
) {
    const publish = useCallback(() => {
        if (!noteContext || noteContext.noteId !== note.noteId) return;
        noteContext.setContextData("toc", {
            headings,
            scrollToHeading(heading) {
                if (!editorView) return;
                const mdHeading = headings.find(h => h.id === heading.id);
                if (!mdHeading) return;
                const line = editorView.state.doc.line(Math.min(mdHeading.line, editorView.state.doc.lines));
                const lineBlock = editorView.lineBlockAt(line.from);
                const scrollerHeight = editorView.scrollDOM.clientHeight;
                const targetTop = lineBlock.top - scrollerHeight / 2 + lineBlock.height / 2;
                editorView.scrollDOM.scrollTo({ top: targetTop, behavior: "smooth" });
            }
        });
    }, [ noteContext, headings, editorView, note.noteId ]);

    // Publish when headings or editor change.
    useEffect(() => { publish(); }, [ publish ]);

    // Re-publish after note switches: context data is cleared when the noteId
    // changes, so when our note becomes active again we need to restore it.
    // The noteId guard in publish() prevents overwriting another widget's ToC.
    useTriliumEvent("noteSwitched", ({ noteContext: ctx }) => {
        if (ctx === noteContext) {
            publish();
        }
    });
}
//#endregion

//#region Synced scrolling
/**
 * One-directional (editor → preview) scroll sync. On editor scroll, finds the
 * top visible source line via the CodeMirror `EditorView`, then scrolls the
 * preview so the block tagged with that line is at the top — interpolating to
 * the next block for smoothness.
 */
function useSyncedScrolling(view: VanillaCodeMirror | null, preview: HTMLDivElement | null) {
    useEffect(() => {
        if (!view || !preview) return;

        const scroller = view.scrollDOM;

        function onScroll() {
            if (!view || !preview) return;
            const topLine = view.state.doc.lineAt(view.lineBlockAtHeight(scroller.scrollTop).from).number;

            const blocks = preview.querySelectorAll<HTMLElement>("[data-source-line]");
            if (!blocks.length) return;

            let before: HTMLElement | null = null;
            let after: HTMLElement | null = null;
            for (const el of blocks) {
                const l = parseInt(el.dataset.sourceLine!, 10);
                if (l <= topLine) before = el;
                else { after = el; break; }
            }

            if (!before) { preview.scrollTop = 0; return; }

            const previewTop = preview.getBoundingClientRect().top - preview.scrollTop;
            const beforeOffset = before.getBoundingClientRect().top - previewTop;
            const beforeLine = parseInt(before.dataset.sourceLine!, 10);

            if (!after) { preview.scrollTop = beforeOffset; return; }

            const afterOffset = after.getBoundingClientRect().top - previewTop;
            const afterLine = parseInt(after.dataset.sourceLine!, 10);
            const ratio = (topLine - beforeLine) / (afterLine - beforeLine);
            preview.scrollTop = beforeOffset + (afterOffset - beforeOffset) * ratio;
        }

        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => scroller.removeEventListener("scroll", onScroll);
    }, [ view, preview ]);
}

/**
 * Highlights the preview block that corresponds to the editor's active line,
 * matching the built-in `cm-activeLine` behavior. Re-runs when the rendered
 * HTML changes so newly inserted blocks pick up the current cursor position.
 */
function useSyncedHighlight(view: VanillaCodeMirror | null, preview: HTMLDivElement | null, html: string) {
    useEffect(() => {
        if (!view || !preview) return;

        let current: HTMLElement | null = null;

        function update() {
            if (!view || !preview) return;
            const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;

            const blocks = preview.querySelectorAll<HTMLElement>("[data-source-line]");
            let match: HTMLElement | null = null;
            for (const el of blocks) {
                if (parseInt(el.dataset.sourceLine!, 10) <= activeLine) match = el;
                else break;
            }

            if (match === current) return;
            current?.classList.remove("markdown-preview-active");
            match?.classList.add("markdown-preview-active");
            current = match;
        }

        update();
        const unsubscribe = view.addUpdateListener((v) => {
            if (v.selectionSet || v.docChanged) update();
        });
        return unsubscribe;
    }, [ view, preview, html ]);
}

/**
 * Uploads the image as a note attachment and inserts a markdown image reference at `pos` (or the cursor).
 * Mirrors CKEditor's image upload adapter: on failure, surfaces the server's error message as a
 * toast, falling back to a generic "Cannot upload" message for network errors.
 */
async function uploadImageAndInsert(view: VanillaCodeMirror, note: FNote, file: File, pos?: number) {
    let detail: string | undefined;
    try {
        const result = await server.upload(
            `notes/${note.noteId}/attachments/upload`,
            file, undefined, "POST"
        ) as { uploaded?: boolean; url?: string; message?: string };
        if (result?.uploaded && result.url) {
            insertText(view, `![${file.name}](${result.url})`, pos);
            return;
        }
        detail = result?.message;
    } catch (e) {
        detail = e instanceof Error ? e.message : undefined;
    }

    const base = t("markdown_editor.image_upload_failed", { name: file.name });
    toast.showError(detail ? `${base} ${detail}` : base);
}

/** Inserts text at the given position (or cursor) and moves the cursor to the end of the inserted text. */
function insertText(view: VanillaCodeMirror, text: string, pos?: number) {
    const from = pos ?? view.state.selection.main.head;
    view.dispatch({
        changes: { from, insert: text },
        selection: { anchor: from + text.length }
    });
}

/** Replaces the selection range with text and moves the cursor to the end. */
function replaceSelection(view: VanillaCodeMirror, text: string, from: number, to: number) {
    view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length }
    });
}

//#region Text commands
/**
 * Handles text-detail commands for the Markdown editor:
 * - Add Link (Ctrl+L): opens the add-link dialog, inserts markdown link syntax
 * - Insert Date/Time (Alt+T): inserts a formatted date/time string
 */
function useTextCommands(parentComponent: TypeWidgetProps["parentComponent"], editorView: VanillaCodeMirror | null) {
    useLegacyImperativeHandlers({
        addLinkToTextCommand() {
            if (!editorView) return;

            const { from, to } = editorView.state.selection.main;
            const selectedText = editorView.state.sliceDoc(from, to);

            parentComponent?.triggerCommand("showAddLinkDialog", {
                text: selectedText,
                hasSelection: from !== to,
                async addLink(notePath: string, linkTitle: string | null, externalLink?: boolean) {
                    if (!editorView) return;

                    let md: string;
                    if (externalLink) {
                        const label = (from !== to) ? selectedText : (linkTitle || notePath);
                        md = `[${label}](${notePath})`;
                    } else if (linkTitle) {
                        const label = (from !== to) ? selectedText : linkTitle;
                        md = `[${label}](#${notePath})`;
                    } else {
                        const noteId = tree.getNoteIdFromUrl(notePath);
                        md = `[[${noteId}]]`;
                    }

                    replaceSelection(editorView, md, from, to);
                    editorView.focus();
                }
            });
        },

        insertDateTimeToTextCommand() {
            if (!editorView) return;

            const dateString = utils.formatDateTime(new Date(), options.get("customDateTimeFormat"));
            insertText(editorView, dateString);
        },

        addIncludeNoteToTextCommand() {
            if (!editorView) return;

            parentComponent?.triggerCommand("showIncludeNoteDialog", {
                editorApi: {
                    addIncludeNote(noteId: string, boxSize?: string) {
                        insertText(editorView, `<section class="include-note" data-note-id="${noteId}" data-box-size="${boxSize ?? "full"}"></section>\n`);
                        editorView.focus();
                    },
                    async addImage(noteId: string) {
                        const note = await froca.getNote(noteId);
                        if (!note) return;
                        const encodedTitle = encodeURIComponent(note.title);
                        insertText(editorView, `![${note.title}](api/images/${noteId}/${encodedTitle})\n`);
                        editorView.focus();
                    }
                }
            });
        },

        async cutIntoNoteCommand() {
            if (!editorView) return;

            const { from, to } = editorView.state.selection.main;
            if (from === to) return;

            const selectedText = editorView.state.sliceDoc(from, to);

            // Extract first heading as title, if present.
            const headingMatch = selectedText.match(/^(#{1,6})\s+(.+)$/m);
            const title = headingMatch ? headingMatch[2].trim() : null;
            const content = headingMatch
                ? selectedText.replace(headingMatch[0], "").trim()
                : selectedText;

            const note = appContext.tabManager.getActiveContextNote();
            const parentNotePath = appContext.tabManager.getActiveContextNotePath();
            if (!note || !parentNotePath) return;

            const result = await note_create.createNote(parentNotePath, {
                isProtected: note.isProtected,
                title,
                content,
                type: "code",
                mime: "text/x-markdown",
                activate: false
            });

            if (result?.note) {
                // Replace selection with a wiki-link to the new note.
                replaceSelection(editorView, `[[${result.note.noteId}]]`, from, to);
            }
        }
    });
}
//#endregion

//#region Markdown keymap
/**
 * Adds markdown-specific formatting shortcuts (bold, italic, strikethrough, math).
 * Toggles the wrapper around the selection, or inserts it at the cursor.
 */
function useMarkdownKeymap(editorView: VanillaCodeMirror | null) {
    useEffect(() => {
        if (!editorView) return;

        function toggleWrap(wrapper: string): boolean {
            if (!editorView) return false;
            const { from, to } = editorView.state.selection.main;
            const len = wrapper.length;

            if (from === to) {
                // No selection — insert wrapper pair and place cursor inside.
                const text = `${wrapper}${wrapper}`;
                editorView.dispatch({
                    changes: { from, insert: text },
                    selection: { anchor: from + len }
                });
                return true;
            }

            const selected = editorView.state.sliceDoc(from, to);

            // If already wrapped, unwrap.
            if (selected.startsWith(wrapper) && selected.endsWith(wrapper) && selected.length >= len * 2) {
                const inner = selected.slice(len, -len);
                replaceSelection(editorView, inner, from, to);
                return true;
            }

            // Also check if the wrapper is outside the selection.
            const before = editorView.state.sliceDoc(from - len, from);
            const after = editorView.state.sliceDoc(to, to + len);
            if (before === wrapper && after === wrapper) {
                editorView.dispatch({
                    changes: [
                        { from: from - len, to: from },
                        { from: to, to: to + len }
                    ],
                    selection: { anchor: from - len, head: to - len }
                });
                return true;
            }

            // Wrap selection.
            const wrapped = `${wrapper}${selected}${wrapper}`;
            replaceSelection(editorView, wrapped, from, to);
            // Re-select just the inner text.
            editorView.dispatch({ selection: { anchor: from + len, head: to + len } });
            return true;
        }

        const bindings: Record<string, string> = {
            "b": "**",
            "i": "*",
            "m": "$"
        };
        const shiftBindings: Record<string, string> = {
            "x": "~~"
        };

        function onKeydown(e: KeyboardEvent) {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;

            const key = e.key.toLowerCase();
            const wrapper = e.shiftKey ? shiftBindings[key] : bindings[key];
            if (!wrapper) return;

            e.preventDefault();
            e.stopPropagation();
            toggleWrap(wrapper);
        }

        editorView.contentDOM.addEventListener("keydown", onKeydown, true);
        return () => editorView.contentDOM.removeEventListener("keydown", onKeydown, true);
    }, [editorView]);
}
//#endregion

//#region Slash commands
/**
 * Adds `/`-triggered autocomplete to the CodeMirror editor.
 * Typing `/` at the start of a line (or after whitespace) shows a menu of commands.
 */
function useSlashCommands(parentComponent: TypeWidgetProps["parentComponent"], editorView: VanillaCodeMirror | null, note: FNote) {
    // Held in refs so the slash-command closures always read the current note
    // and parent component without re-registering the autocomplete extension —
    // `appendConfig` would otherwise stack a duplicate extension on each switch.
    const noteRef = useRef(note);
    const parentRef = useRef(parentComponent);
    useEffect(() => { noteRef.current = note; }, [note]);
    useEffect(() => { parentRef.current = parentComponent; }, [parentComponent]);

    useEffect(() => {
        if (!editorView) return;

        const ext = autocompletion({
            override: [(ctx) => {
                const match = ctx.matchBefore(/(?:^|(?<=\s))\/\w*/);
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
                                const placeholder = "\\text{equation}";
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
                        }))
                    ]
                };
            }],
            activateOnTyping: true
        });

        editorView.setNamedExtension("slashCommands", ext);
    }, [editorView]);
}
//#endregion

//#region Image upload
/**
 * Handles drag-and-drop and paste of images into the CodeMirror editor.
 * Uploads the image as an attachment and inserts markdown image syntax at the cursor.
 */
function useImageDrop(note: FNote, editorView: VanillaCodeMirror | null) {
    useEffect(() => {
        if (!editorView) return;

        const dom = editorView.dom;

        function handleDrop(e: DragEvent) {
            const files = e.dataTransfer?.files;
            if (!files?.length) return;

            const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
            if (!imageFiles.length || !editorView) return;

            e.preventDefault();
            e.stopPropagation();

            const dropPos = editorView.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined;
            for (const file of imageFiles) {
                uploadImageAndInsert(editorView!, note, file, dropPos);
            }
        }

        function handlePaste(e: ClipboardEvent) {
            const items = e.clipboardData?.items;
            if (!items) return;

            // Check for HTML containing attachment image references (e.g. from "Copy link to clipboard").
            const html = e.clipboardData?.getData("text/html");
            if (html) {
                const imgMatch = html.match(/<img[^>]+src="([^"]*)(api\/attachments\/[a-zA-Z0-9_]+\/image\/[^"?]+)/);
                if (imgMatch && editorView) {
                    e.preventDefault();
                    const src = imgMatch[2];
                    const alt = html.match(/<img[^>]+alt="([^"]*)"/)?.[1] ?? "image";
                    insertText(editorView, `![${alt}](${src})`);
                    return;
                }
            }

            // Check for pasted image files (e.g. screenshot paste).
            const imageFiles: File[] = [];
            for (const item of items) {
                if (item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                }
            }

            if (!imageFiles.length) return;

            e.preventDefault();
            for (const file of imageFiles) {
                uploadImageAndInsert(editorView!, note, file);
            }
        }

        function handleDragOver(e: DragEvent) {
            if (e.dataTransfer?.types.includes("Files")) {
                e.preventDefault();
            }
        }

        dom.addEventListener("drop", handleDrop);
        dom.addEventListener("paste", handlePaste);
        dom.addEventListener("dragover", handleDragOver);

        return () => {
            dom.removeEventListener("drop", handleDrop);
            dom.removeEventListener("paste", handlePaste);
            dom.removeEventListener("dragover", handleDragOver);
        };
    }, [editorView, note]);
}
//#endregion

/** Token types the parser emits but which don't produce top-level block HTML. */
const NON_RENDERED_TOKENS = new Set([ "space", "def" ]);

/**
 * Render markdown and tag each top-level block with its 1-indexed source line,
 * so the preview can be scrolled to match the editor. Uses the shared
 * `renderToHtml` pipeline (admonitions, math, tables, etc.) with DOMPurify for
 * sanitization, then walks the rendered DOM and pairs each top-level child
 * with the matching lexer token's start line. Marked does not emit source
 * positions (markedjs/marked#1267) so we count newlines in `raw` ourselves.
 */
export function renderWithSourceLines(src: string): { html: string; headings: MarkdownHeading[] } {
    // Compute the start line of each renderable top-level token in source order.
    const tokens = marked.lexer(src);
    const lines: number[] = [];
    const headings: MarkdownHeading[] = [];
    let line = 1;
    let headingIdx = 0;
    for (const token of tokens) {
        const startLine = line;
        line += (token.raw.match(/\n/g) ?? []).length;
        if (!NON_RENDERED_TOKENS.has(token.type)) lines.push(startLine);
        if (token.type === "heading") {
            headings.push({
                id: `md-heading-${headingIdx++}`,
                level: (token as { depth: number }).depth,
                text: token.text ?? "",
                line: startLine
            });
        }
    }

    const html = renderToHtml(src, "", {
        sanitize: (h) => DOMPurify.sanitize(h),
        wikiLink: { formatHref: (id) => `#root/${id}` },
        demoteH1: false,
        renderer: new MarkdownPreviewRenderer({ async: false })
    });
    if (!html) return { html: "", headings };

    const container = document.createElement("div");
    container.innerHTML = html;

    const parts: string[] = [];
    const children = Array.from(container.children);
    for (let i = 0; i < children.length; i++) {
        const sourceLine = lines[i] ?? lines[lines.length - 1] ?? 1;
        parts.push(`<div data-source-line="${sourceLine}">${children[i].outerHTML}</div>`);
    }
    return { html: parts.join(""), headings };
}
//#endregion
