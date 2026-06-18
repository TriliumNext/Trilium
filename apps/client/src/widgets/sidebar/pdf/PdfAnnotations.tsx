import "./PdfAnnotations.css";

import { t } from "../../../services/i18n";
import { calculateHash } from "../../../services/link";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import toast from "../../../services/toast";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import Icon from "../../react/Icon";
import RightPanelWidget from "../RightPanelWidget";

const TYPE_ICONS: Record<string, string> = {
    text: "bx bxs-comment-detail",
    highlight: "bx bx-highlight",
};

const MAX_PREVIEW_LENGTH = 60;

export default function PdfAnnotations() {
    const { note, noteContext } = useActiveNoteContext();
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
                        noteTitle={note?.title ?? ""}
                        notePath={noteContext?.notePath ?? ""}
                        onNavigate={annotationsData.scrollToAnnotation}
                    />
                ))}
            </div>
        </RightPanelWidget>
    );
}

function PdfAnnotationItem({
    annotation,
    noteTitle,
    notePath,
    onNavigate
}: {
    annotation: PdfAnnotationInfo;
    noteTitle: string;
    notePath: string;
    onNavigate: (annotationId: string, pageNumber: number) => void;
}) {
    const icon = annotation.contents
        ? "bx bxs-comment-detail"
        : TYPE_ICONS[annotation.type] ?? "bx bx-comment";

    function handleCopyLink(e: MouseEvent) {
        e.stopPropagation();

        const rawPreview = (annotation.highlightedText || annotation.contents).trim();
        const annotationPreview = rawPreview.length > MAX_PREVIEW_LENGTH
            ? `${rawPreview.substring(0, MAX_PREVIEW_LENGTH)}…`
            : rawPreview || undefined;

        const hash = calculateHash({
            notePath,
            viewScope: { annotationId: annotation.id, annotationPage: annotation.pageNumber, annotationPreview }
        });

        const linkTitle = annotationPreview
            ? `${noteTitle} › "${annotationPreview}"`
            : `${noteTitle} (annotation)`;

        // Build a temporary reference link element and copy it via execCommand.
        // execCommand works without a secure context (HTTPS), unlike ClipboardItem.
        // When pasted into a CKEditor text note the <a class="reference-link"> is
        // upcast to a reference link widget that navigates to the annotation on click.
        const $tmp = $('<a class="reference-link">')
            .attr("href", hash)
            .text(linkTitle)
            .attr("contenteditable", "true")
            .css({ position: "fixed", left: "-9999px", top: "0" })
            .appendTo(document.body);

        try {
            const range = document.createRange();
            range.selectNodeContents($tmp[0]);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);

            if (document.execCommand("copy")) {
                toast.showMessage(t("pdf.annotation_link_copied"));
            } else {
                copyTextWithToast(hash);
            }
        } finally {
            window.getSelection()?.removeAllRanges();
            $tmp.remove();
        }
    }

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
            <button
                className="pdf-annotation-copy-link"
                title={t("pdf.copy_annotation_link")}
                onClick={handleCopyLink}
            >
                <Icon icon="bx bx-link" />
            </button>
        </div>
    );
}
