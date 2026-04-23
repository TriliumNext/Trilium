import "./ReadOnlyText.css";
// we load CKEditor also for read only notes because they contain content styles required for correct rendering of even read only notes
// we could load just ckeditor-content.css but that causes CSS conflicts when both build CSS and this content CSS is loaded at the same time
// (see https://github.com/zadam/trilium/issues/1590 for example of such conflict)
import "@triliumnext/ckeditor5";

import clsx from "clsx";
import { Ref } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef as usePreactRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import { applyInlineMermaid, rewriteMermaidDiagramsInContainer } from "../../../services/content_renderer_text";
import { getLocaleById } from "../../../services/i18n";
import { renderMathInElement } from "../../../services/math";
import { formatCodeBlocks } from "../../../services/syntax_highlight";
import { useNoteBlob, useNoteLabel, useSyncedRef, useTriliumEvent, useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import { RawHtmlBlock } from "../../react/RawHtml";
import TouchBar, { TouchBarButton, TouchBarSpacer } from "../../react/TouchBar";
import { TypeWidgetProps } from "../type_widget";
import { applyReferenceLinks } from "./read_only_helper";
import { loadIncludedNote, refreshIncludedNote, setupImageOpening } from "./utils";

export default function ReadOnlyText({ note, noteContext, ntxId }: TypeWidgetProps) {
    const blob = useNoteBlob(note);
    const { isRtl } = useNoteLanguage(note);
    const readOnlyContentRef = usePreactRef<HTMLDivElement>(null);

    // Scroll to bookmark anchor if navigated with ?bookmark=...
    useEffect(() => {
        const viewScope = noteContext?.viewScope;
        if (!viewScope?.bookmark || !readOnlyContentRef.current) return;

        const el = readOnlyContentRef.current.querySelector(`[id="${CSS.escape(viewScope.bookmark)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        viewScope.bookmark = undefined;
    }, [blob]);

    return (
        <>
            <ReadOnlyTextContent
                html={blob?.content ?? ""}
                ntxId={ntxId}
                dir={isRtl ? "rtl" : "ltr"}
                contentRef={readOnlyContentRef}
            />

            <TouchBar>
                <TouchBarSpacer size="flexible" />
                <TouchBarButton
                    icon="NSLockUnlockedTemplate"
                    click={() => {
                        if (noteContext?.viewScope) {
                            noteContext.viewScope.readOnlyTemporarilyDisabled = true;
                            appContext.triggerEvent("readOnlyTemporarilyDisabled", { noteContext });
                        }
                    }}
                />
            </TouchBar>
        </>
    );
}

interface ReadOnlyTextContentProps {
    /** CKEditor-compatible HTML to render. */
    html: string;
    /** Note context id — enables `contentElRefreshed` / `executeWithContentElement` integrations when provided. */
    ntxId?: string | null;
    dir?: "ltr" | "rtl";
    /** Extra classes appended to the content div. */
    className?: string;
    /** Optional external ref to the rendered content div (e.g. to drive scroll sync). */
    contentRef?: Ref<HTMLDivElement>;
}

/**
 * Renders arbitrary CKEditor-style HTML with the same pipeline as {@link ReadOnlyText}:
 * mermaid rewriting, inline mermaid, included-note expansion, KaTeX math, reference-link
 * titles, code-block syntax highlighting, and image click handling. Transforms re-run
 * whenever `html` changes.
 */
export function ReadOnlyTextContent({ html, ntxId, dir, className, contentRef: externalContentRef }: ReadOnlyTextContentProps) {
    const contentRef = useSyncedRef(externalContentRef);
    const [ codeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");
    const [ codeBlockTabWidth ] = useTriliumOption("codeBlockTabWidth");

    useEffect(() => {
        document.body.style.setProperty("--code-block-tab-width", codeBlockTabWidth || "4");
    }, [codeBlockTabWidth]);

    // Apply necessary transforms. Runs in a layout effect so the synchronous
    // DOM mutations (mermaid rewrite + cached-SVG repaint, math, etc.) happen
    // before the browser paints — prevents a flash of raw `<pre>` content
    // during live preview re-renders.
    useLayoutEffect(() => {
        const container = contentRef.current;
        if (!container) return;

        if (ntxId) {
            appContext.triggerEvent("contentElRefreshed", { ntxId, contentEl: container });
        }

        rewriteMermaidDiagramsInContainer(container);
        applyInlineMermaid(container);
        applyIncludedNotes(container);
        applyMath(container);
        applyReferenceLinks(container);
        formatCodeBlocks($(container));
        setupImageOpening(container, true);
    }, [ html, ntxId, contentRef ]);

    // React to included note changes.
    useTriliumEvent("refreshIncludedNote", ({ noteId }) => {
        if (!contentRef.current) return;
        refreshIncludedNote(contentRef.current, noteId);
    });

    // Search integration.
    useTriliumEvent("executeWithContentElement", ({ resolve, ntxId: eventNtxId }) => {
        if (!ntxId || eventNtxId !== ntxId || !contentRef.current) return;
        resolve($(contentRef.current));
    });

    return (
        <RawHtmlBlock
            containerRef={contentRef}
            className={clsx("note-detail-readonly-text-content ck-content use-tn-links selectable-text", codeBlockWordWrap && "word-wrap", className)}
            tabindex={100}
            dir={dir}
            html={html}
        />
    );
}

function useNoteLanguage(note: FNote) {
    const [ language ] = useNoteLabel(note, "language");
    const isRtl = useMemo(() => {
        const correspondingLocale = getLocaleById(language);
        return correspondingLocale?.rtl;
    }, [ language ]);
    return { isRtl };
}

function applyIncludedNotes(container: HTMLDivElement) {
    const includedNotes = container.querySelectorAll<HTMLElement>("section.include-note");
    for (const includedNote of includedNotes) {
        const noteId = includedNote.dataset.noteId;
        if (!noteId) continue;
        loadIncludedNote(noteId, $(includedNote));
    }
}

function applyMath(container: HTMLDivElement) {
    const equations = container.querySelectorAll("span.math-tex");
    for (const equation of equations) {
        renderMathInElement(equation, { trust: true });
    }
}
