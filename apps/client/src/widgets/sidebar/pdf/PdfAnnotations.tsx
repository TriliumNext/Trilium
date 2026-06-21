import "./PdfAnnotations.css";

import { useEffect } from "preact/hooks";
import { t } from "../../../services/i18n";
import { calculateHash } from "../../../services/link";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import toast from "../../../services/toast";
import contextMenu from "../../../menus/context_menu";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import Icon from "../../react/Icon";
import RightPanelWidget from "../RightPanelWidget";
import { PDF_ANNOTATION_COLORS } from "./pdfAnnotationColors";

const TYPE_ICONS: Record<string, string> = {
    text: "bx bxs-comment-detail",
    highlight: "bx bx-highlight",
};

const MAX_PREVIEW_LENGTH = 60;
const PRESET_COLORS = PDF_ANNOTATION_COLORS;

export default function PdfAnnotations() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const annotationsData = useGetContextData("pdfAnnotations");

    // Use jQuery document delegation instead of Preact's onContextMenu — the legacy
    // widget wrapper can swallow Preact synthetic events before they fire.
    useEffect(() => {
        if (!annotationsData) return;

        const handler = (e: JQuery.ContextMenuEvent) => {
            const $item = $(e.target as HTMLElement).closest(".pdf-annotation-item[data-annotation-id]");
            if (!$item.length) return;

            e.preventDefault();
            e.stopPropagation();

            const annotationId = $item.attr("data-annotation-id");
            if (!annotationId) return;
            const annotation = annotationsData.annotations.find((a) => a.id === annotationId);
            const notePath = noteContext?.notePath ?? "";
            const noteTitleVal = note?.title ?? "";
            if (!annotation) return;

            const rawPreview = (annotation.highlightedText || annotation.contents).trim();
            const annotationPreview = rawPreview.length > MAX_PREVIEW_LENGTH
                ? `${rawPreview.substring(0, MAX_PREVIEW_LENGTH)}…`
                : rawPreview || undefined;
            const hash = calculateHash({
                notePath,
                viewScope: { annotationId: annotation.id, annotationPage: annotation.pageNumber, annotationPreview }
            });
            const linkTitle = annotationPreview
                ? `${noteTitleVal} › "${annotationPreview}"`
                : `${noteTitleVal} (annotation)`;

            contextMenu.show({
                x: e.pageX,
                y: e.pageY,
                items: [
                    { title: t("pdf.copy_annotation_link"), command: "copyLink", uiIcon: "bx bx-link" },
                    {
                        title: t("pdf.area_change_color"), command: "changeColor", uiIcon: "bx bx-palette",
                        items: PRESET_COLORS.map((c) => ({ title: c.label, command: `color:${c.value}`, uiIcon: `bx bx-circle ${c.cssClass}` }))
                    },
                    { kind: "separator" },
                    { title: t("pdf.annotation_delete"), command: "delete", uiIcon: "bx bx-trash" }
                ],
                selectMenuItemHandler: ({ command }) => {
                    if (command === "copyLink") {
                        const $tmp = $('<a class="reference-link">')
                            .attr("href", hash).text(linkTitle)
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
                    } else if (command?.startsWith("color:")) {
                        annotationsData.setAnnotationColor(annotation.id, command.slice(6));
                    } else if (command === "delete") {
                        annotationsData.deleteAnnotation(annotation.id, annotation.pageNumber);
                    }
                }
            });
        };

        $(document).on("contextmenu.pdf-text-annotations", ".pdf-annotations-list .pdf-annotation-item", handler);
        return () => { $(document).off("contextmenu.pdf-text-annotations"); };
    }, [annotationsData, noteContext, note]);

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
    onNavigate,
}: {
    annotation: PdfAnnotationInfo;
    noteTitle: string;
    notePath: string;
    onNavigate: (annotationId: string, pageNumber: number) => void;
}) {
    const icon = annotation.contents
        ? "bx bxs-comment-detail"
        : TYPE_ICONS[annotation.type] ?? "bx bx-comment";

    function buildHash() {
        const rawPreview = (annotation.highlightedText || annotation.contents).trim();
        const annotationPreview = rawPreview.length > MAX_PREVIEW_LENGTH
            ? `${rawPreview.substring(0, MAX_PREVIEW_LENGTH)}…`
            : rawPreview || undefined;

        return {
            hash: calculateHash({
                notePath,
                viewScope: { annotationId: annotation.id, annotationPage: annotation.pageNumber, annotationPreview }
            }),
            linkTitle: annotationPreview
                ? `${noteTitle} › "${annotationPreview}"`
                : `${noteTitle} (annotation)`,
        };
    }

    function copyLink() {
        const { hash, linkTitle } = buildHash();

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

    function handleCopyLink(e: MouseEvent) {
        e.stopPropagation();
        copyLink();
    }

    return (
        <div
            className="pdf-annotation-item"
            data-annotation-id={annotation.id}
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
