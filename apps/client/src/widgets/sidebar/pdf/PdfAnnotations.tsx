import "./PdfAnnotations.css";

import clsx from "clsx";

import { t } from "../../../services/i18n";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import Icon from "../../react/Icon";
import RightPanelWidget from "../RightPanelWidget";

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

    if (noteType !== "file" || noteMime !== "application/pdf") {
        return null;
    }

    if (!annotationsData || annotationsData.annotations.length === 0) {
        return null;
    }

    return (
        <RightPanelWidget id="pdf-annotations" title={t("pdf.annotations", { count: annotationsData.annotations.length })}>
            <div className="pdf-annotations-list">
                {annotationsData.annotations.map((annotation) => (
                    <PdfAnnotationItem
                        key={annotation.id}
                        annotation={annotation}
                        onNavigate={annotationsData.scrollToAnnotation}
                    />
                ))}
            </div>
        </RightPanelWidget>
    );
}

function PdfAnnotationItem({
    annotation,
    onNavigate
}: {
    annotation: PdfAnnotationInfo;
    onNavigate: (annotationId: string, pageNumber: number) => void;
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
            onClick={() => onNavigate(annotation.id, annotation.pageNumber)}
            style={annotation.color ? { backgroundColor: annotation.color } : undefined}
        >
            <Icon icon={icon} />
            <div className="pdf-annotation-info">
                {!hasText && (
                    <div className="pdf-annotation-untitled">{describeUntitled(annotation)}</div>
                )}
                {annotation.highlightedText && (
                    <div className="pdf-annotation-highlighted-text">{annotation.highlightedText}</div>
                )}
                {annotation.contents && (
                    <div className="pdf-annotation-contents">{annotation.contents}</div>
                )}
                {annotation.author && (
                    <div className="pdf-annotation-author">{annotation.author}</div>
                )}
            </div>
        </div>
    );
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
