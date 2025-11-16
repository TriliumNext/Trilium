import { useEffect, useMemo, useRef } from "preact/hooks";
import { TypeWidgetProps } from "../type_widget";
import "./ReadOnlyText.css";
import { useNoteBlob, useNoteLabel, useTriliumEvent, useTriliumOptionBool } from "../../react/hooks";
import RawHtml from "../../react/RawHtml";

// we load CKEditor also for read only notes because they contain content styles required for correct rendering of even read only notes
// we could load just ckeditor-content.css but that causes CSS conflicts when both build CSS and this content CSS is loaded at the same time
// (see https://github.com/zadam/trilium/issues/1590 for example of such conflict)
import "@triliumnext/ckeditor5";
import FNote from "../../../entities/fnote";
import { getLocaleById } from "../../../services/i18n";
import { getMermaidConfig } from "../../../services/mermaid";
import { loadIncludedNote, refreshIncludedNote, setupImageOpening } from "./utils";
import { renderMathInElement } from "../../../services/math";
import link from "../../../services/link";
import { formatCodeBlocks } from "../../../services/syntax_highlight";
import TouchBar, { TouchBarButton, TouchBarSpacer } from "../../react/TouchBar";
import appContext from "../../../components/app_context";
import { applyReferenceLinks } from "./read_only_helper";

export default function ReadOnlyText({ note, noteContext, ntxId }: TypeWidgetProps) {
    const blob = useNoteBlob(note);
    const contentRef = useRef<HTMLDivElement>(null);
    const [ codeBlockWordWrap ] = useTriliumOptionBool("codeBlockWordWrap");
    const { isRtl } = useNoteLanguage(note);

    // Apply necessary transforms.
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;

        applyInlineMermaid(container);
        applyIncludedNotes(container);
        applyMath(container);
        applyReferenceLinks(container);
        formatCodeBlocks($(container));
        setupImageOpening(container, true);
    }, [ blob ]);

    // React to included note changes.
    useTriliumEvent("refreshIncludedNote", ({ noteId }) => {
        console.log("Refresh ", noteId);
        if (!contentRef.current) return;
        refreshIncludedNote(contentRef.current, noteId);
    });

    // Search integration.
    useTriliumEvent("executeWithContentElement", ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId || !contentRef.current) return;
        resolve($(contentRef.current));
    });

    return (
        <div
            className={`note-detail-readonly-text note-detail-printable ${codeBlockWordWrap ? "word-wrap" : ""}`}
            tabindex={100}
            dir={isRtl ? "rtl" : "ltr"}
        >
            <RawHtml
                containerRef={contentRef}
                className="note-detail-readonly-text-content ck-content use-tn-links"
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
        </div>
    )
}

function useNoteLanguage(note: FNote) {
    const [ language ] = useNoteLabel(note, "language");
    const isRtl = useMemo(() => {
        const correspondingLocale = getLocaleById(language);
        return correspondingLocale?.rtl;
    }, [ language ]);
    return { isRtl };
}

async function applyInlineMermaid(container: HTMLDivElement) {
    const mermaidBlocks = container.querySelectorAll('pre:has(code[class="language-mermaid"])');
    if (!mermaidBlocks.length) return;
    const nodes: HTMLElement[] = [];

    // Rewrite the code block from <pre><code> to <div> in order not to apply a codeblock style to it.
    for (const mermaidBlock of mermaidBlocks) {
        const div = document.createElement("div");
        div.classList.add("mermaid-diagram");
        div.innerHTML = mermaidBlock.querySelector("code")?.innerHTML ?? "";
        mermaidBlock.replaceWith(div);
        nodes.push(div);
    }

    // Initialize mermaid
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize(getMermaidConfig());
    mermaid.run({ nodes });
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
