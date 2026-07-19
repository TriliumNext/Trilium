import "./Attachment.css";

import { ConvertAttachmentToNoteResponse } from "@triliumnext/commons";
import { t } from "i18next";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import FAttachment from "../../entities/fattachment";
import FNote from "../../entities/fnote";
import imageContextMenu from "../../menus/image_context_menu";
import content_renderer from "../../services/content_renderer";
import dialog from "../../services/dialog";
import froca from "../../services/froca";
import image from "../../services/image";
import link, { type ViewScope } from "../../services/link";
import open from "../../services/open";
import options from "../../services/options";
import server from "../../services/server";
import toast from "../../services/toast";
import utils from "../../services/utils";
import ws from "../../services/ws";
import Admonition from "../react/Admonition";
import Button from "../react/Button";
import Dropdown from "../react/Dropdown";
import FormFileUpload from "../react/FormFileUpload";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import HelpButton from "../react/HelpButton";
import { useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import { useImageAttachmentGallery } from "../react/media_viewer/gallery";
import MediaViewer from "../react/media_viewer/MediaViewer";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import { ParentComponent, refToJQuerySelector } from "../react/react_utils";
import { TextPreview } from "./File";
import { TypeWidgetProps } from "./type_widget";

/**
 * Displays the full list of attachments of a note and allows the user to interact with them.
 */
export function AttachmentList({ note }: TypeWidgetProps) {
    const attachments = useAttachments(note);

    // TODO: Extract inline styles to CSS
    return (
        <div style={{display: "flex", flexDirection: "column", height: "100%"}}>
            <AttachmentListHeader noteId={note.noteId} />
            <div style={{overflow: "auto", flexGrow: 1}}>
                {attachments.length ? (
                    <div className="attachment-list-wrapper">
                        {attachments.map(attachment => <AttachmentInfo key={attachment.attachmentId} attachment={attachment} />)}
                    </div>
                ) : (
                    <NoItems icon="bx bx-unlink" text={t("attachment_list.no_attachments")} />
                )}
            </div>
        </div>
    );
}

export function useAttachments(note: FNote) {
    const [ attachments, setAttachments ] = useState<FAttachment[]>([]);

    function refresh() {
        note.getAttachments().then(attachments => setAttachments(Array.from(attachments)));
    }

    useEffect(refresh, [ note ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttachmentRows().some((att) => att.attachmentId && att.ownerId === note.noteId)) {
            refresh();
        }
    });

    return attachments;
}

function AttachmentListHeader({ noteId }: { noteId: string }) {
    const parentComponent = useContext(ParentComponent);

    return (
        <div className="links-wrapper">
            <div>
                {t("attachment_list.owning_note")}{" "}<NoteLink notePath={noteId} />
            </div>
            <div className="attachment-actions-toolbar">
                <Button
                    size="small"
                    icon="bx bx-folder-open"
                    text={t("attachment_list.upload_attachments")}
                    onClick={() => parentComponent?.triggerCommand("showUploadAttachmentsDialog", { noteId })}
                />
                &nbsp;
                <HelpButton
                    helpPage="0vhv7lsOLy82"
                    title={t("attachment_list.open_help_page")}
                />
            </div>
        </div>
    );
}

/**
 * Displays information about a single attachment.
 */
export function AttachmentDetail({ note, viewScope, noteContext, isVisible }: TypeWidgetProps) {
    const [ attachment, setAttachment ] = useState<FAttachment | null | undefined>(undefined);

    useEffect(() => {
        if (!viewScope?.attachmentId) return;
        froca.getAttachment(viewScope.attachmentId).then(setAttachment);
    }, [ viewScope ]);

    return (
        <>
            <div className="links-wrapper use-tn-links">
                {t("attachment_detail.owning_note")}{" "}
                <NoteLink notePath={note.noteId} />
                {t("attachment_detail.you_can_also_open")}{" "}
                <NoteLink
                    notePath={note.noteId}
                    viewScope={{ viewMode: "attachments" }}
                    title={t("attachment_detail.list_of_all_attachments")}
                />
                <HelpButton
                    helpPage="0vhv7lsOLy82"
                    title={t("attachment_list.open_help_page")}
                />
            </div>

            <div className="attachment-wrapper">
                {attachment !== null ? (
                    attachment && <AttachmentInfo attachment={attachment} isFullDetail ownerNote={note} noteContext={noteContext} viewScope={viewScope} isVisible={isVisible} />
                ) : (
                    <strong>{t("attachment_detail.attachment_deleted")}</strong>
                )}
            </div>
        </>
    );
}

function AttachmentInfo({ attachment, isFullDetail, ownerNote, noteContext, viewScope, isVisible }: { attachment: FAttachment, isFullDetail?: boolean, ownerNote?: FNote, noteContext?: NoteContext, viewScope?: ViewScope, isVisible?: boolean }) {
    const contentWrapper = useRef<HTMLDivElement>(null);
    const imageViewerWrapper = useRef<HTMLDivElement>(null);
    const hiddenImageCopyRef = useRef<HTMLDivElement>(null);
    const [ title, setTitle ] = useState(attachment.title);
    const [ textContent, setTextContent ] = useState<string | null>(null);
    // Tracked in state so the deletion warning reacts to entity reloads. The FAttachment is mutated
    // in place by froca, so reading it directly during render wouldn't re-render an image attachment
    // (whose title/content don't change when only the erasure schedule does).
    const [ scheduledForErasureSince, setScheduledForErasureSince ] = useState(attachment.utcDateScheduledForErasureSince);
    // "importSource" attachments (e.g. OneNote debug source) behave like ordinary files for
    // preview, OCR and link-copying purposes.
    const isFileLike = attachment.role === "file" || attachment.role === "importSource";
    const supportsOcr = attachment.role === "image" || isFileLike;

    // Image attachments opened in full detail get the interactive zoom/pan viewer; everything
    // else is rendered imperatively via the content renderer.
    const isZoomableImage = !!isFullDetail && attachment.role === "image";
    // Unversioned (no `?v=`): this URL is also what copy-reference persists into note content, and
    // stored notes must not pin a version — the server revalidates it via ETag instead.
    const imageSrc = `api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}`;
    const gallery = useImageAttachmentGallery(ownerNote, noteContext, viewScope);
    // The component instance persists while cycling attachments (only props change), so mount-time
    // closures (the Electron context menu) must read the current state through a ref.
    const galleryRef = useRef(gallery);
    galleryRef.current = gallery;

    /** Unmounts whatever the content renderer previously mounted here (a media player), so that replacing
     *  or discarding the content doesn't leak its Preact root — or leave its audio playing. */
    function disposeContent() {
        const wrapper = contentWrapper.current;
        if (wrapper) content_renderer.disposeInteractiveContent($(wrapper));
    }

    function refresh() {
        if (!isZoomableImage) {
            // The full-detail view gets the pdf.js toolbar; list-view previews stay bare.
            content_renderer.getRenderedContent(attachment, { pdfToolbar: !!isFullDetail })
                .then(({ $renderedContent }) => {
                    disposeContent();
                    contentWrapper.current?.replaceChildren(...$renderedContent);
                });
        }

        if (isFileLike) {
            attachment.getBlob().then(blob => setTextContent(blob?.content ?? null));
        }

        setTitle(attachment.title);
        setScheduledForErasureSince(attachment.utcDateScheduledForErasureSince);
    }

    useEffect(() => {
        refresh();
        return disposeContent;
    }, [ attachment, isZoomableImage ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttachmentRows().find(attachment => attachment.attachmentId)) {
            refresh();
        }
    });

    // (Hoisted function declaration below; the ref keeps the menu closure reading the fresh one.)
    const copyReferenceRef = useRef(copyAttachmentReferenceToClipboard);
    copyReferenceRef.current = copyAttachmentReferenceToClipboard;

    // Electron right-click menu (copy image / reference) for the interactive image viewer.
    useEffect(() => {
        if (isZoomableImage) {
            return imageContextMenu.setupContextMenu(refToJQuerySelector(imageViewerWrapper), {
                getSrc: () => galleryRef.current.items[galleryRef.current.currentIndex]?.src,
                copyReference: () => void copyReferenceRef.current()
            });
        }
    }, [ isZoomableImage ]);

    async function copyAttachmentReferenceToClipboard() {
        if (attachment.role === "image") {
            if (isZoomableImage) {
                // The viewer's source list carries data-src only; stage clean `<img>` markup instead.
                const wrapper = hiddenImageCopyRef.current;
                if (!wrapper) return;
                const imageEl = document.createElement("img");
                imageEl.src = imageSrc;
                wrapper.replaceChildren(imageEl);
                image.copyImageReferenceToClipboard(refToJQuerySelector(hiddenImageCopyRef));
                wrapper.removeChild(imageEl);
                return;
            }
            const $img = refToJQuerySelector(contentWrapper).find("img");
            if ($img.length) image.copyImageReferenceToClipboard($img.parent());
        } else if (isFileLike) {
            const $link = await link.createLink(attachment.ownerId, {
                referenceLink: true,
                viewScope: {
                    viewMode: "attachments",
                    attachmentId: attachment.attachmentId
                }
            });

            utils.copyHtmlToClipboard($link[0].outerHTML);

            toast.showMessage(t("attachment_detail_2.link_copied"));
        } else {
            throw new Error(t("attachment_detail_2.unrecognized_role", { role: attachment.role }));
        }
    }

    return (
        <div className="attachment-detail-widget">
            <div className={`attachment-detail-wrapper ${isFullDetail ? "full-detail" : "list-view"} ${scheduledForErasureSince ? "scheduled-for-deletion" : ""}`}>
                <div className="attachment-title-line">
                    <AttachmentActions
                        attachment={attachment}
                        copyAttachmentReferenceToClipboard={copyAttachmentReferenceToClipboard}
                        onShowOcr={supportsOcr ? () => appContext.triggerCommand("showOcrTextDialog", {
                            textUrl: `ocr/attachments/${attachment.attachmentId}/text`,
                            processUrl: `ocr/process-attachment/${attachment.attachmentId}`
                        }) : undefined}
                    />
                    <h4 className="attachment-title">
                        {!isFullDetail ? (
                            <NoteLink
                                notePath={attachment.ownerId}
                                title={title}
                                viewScope={{
                                    viewMode: "attachments",
                                    attachmentId: attachment.attachmentId
                                }}
                            />
                        ) : title}
                    </h4>
                    <div className="attachment-details">
                        {t("attachment_detail_2.role_and_size", {
                            role: attachment.role,
                            size: utils.formatSize(attachment.contentLength),
                            mimeType: attachment.mime
                        })}
                    </div>
                    <div style="flex: 1 1;" />
                </div>

                {scheduledForErasureSince && <DeletionAlert utcDateScheduledForErasureSince={scheduledForErasureSince} />}
                {textContent && <TextPreview content={textContent} />}
                {isZoomableImage ? (
                    <div key="image-viewer" ref={imageViewerWrapper} className="attachment-content-wrapper attachment-image-viewer">
                        <MediaViewer
                            gallery={gallery}
                            noteContext={noteContext}
                            isVisible={isVisible}
                            onCopyReference={() => void copyAttachmentReferenceToClipboard()}
                        />
                        <div ref={hiddenImageCopyRef} className="hidden-image-copy" />
                    </div>
                ) : (
                    <div key="rendered" ref={contentWrapper} className="attachment-content-wrapper" />
                )}
            </div>

        </div>
    );
}

function DeletionAlert({ utcDateScheduledForErasureSince }: { utcDateScheduledForErasureSince: string }) {
    const scheduledSinceTimestamp = utils.parseDate(utcDateScheduledForErasureSince)?.getTime();
    // use default value (30 days in seconds) from options_init as fallback, in case getInt returns null
    const intervalMs = (options.getInt("eraseUnusedAttachmentsAfterSeconds") || 2592000) * 1000;
    const deletionTimestamp = scheduledSinceTimestamp + intervalMs;
    const willBeDeletedInMs = deletionTimestamp - Date.now();

    return (
        <Admonition className="attachment-deletion-warning" type="warning">
            { willBeDeletedInMs >= 60000
                ? t("attachment_detail_2.will_be_deleted_in", { time: utils.formatTimeInterval(willBeDeletedInMs) })
                : t("attachment_detail_2.will_be_deleted_soon")}
            {t("attachment_detail_2.deletion_reason")}
        </Admonition>
    );
}

function AttachmentActions({ attachment, copyAttachmentReferenceToClipboard, onShowOcr }: { attachment: FAttachment, copyAttachmentReferenceToClipboard: () => void, onShowOcr?: () => void }) {
    const isElectron = utils.isElectron();
    const fileUploadRef = useRef<HTMLInputElement>(null);

    return (
        <div className="attachment-actions-container">
            <Dropdown
                className="attachment-actions"
                text={<Icon icon="bx bx-dots-vertical-rounded" />}
                buttonClassName="icon-action-always-border"
                iconAction
                dropdownContainerClassName="mobile-bottom-menu"
                mobileBackdrop
            >
                <FormListItem
                    icon="bx bx-file-find"
                    title={t("attachments_actions.open_externally_title")}
                    onClick={() => open.openAttachmentExternally(attachment.attachmentId, attachment.mime)}
                >{t("attachments_actions.open_externally")}</FormListItem>
                <FormListItem
                    icon="bx bx-customize"
                    title={t("attachments_actions.open_custom_title")}
                    onClick={() => open.openAttachmentCustom(attachment.attachmentId, attachment.mime)}
                    disabled={!isElectron}
                    disabledTooltip={!isElectron ? t("attachments_actions.open_custom_client_only") : t("attachments_actions.open_externally_detail_page")}
                >{t("attachments_actions.open_custom")}</FormListItem>
                <FormListItem
                    icon="bx bx-download"
                    onClick={() => open.downloadAttachment(attachment.attachmentId)}
                >{t("attachments_actions.download")}</FormListItem>
                <FormListItem
                    icon="bx bx-copy"
                    onClick={copyAttachmentReferenceToClipboard}
                >{t("attachments_actions.copy_link_to_clipboard")}</FormListItem>
                {onShowOcr && (
                    <FormListItem
                        icon="bx bx-text"
                        onClick={onShowOcr}
                    >{t("ocr.view_extracted_text")}</FormListItem>
                )}
                <FormDropdownDivider />

                <FormListItem
                    icon="bx bx-upload"
                    onClick={() => fileUploadRef.current?.click()}
                >{t("attachments_actions.upload_new_revision")}</FormListItem>
                <FormListItem
                    icon="bx bx-rename"
                    onClick={async () => {
                        const attachmentTitle = await dialog.prompt({
                            title: t("attachments_actions.rename_attachment"),
                            message: t("attachments_actions.enter_new_name"),
                            defaultValue: attachment.title
                        });

                        if (!attachmentTitle?.trim()) return;
                        await server.put(`attachments/${attachment.attachmentId}/rename`, { title: attachmentTitle });
                    }}
                >{t("attachments_actions.rename_attachment")}</FormListItem>
                <FormListItem
                    icon="bx bx-trash destructive-action-icon"
                    onClick={async () => {
                        if (!(await dialog.confirm(t("attachments_actions.delete_confirm", { title: attachment.title })))) {
                            return;
                        }

                        await server.remove(`attachments/${attachment.attachmentId}`);
                        toast.showMessage(t("attachments_actions.delete_success", { title: attachment.title }));
                    }}
                >{t("attachments_actions.delete_attachment")}</FormListItem>
                <FormDropdownDivider />

                <FormListItem
                    icon="bx bx-note"
                    onClick={async () => {
                        if (!(await dialog.confirm(t("attachments_actions.convert_confirm", { title: attachment.title })))) {
                            return;
                        }

                        const { note: newNote } = await server.post<ConvertAttachmentToNoteResponse>(`attachments/${attachment.attachmentId}/convert-to-note`);
                        toast.showMessage(t("attachments_actions.convert_success", { title: attachment.title }));
                        await ws.waitForMaxKnownEntityChangeId();
                        await appContext.tabManager.getActiveContext()?.setNote(newNote.noteId);
                    }}
                >{t("attachments_actions.convert_attachment_into_note")}</FormListItem>

                <FormFileUpload
                    inputRef={fileUploadRef}
                    hidden
                    onChange={async files => {
                        const fileToUpload = files?.item(0);
                        if (fileToUpload) {
                            const result = await server.upload(`attachments/${attachment.attachmentId}/file`, fileToUpload);
                            if (result.uploaded) {
                                toast.showMessage(t("attachments_actions.upload_success"));
                            } else {
                                toast.showError(t("attachments_actions.upload_failed"));
                            }
                        }
                    }}
                />
            </Dropdown>
        </div>
    );
}
