import "./ReadOnlyText.css";
// we load CKEditor also for read only notes because they contain content styles required for correct rendering of even read only notes
// we could load just ckeditor-content.css but that causes CSS conflicts when both build CSS and this content CSS is loaded at the same time
// (see https://github.com/zadam/trilium/issues/1590 for example of such conflict)
import "@triliumnext/ckeditor5";

import {
    applyListItemAlignment
} from "@triliumnext/ckeditor5/src/plugins/list_item_alignment_read_only.js";
import { applyTableScroll } from "@triliumnext/ckeditor5/src/plugins/table_scroll_read_only.js";
import {
    applyStickyTableHeaders
} from "@triliumnext/ckeditor5/src/plugins/table_sticky_header_read_only.js";
import { CLASSES as TAB_CLASSES } from "@triliumnext/ckeditor5/src/plugins/tabs/constants.js";
import { applyTabs } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import {
    EXTENDED_CODE_BLOCK_CLASS, EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE
} from "@triliumnext/commons";
import clsx from "clsx";
import { Ref } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef as usePreactRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import { consumeBlockReference } from "../../../services/block_reference";
import { consumeBookmark } from "../../../services/bookmark_jump";
import {
    applyInlineMermaid, emptyUnknownEmbeds, rewriteMermaidDiagramsInContainer
} from "../../../services/content_renderer_text";
import { t } from "../../../services/i18n";
import { applyNoteImageVersions } from "../../../services/image_urls";
import { applyLinkEmbeds } from "../../../services/link_embed";
import { renderMathInElement } from "../../../services/math";
import { trackPendingRender } from "../../../services/pending_renders";
import { consumeSearchTerms } from "../../../services/search_jump";
import { getSourceEmbedTypeByLanguage } from "../../../services/source_embeds";
import { formatCodeBlocks } from "../../../services/syntax_highlight";
import { isContentRightToLeft } from "../../../utils/formatters";
import {
    useNoteBlob, useNoteLabel, useSameNoteSwitch, useSearchTermsConsumer, useSyncedRef,
    useTriliumEvent, useTriliumOption, useTriliumOptionBool
} from "../../react/hooks";
import { RawHtmlBlock } from "../../react/RawHtml";
import { mountScrollableLabel } from "../../react/ScrollableLabel";
import { TypeWidgetProps } from "../type_widget";
import { applyReferenceLinks } from "./read_only_helper";
import {
    loadEmbeddedAttachment,
    loadEmbeddedNote,
    loadInlineEmbed,
    loadUnknownEmbed,
    refreshEmbeddedNote,
    setupImageOpening,
    watchContentEmbeds
} from "./utils";

export default function ReadOnlyText({ note, noteContext, ntxId, parentComponent, isVisible }: TypeWidgetProps) {
    // The componentId matters: the WS echo of a save made by the editable-text editor in the same
    // split carries the shared parent component's id. Without it, this widget — kept mounted but
    // hidden while the user temporarily edits an auto-read-only note — would refetch the whole blob
    // after every save and flash the loading overlay over the editor (#10575). Skipped own-component
    // changes are caught up on via refreshOnShow when this view is displayed again.
    const readOnlyContentRef = usePreactRef<HTMLDivElement>(null);
    const blob = useNoteBlob(note, parentComponent?.componentId, {
        reportLoadStateTo: noteContext,
        isVisible,
        refreshOnShow: true,
        shownRef: readOnlyContentRef
    });
    const { isRtl } = useNoteLanguage(note);
    const renderedNoteIdRef = usePreactRef<string | undefined>(undefined);

    // Scroll to the bookmark or the blocks a link points at. The blob gate skips the mount run,
    // which fires against an empty container while the content is still loading.
    useEffect(() => {
        if (!blob) return;
        renderedNoteIdRef.current = note.noteId;
        revealLinkTarget();
    }, [blob]);
    // A hidden widget leaves the link target to the one on display.
    useSameNoteSwitch(note, ntxId, () => {
        if (isVisible !== false && renderedNoteIdRef.current === note.noteId) {
            revealLinkTarget();
        }
    });

    function revealLinkTarget() {
        consumeBookmark(readOnlyContentRef.current, noteContext?.viewScope);
        consumeBlockReference(readOnlyContentRef.current, noteContext?.viewScope);
    }

    // Jump to the first search match when navigated from search results.
    useEffect(() => {
        if (blob) consumeSearchTerms(noteContext, ntxId);
    }, [blob]);
    useSearchTermsConsumer(note, noteContext, ntxId);

    return (
        <>
            <ReadOnlyTextContent
                html={blob?.content ?? ""}
                noteId={note.noteId}
                ntxId={ntxId}
                dir={isRtl ? "rtl" : "ltr"}
                contentRef={readOnlyContentRef}
            />
        </>
    );
}

interface ReadOnlyTextContentProps {
    /** CKEditor-compatible HTML to render. */
    html: string;
    /** The note `html` belongs to. Reference links to its own blocks show only their text. */
    noteId?: string;
    /** Note context id — enables `contentElRefreshed` / `executeWithContentElement` integrations when provided. */
    ntxId?: string | null;
    dir?: "ltr" | "rtl";
    /** Extra classes appended to the content div. */
    className?: string;
    /** Optional external ref to the rendered content div (e.g. to drive scroll sync). */
    contentRef?: Ref<HTMLDivElement>;
    /**
     * Whether `html` changes as it is typed or streamed. Mermaid diagrams then draw in place,
     * keeping the last drawing while the next renders, instead of in an embed box each.
     */
    isChanging?: boolean;
}

/**
 * Renders arbitrary CKEditor-style HTML with the same pipeline as {@link ReadOnlyText}:
 * mermaid rewriting, inline mermaid, embed expansion, KaTeX math, reference-link
 * titles, tabs, code-block syntax highlighting, and image click handling. Transforms re-run
 * whenever `html` changes.
 */
export function ReadOnlyTextContent({
    html, noteId, ntxId, dir, className, contentRef: externalContentRef, isChanging = false
}: ReadOnlyTextContentProps) {
    // Printing snapshots the page, before an embed box would have drawn its diagram.
    const hasDiagramEmbeds = !isChanging && glob.device !== "print";
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

        // The passes that lazily load their library (mermaid, highlight.js) — plus embedded notes,
        // which render a whole note of their own — finish after this effect returns. On screen they
        // simply paint when ready; a caller that snapshots the DOM instead (printing) has to wait for
        // them, so the work is registered rather than dropped on the floor.
        trackPendingRender(container, Promise.all([
            // First, so that no other pass renders the content of these embeds.
            applyUnknownEmbeds(container),
            ...(hasDiagramEmbeds
                ? [ applySourceEmbeds(container) ]
                : [ rewriteMermaidDiagramsInContainer(container), applyInlineMermaid(container) ]),
            applyContentEmbeds(container),
            applyLinkEmbeds(container),
            applyReferenceLinks(container, noteId),
            formatCodeBlocks($(container))
        ]));

        applyNoteImageVersions(container);
        applyListItemAlignment(container);
        const disposeTableScroll = applyTableScroll(container);
        const disposeStickyTableHeaders = applyStickyTableHeaders(container);
        applyMath(container);
        const disposeTabs = applyTabs(container, {
            placeholder: t("text-editor.ck.tab-title"),
            scrollLabels: {
                start: t("text-editor.ck.scroll-to-the-previous-tabs"),
                end: t("text-editor.ck.scroll-to-the-next-tabs")
            }
        });
        const tabTitles = container.querySelectorAll<HTMLElement>(`.${TAB_CLASSES.tabTitle}`);
        const disposeTabTitles = [ ...tabTitles ]
            .filter((title) => title.hasChildNodes())
            .map((title) => mountScrollableLabel(title));
        setupImageOpening(container, true);

        return () => {
            disposeTableScroll();
            disposeStickyTableHeaders();
            disposeTabs();
            for (const dispose of disposeTabTitles) {
                dispose();
            }
        };
    }, [ html, noteId, ntxId, contentRef, hasDiagramEmbeds ]);

    useEffect(() => {
        if (!contentRef.current) return;
        return watchContentEmbeds(contentRef.current);
    }, [ contentRef, hasDiagramEmbeds ]);

    useTriliumEvent("entitiesReloaded", () => {
        if (contentRef.current) applyNoteImageVersions(contentRef.current);
    });

    // React to embedded note changes.
    useTriliumEvent("refreshEmbeddedNote", ({ noteId }) => {
        if (!contentRef.current) return;
        refreshEmbeddedNote(contentRef.current, noteId);
    });

    // Search integration.
    useTriliumEvent("executeWithContentElement", ({ resolve, ntxId: eventNtxId }) => {
        if (!ntxId || eventNtxId !== ntxId || !contentRef.current) return;
        resolve($(contentRef.current));
    });

    return (
        <RawHtmlBlock
            // The drawings in place replace the code blocks, which the embed boxes need again.
            key={hasDiagramEmbeds ? "embeds" : "drawings"}
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
    // Resolved rather than read straight off the label, so a note with no language of its own still
    // lays out the way the default content language says it should.
    // The default is subscribed to as well: `isContentRightToLeft` reads the options store directly,
    // so without it a note carrying no label of its own would keep its old direction until reopened.
    const [ defaultContentLanguage ] = useTriliumOption("defaultContentLanguage");
    const isRtl = useMemo(() => isContentRightToLeft(language), [ language, defaultContentLanguage ]);
    return { isRtl };
}

function applyContentEmbeds(container: HTMLDivElement) {
    const loaded: Promise<unknown>[] = [];
    const embeddedNotes = container.querySelectorAll<HTMLElement>(".include-note");
    for (const embeddedNote of embeddedNotes) {
        const { attachmentId, noteId, block } = embeddedNote.dataset;
        if (attachmentId) {
            loaded.push(loadEmbeddedAttachment(attachmentId, $(embeddedNote)));
        } else if (noteId) {
            loaded.push(loadEmbeddedNote(noteId, $(embeddedNote), undefined, { block }));
        }
    }
    return Promise.all(loaded);
}

/** Shows each embed of a kind that this version does not know as the editor does: an error box. */
function applyUnknownEmbeds(container: HTMLDivElement) {
    return Promise.all(emptyUnknownEmbeds(container)
        .map((box) => loadUnknownEmbed(box, box.dataset.boxSize)));
}

/**
 * Shows each code block that keeps the source of an embed, such as a Mermaid diagram, in the embed
 * box the editor shows it in, read-only.
 */
function applySourceEmbeds(container: HTMLDivElement) {
    const loaded: Promise<unknown>[] = [];
    for (const code of container.querySelectorAll<HTMLElement>("pre > code")) {
        const pre = code.parentElement;
        const codeLanguage = [ ...code.classList ]
            .find((name) => name.startsWith("language-"))?.slice("language-".length);
        const isDiagram = !!codeLanguage && !!getSourceEmbedTypeByLanguage(codeLanguage);
        const isCodeBlock = !isDiagram && !!pre?.classList.contains(EXTENDED_CODE_BLOCK_CLASS);
        if (!pre || (!isDiagram && !isCodeBlock)) continue;
        const language = codeLanguage ?? EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE;

        const figure = document.createElement("figure");
        figure.className = clsx("include-note", isCodeBlock && EXTENDED_CODE_BLOCK_CLASS);
        const {
            boxSize, displayMode, codeWrapLines, codeLineNumbers, codeTabWidth, codeIndentWithTabs
        } = pre.dataset;
        const defaultBoxSize = isCodeBlock ? "full" : "medium";
        figure.dataset.boxSize = boxSize === "small" || boxSize === "medium" || boxSize === "full"
            ? boxSize
            : defaultBoxSize;
        figure.dataset.language = language;
        const views = {
            displayMode, codeWrapLines, codeLineNumbers, codeTabWidth, codeIndentWithTabs
        };
        for (const [ name, value ] of Object.entries(views)) {
            if (value) {
                figure.dataset[name] = value;
            }
        }
        figure.dataset.hideTitle = "true";
        // Diagrams saved before the embed keep their block ID on the `<code>`.
        const blockId = pre.dataset.triliumBlockId ?? code.dataset.triliumBlockId;
        if (blockId) {
            figure.dataset.triliumBlockId = blockId;
        }
        const style = pre.getAttribute("style");
        if (style) {
            figure.setAttribute("style", style);
        }
        pre.replaceWith(figure);

        const source = code.textContent;
        loaded.push(loadInlineEmbed({
            language,
            getSource: () => source,
            setSource: () => {},
            subscribe: () => () => {},
            isReadOnly: () => true
        }, $(figure), figure.dataset.boxSize, { isFocused: false }));
    }
    return Promise.all(loaded);
}

function applyMath(container: HTMLDivElement) {
    const equations = container.querySelectorAll<HTMLElement>("span.math-tex");
    for (const equation of equations) {
        // throwOnError: false renders invalid formulas as an inline red error (with the
        // parse message as a tooltip) instead of throwing and logging to the console.
        renderMathInElement(equation, { trust: true, throwOnError: false });
    }
}
