import "./PdfAreaAnnotations.css";

import { t } from "../../../services/i18n";
import { calculateHash } from "../../../services/link";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import toast from "../../../services/toast";
import contextMenu from "../../../menus/context_menu";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import Icon from "../../react/Icon";
import RightPanelWidget from "../RightPanelWidget";

const PRESET_COLORS = [
    { label: "Blue",   value: "#4a90d9" },
    { label: "Yellow", value: "#f5c519" },
    { label: "Green",  value: "#52b788" },
    { label: "Red",    value: "#e63946" },
    { label: "Purple", value: "#9c6ade" },
];

export default function PdfAreaAnnotations() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const data = useGetContextData("pdfAreaAnnotations");

    if (noteType !== "file" || noteMime !== "application/pdf") return null;
    if (!data || data.annotations.length === 0) return null;

    return (
        <RightPanelWidget
            id="pdf-area-annotations"
            title={t("pdf.area_annotations", { count: data.annotations.length })}
        >
            <div className="pdf-area-annotations-list">
                {data.annotations.map((ann) => (
                    <PdfAreaAnnotationItem
                        key={ann.attachmentId}
                        annotation={ann}
                        notePath={noteContext?.notePath ?? ""}
                        onNavigate={data.scrollToArea}
                        onDelete={data.deleteArea}
                        onUpdate={data.updateArea}
                    />
                ))}
            </div>
        </RightPanelWidget>
    );
}

function PdfAreaAnnotationItem({
    annotation, notePath, onNavigate, onDelete, onUpdate
}: {
    annotation: PdfAreaAnnotationInfo;
    notePath: string;
    onNavigate: (page: number, rect: PdfAreaAnnotationInfo["rect"]) => void;
    onDelete: (attachmentId: string, attributeId: string) => void;
    onUpdate: (attributeId: string, patch: { comment?: string; color?: string }) => void;
}) {
    const color = annotation.color ?? "#4a90d9";

    // Shared copy logic — called from both the hover button and the context menu.
    function doCopyLink() {
        const hash = calculateHash({
            notePath,
            viewScope: {
                annotationId: `area:${annotation.attachmentId}`,
                annotationPage: annotation.pageNumber,
            }
        });

        // Paste as <figure class="image"><a href="hash"><img src="..."></a></figure>:
        // • ImageResize plugin gives resize handles in CKEditor.
        // • The <a> makes it a linked image — clicking navigates to the PDF area.
        // • The <img src> loads the existing attachment; no new note is created.
        const $wrapper = $('<div contenteditable="true">')
            .css({ position: "fixed", left: "-9999px", top: "0" })
            .appendTo(document.body);

        $('<figure class="image">')
            .append(
                $('<a>').attr("href", hash).append(
                    $('<img>')
                        .attr("src", annotation.imageUrl)
                        .attr("alt", t("pdf.area_annotation_label", { page: annotation.pageNumber }))
                )
            )
            .appendTo($wrapper);

        try {
            const range = document.createRange();
            range.selectNodeContents($wrapper[0]);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            if (document.execCommand("copy")) {
                toast.showMessage(t("pdf.annotation_link_copied"));
            } else {
                copyTextWithToast(annotation.imageUrl);
            }
        } finally {
            window.getSelection()?.removeAllRanges();
            $wrapper.remove();
        }
    }

    function handleCopyLink(e: MouseEvent) {
        e.stopPropagation();
        doCopyLink();
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
                { kind: "separator" },
                {
                    title: annotation.comment
                        ? t("pdf.area_edit_note")
                        : t("pdf.area_add_note"),
                    command: "editNote",
                    uiIcon: "bx bx-comment-add"
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
                    title: t("pdf.area_annotation_delete"),
                    command: "delete",
                    uiIcon: "bx bx-trash"
                }
            ],
            selectMenuItemHandler: ({ command }) => {
                if (command === "copyLink") {
                    doCopyLink();
                } else if (command === "editNote") {
                    const current = annotation.comment ?? "";
                    const entered = window.prompt(t("pdf.area_note_prompt"), current);
                    if (entered !== null) {
                        onUpdate(annotation.attributeId, { comment: entered.trim() });
                    }
                } else if (command?.startsWith("color:")) {
                    onUpdate(annotation.attributeId, { color: command.slice(6) });
                } else if (command === "delete") {
                    onDelete(annotation.attachmentId, annotation.attributeId);
                }
            }
        });
    }

    return (
        <div
            className="pdf-area-annotation-item"
            onClick={() => onNavigate(annotation.pageNumber, annotation.rect)}
            onContextMenu={handleContextMenu}
        >
            {/* Colour stripe along the left edge */}
            <div className="pdf-area-annotation-color-bar" style={{ background: color }} />

            <img
                className="pdf-area-annotation-thumbnail"
                src={annotation.imageUrl}
                alt={t("pdf.area_annotation_label", { page: annotation.pageNumber })}
                loading="lazy"
            />

            {/* Enlarged preview centred in viewport on hover */}
            <img
                className="pdf-area-annotation-zoom"
                src={annotation.imageUrl}
                alt=""
                aria-hidden="true"
            />

            <div className="pdf-area-annotation-meta">
                <span className="pdf-area-annotation-page">
                    {t("pdf.area_annotation_label", { page: annotation.pageNumber })}
                </span>
                {annotation.comment && (
                    <span className="pdf-area-annotation-comment">{annotation.comment}</span>
                )}
            </div>

            <div className="pdf-area-annotation-actions">
                <button
                    className="pdf-area-annotation-btn"
                    title={t("pdf.copy_annotation_link")}
                    onClick={handleCopyLink}
                >
                    <Icon icon="bx bx-link" />
                </button>
            </div>
        </div>
    );
}
