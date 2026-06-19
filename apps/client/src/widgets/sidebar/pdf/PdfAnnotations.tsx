import "./PdfAnnotations.css";

import { t } from "../../../services/i18n";
import { calculateHash } from "../../../services/link";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import toast from "../../../services/toast";
import contextMenu from "../../../menus/context_menu";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import Icon from "../../react/Icon";
import RightPanelWidget from "../RightPanelWidget";

const TYPE_ICONS: Record<string, string> = {
    text: "bx bxs-comment-detail",
    highlight: "bx bx-highlight",
};

const MAX_PREVIEW_LENGTH = 60;

const PRESET_COLORS = [
    { label: "Blue",   value: "#4a90d9" },
    { label: "Yellow", value: "#f5c519" },
    { label: "Green",  value: "#52b788" },
    { label: "Red",    value: "#e63946" },
    { label: "Purple", value: "#9c6ade" },
];

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
                        onSetColor={annotationsData.setAnnotationColor}
                        onDelete={annotationsData.deleteAnnotation}
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
    onSetColor,
    onDelete,
}: {
    annotation: PdfAnnotationInfo;
    noteTitle: string;
    notePath: string;
    onNavigate: (annotationId: string, pageNumber: number) => void;
    onSetColor: (annotationId: string, color: string) => void;
    onDelete: (annotationId: string, pageNumber: number) => void;
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

    function handleContextMenu(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        contextMenu.show({
            x: e.pageX,
            y: e.pageY,
            items: [
                {
                    title: t("pdf.copy_annotation_link"),
                    command: "copyLink",
                    uiIcon: "bx bx-link"
                },
                {
                    title: t("pdf.area_change_color"),
                    command: "changeColor",
                    uiIcon: "bx bx-palette",
                    items: PRESET_COLORS.map((c) => ({
                        title: c.label,
                        command: `color:${c.value}`,
                        uiIcon: "bx bx-circle"
                    }))
                },
                { kind: "separator" },
                {
                    title: t("pdf.annotation_delete"),
                    command: "delete",
                    uiIcon: "bx bx-trash"
                }
            ],
            selectMenuItemHandler: ({ command }) => {
                if (command === "copyLink") {
                    copyLink();
                } else if (command?.startsWith("color:")) {
                    onSetColor(annotation.id, command.slice(6));
                } else if (command === "delete") {
                    onDelete(annotation.id, annotation.pageNumber);
                }
            }
        });
    }

    return (
        <div
            className="pdf-annotation-item"
            onClick={() => onNavigate(annotation.id, annotation.pageNumber)}
            onContextMenu={handleContextMenu}
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
