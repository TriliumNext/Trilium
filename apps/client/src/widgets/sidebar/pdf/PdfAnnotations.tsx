import "./PdfAnnotations.css";

import { t } from "../../../services/i18n";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import Icon from "../../react/Icon";
import RightPanelWidget from "../RightPanelWidget";

const TYPE_ICONS: Record<string, string> = {
    text: "bx bxs-comment-detail",
    highlight: "bx bx-highlight",
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
    const icon = annotation.contents
        ? "bx bxs-comment-detail"
        : TYPE_ICONS[annotation.type] ?? "bx bx-comment";

    return (
        <div
            className="pdf-annotation-item"
            onClick={() => onNavigate(annotation.id, annotation.pageNumber)}
            style={annotation.color ? { backgroundColor: annotation.color } : undefined}
        >
            <Icon icon={icon} />
            <div className="pdf-annotation-info">
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
