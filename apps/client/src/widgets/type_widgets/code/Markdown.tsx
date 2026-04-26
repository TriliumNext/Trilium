import "./Markdown.css";

import VanillaCodeMirror from "@triliumnext/codemirror";
import { CustomMarkdownRenderer, renderToHtml } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { Marked, type Tokens } from "marked";
import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import NoteContext from "../../../components/note_context";
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

    useSyncedScrolling(editorView, previewEl);
    useSyncedHighlight(editorView, previewEl, html);
    usePublishToc(props.noteContext, editorView, headings);

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
                forceOrientation="horizontal"
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
    headings: MarkdownHeading[]
) {
    useEffect(() => {
        if (!noteContext) return;
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
    }, [ noteContext, headings, editorView ]);
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
