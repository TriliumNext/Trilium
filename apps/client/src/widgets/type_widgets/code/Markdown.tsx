import "./Markdown.css";

import VanillaCodeMirror from "@triliumnext/codemirror";
import { renderToHtml } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";

import SplitEditor from "../helpers/SplitEditor";
import { ReadOnlyTextContent } from "../text/ReadOnlyText";
import { TypeWidgetProps } from "../type_widget";

const marked = new Marked({ breaks: true, gfm: true });

interface MarkdownContextValue {
    html: string;
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
    const html = useMemo(() => renderWithSourceLines(content), [ content ]);

    useSyncedScrolling(editorView, previewEl);
    useSyncedHighlight(editorView, previewEl, html);

    const ctx = useMemo<MarkdownContextValue>(
        () => ({ html, setEditorView, setPreviewEl }),
        [ html ]
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
export function renderWithSourceLines(src: string): string {
    // Compute the start line of each renderable top-level token in source order.
    const tokens = marked.lexer(src);
    const lines: number[] = [];
    let line = 1;
    for (const token of tokens) {
        const startLine = line;
        line += (token.raw.match(/\n/g) ?? []).length;
        if (!NON_RENDERED_TOKENS.has(token.type)) lines.push(startLine);
    }

    const html = renderToHtml(src, "", {
        sanitize: (h) => DOMPurify.sanitize(h),
        wikiLink: { formatHref: (id) => `#root/${id}` },
        demoteH1: false
    });
    if (!html) return "";

    const container = document.createElement("div");
    container.innerHTML = html;

    const parts: string[] = [];
    const children = Array.from(container.children);
    for (let i = 0; i < children.length; i++) {
        const sourceLine = lines[i] ?? lines[lines.length - 1] ?? 1;
        parts.push(`<div data-source-line="${sourceLine}">${children[i].outerHTML}</div>`);
    }
    return parts.join("");
}
//#endregion
