import "./ReadOnlyText.css";
// we load CKEditor also for read only notes because they contain content styles required for correct rendering of even read only notes
// we could load just ckeditor-content.css but that causes CSS conflicts when both build CSS and this content CSS is loaded at the same time
// (see https://github.com/zadam/trilium/issues/1590 for example of such conflict)
import "@triliumnext/ckeditor5";

import clsx from "clsx";
import { useEffect, useMemo, useRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import { applyInlineMermaid, rewriteMermaidDiagramsInContainer } from "../../../services/content_renderer_text";
import { getLocaleById } from "../../../services/i18n";
import { renderMathInElement } from "../../../services/math";
import { formatCodeBlocks } from "../../../services/syntax_highlight";
import { useNoteBlob, useNoteLabel, useTriliumEvent, useTriliumOptionBool } from "../../react/hooks";
import { RawHtmlBlock } from "../../react/RawHtml";
import TouchBar, { TouchBarButton, TouchBarSpacer } from "../../react/TouchBar";
import { TypeWidgetProps } from "../type_widget";
import { applyReferenceLinks } from "./read_only_helper";
import { loadIncludedNote, refreshIncludedNote, setupImageOpening } from "./utils";

export default function ReadOnlyText({ note, noteContext, ntxId }: TypeWidgetProps) {
    const blob = useNoteBlob(note);
    const contentRef = useRef<HTMLDivElement>(null);
    const [ codeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");
    const { isRtl } = useNoteLanguage(note);

    // Apply necessary transforms.
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;

        appContext.triggerEvent("contentElRefreshed", { ntxId, contentEl: container });

        rewriteMermaidDiagramsInContainer(container);
        applyInlineMermaid(container);
        applyIncludedNotes(container);
        applyMath(container);
        applyReferenceLinks(container);
        formatCodeBlocks($(container));
        setupImageOpening(container, true);
    }, [ blob ]);

    // React to included note changes.
    useTriliumEvent("refreshIncludedNote", ({ noteId }) => {
        if (!contentRef.current) return;
        refreshIncludedNote(contentRef.current, noteId);
    });

    // Search integration.
    useTriliumEvent("executeWithContentElement", ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId || !contentRef.current) return;
        resolve($(contentRef.current));
    });

    return (
        <>
            <RawHtmlBlock
                containerRef={contentRef}
                className={clsx("note-detail-readonly-text-content ck-content use-tn-links selectable-text", codeBlockWordWrap && "word-wrap")}
                tabindex={100}
                dir={isRtl ? "rtl" : "ltr"}
                html={blob?.content}
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
