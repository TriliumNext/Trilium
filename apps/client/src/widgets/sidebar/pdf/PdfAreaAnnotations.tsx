import "./PdfAreaAnnotations.css";

import { t } from "../../../services/i18n";
import { calculateHash } from "../../../services/link";
import { copyRichText, copyTextWithToast } from "../../../services/clipboard_ext";
import toast from "../../../services/toast";
import contextMenu from "../../../menus/context_menu";
import { textPrompt } from "../../../services/textPrompt";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import { PDF_ANNOTATION_COLORS } from "./pdfAnnotationColors";
import Icon from "../../react/Icon";
import RightPanelWidget from "../RightPanelWidget";

const PRESET_COLORS = PDF_ANNOTATION_COLORS;

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
        const html = $('<figure class="image">')
            .append(
                $('<a>').attr("href", hash).append(
                    $('<img>')
                        .attr("src", annotation.imageUrl)
                        .attr("alt", t("pdf.area_annotation_label", { page: annotation.pageNumber }))
                )
            )[0].outerHTML;

        // Fall back to the navigable hash link, not the bare image URL — the latter
        // would silently drop the ability to jump back to this annotation.
        if (copyRichText(html, hash)) {
            toast.showMessage(t("pdf.annotation_link_copied"));
        } else {
            copyTextWithToast(hash);
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
                        uiIcon: `bx bx-circle ${c.cssClass}`
                    }))
                },
                { kind: "separator" },
                {
                    title: t("pdf.area_annotation_delete"),
                    command: "delete",
                    uiIcon: "bx bx-trash"
                }
            ],
            selectMenuItemHandler: async ({ command }) => {
                if (command === "copyLink") {
                    doCopyLink();
                } else if (command === "editNote") {
                    const current = annotation.comment ?? "";
                    const entered = await textPrompt(t("pdf.area_note_prompt"), current);
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
