import "./PdfAnnotations.css";

import clsx from "clsx";
import { useContext } from "preact/hooks";

import contextMenu from "../../../menus/context_menu";
import { t } from "../../../services/i18n";
import { useFilterState } from "../../react/filter";
import { useNoteProperty } from "../../react/hooks/note";
import { useActiveNoteContext, useGetContextData } from "../../react/hooks/tree";
import Icon from "../../react/Icon";
import { HighlightedText } from "../../react/RawHtml";
import { OutlineLoading, useOutlineFilter } from "../outline_filter";
import RightPanelWidget, { NavigatedInNote } from "../RightPanelWidget";

const TYPE_ICONS: Record<string, string> = {
    text: "bx bxs-comment-detail",
    freetext: "bx bx-text",
    highlight: "bx bx-highlight",
    ink: "bx bx-pen",
};

export default function PdfAnnotations() {
    const { note } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const annotationsData = useGetContextData("pdfAnnotations");
    const onNavigated = useContext(NavigatedInNote);
    const tokens = useFilterState()?.tokens;
    const ready = annotationsData?.status === "ready" ? annotationsData : undefined;

    const activate = (annotation: PdfAnnotationInfo) => {
        ready?.scrollToAnnotation(annotation.id, annotation.pageNumber);
        onNavigated?.();
    };
    const matches = useOutlineFilter(ready?.annotations ?? null, {
        section: "pdf-annotations",
        getText: getAnnotationText,
        activate
    });

    if (noteType !== "file" || noteMime !== "application/pdf" || !annotationsData) {
        return null;
    }

    // A card while the annotations are read only while filtering, which waits for them.
    if (!ready) {
        return matches ? (
            <RightPanelWidget id="pdf-annotations" title={t("pdf.annotations_title")}>
                <OutlineLoading />
            </RightPanelWidget>
        ) : null;
    }

    if (ready.annotations.length === 0) {
        return null;
    }

    const shown = matches ? matches.map(({ item }) => item) : ready.annotations;
    return (
        <RightPanelWidget
            id="pdf-annotations"
            title={t("pdf.annotations", { count: ready.annotations.length })}
        >
            <div className="pdf-annotations-list">
                {shown.map((annotation) => (
                    <PdfAnnotationItem
                        key={annotation.id}
                        annotation={annotation}
                        onActivate={activate}
                        onCopyReference={ready.copyReference}
                        tokens={tokens}
                    />
                ))}
            </div>
        </RightPanelWidget>
    );
}

function PdfAnnotationItem({
    annotation,
    onActivate,
    onCopyReference,
    tokens
}: {
    annotation: PdfAnnotationInfo;
    onActivate: (annotation: PdfAnnotationInfo) => void;
    onCopyReference: (annotationId: string, pageNumber: number) => void;
    /** The terms of the filter in force, painted in the texts. */
    tokens?: string[];
}) {
    // Contents on a highlight or a drawing is a remark somebody attached to it, so the row reads
    // as a comment. A free-text box's contents are the box itself, so it keeps its own icon.
    const icon = annotation.contents && annotation.type !== "freetext"
        ? "bx bxs-comment-detail"
        : TYPE_ICONS[annotation.type] ?? "bx bx-comment";
    // A drawing has no text of its own, and a highlight only gets one where the page has
    // extractable glyphs under it — name those by what they are so the row stays clickable.
    const hasText = !!(annotation.highlightedText || annotation.contents);

    return (
        <div
            className={clsx(
                "pdf-annotation-item",
                annotation.color && "tinted",
                isDark(annotation.color) && "tinted-dark"
            )}
            onClick={() => onActivate(annotation)}
            onContextMenu={(e) => showCopyReferenceMenu(e, () => onCopyReference(annotation.id, annotation.pageNumber))}
            style={annotation.color ? { backgroundColor: annotation.color } : undefined}
        >
            <Icon icon={icon} />
            <div className="pdf-annotation-info">
                {!hasText && (
                    <HighlightedText
                        className="pdf-annotation-untitled"
                        text={describeUntitled(annotation)}
                        highlightedTokens={tokens}
                    />
                )}
                {annotation.highlightedText && (
                    <HighlightedText
                        className="pdf-annotation-highlighted-text"
                        text={annotation.highlightedText}
                        highlightedTokens={tokens}
                    />
                )}
                {annotation.contents && (
                    <HighlightedText
                        className="pdf-annotation-contents"
                        text={annotation.contents}
                        highlightedTokens={tokens}
                    />
                )}
                {annotation.author && (
                    <HighlightedText
                        className="pdf-annotation-author"
                        text={annotation.author}
                        highlightedTokens={tokens}
                    />
                )}
            </div>
        </div>
    );
}

/** The text that the row of `annotation` shows, which the filter matches. */
function getAnnotationText(annotation: PdfAnnotationInfo) {
    const hasText = !!(annotation.highlightedText || annotation.contents);
    return [
        hasText ? "" : describeUntitled(annotation),
        annotation.highlightedText,
        annotation.contents,
        annotation.author
    ].filter(Boolean).join("\n");
}

/**
 * Whether a row tinted with this annotation colour needs light text. Highlights are pastel, but
 * the pen draws in black by default, and the dark text a tinted row otherwise gets would vanish
 * on it.
 */
export function isDark(color: string | null) {
    const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color ?? "");
    if (!rgb) return false;

    const [ r, g, b ] = rgb.slice(1).map((component) => parseInt(component, 16));
    // Rec. 601 luma, the usual stand-in for perceived brightness.
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
}

/** Opens the context menu of a page or an annotation in the PDF sidebar. */
export function showCopyReferenceMenu(e: MouseEvent, copyReference: () => void) {
    e.preventDefault();
    void contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: [ { title: t("pdf.copy_reference"), uiIcon: "bx bx-copy", handler: copyReference } ],
        selectMenuItemHandler: () => {}
    });
}

/** Names an annotation that carries no text of its own, by kind and page. */
function describeUntitled({ type, pageNumber }: PdfAnnotationInfo) {
    switch (type) {
        case "ink":
            return t("pdf.annotation_drawing", { pageNumber });
        case "freetext":
            return t("pdf.annotation_text_box", { pageNumber });
        case "highlight":
            return t("pdf.annotation_highlight", { pageNumber });
        default:
            return t("pdf.annotation_note", { pageNumber });
    }
}
