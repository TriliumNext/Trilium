import "./Attachment.css";

import { attachmentIcon, ConvertAttachmentToNoteResponse, isImageAttachmentRole } from "@triliumnext/commons";
import { t } from "i18next";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import FAttachment from "../../entities/fattachment";
import FNote from "../../entities/fnote";
import imageContextMenu from "../../menus/image_context_menu";
import { partitionAttachmentsByGroup } from "../../services/attachment_groups";
import { attachmentRoleLabel } from "../../services/attachment_role_names";
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
import { showImageCompressionDialog } from "../dialogs/image_compression/image_compression_dialog";
import ActionButton from "../react/ActionButton";
import { Badge } from "../react/Badge";
import Button from "../react/Button";
import { ExternallyControlledCollapsible } from "../react/Collapsible";
import Dropdown from "../react/Dropdown";
import FormFileUpload from "../react/FormFileUpload";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import HelpButton from "../react/HelpButton";
import { useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import ImageViewer from "../react/ImageViewer";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import { ParentComponent, refToJQuerySelector } from "../react/react_utils";
import SiblingNavigator from "../react/SiblingNavigator";
import { TextPreview } from "./File";
import MediaPreview from "./file/MediaPreview";
import { TypeWidgetProps } from "./type_widget";

/**
 * Displays the full list of attachments of a note and allows the user to interact with them.
 */
export function AttachmentList({ note }: TypeWidgetProps) {
    const attachments = useAttachments(note);
    const groups = useMemo(() => partitionAttachmentsByGroup(attachments), [ attachments ]);
    // Nothing to fold away until the app has made an attachment of its own, which most notes never give
    // it reason to — so an ordinary note's list looks exactly as it did.
    const hasFoldedAway = groups.system.length > 0;

    return (
        <div className="attachment-list-container">
            <AttachmentListHeader noteId={note.noteId} />
            <div className="attachment-list-body">
                {groups.user.length ? (
                    <AttachmentGrid attachments={groups.user} />
                ) : (
                    <NoItems
                        icon="bx bx-unlink"
                        // "No attachments" would be a plain untruth on a note carrying a preview's
                        // pictures, and the row saying otherwise is folded shut directly underneath —
                        // so where there is one, the placeholder says what is missing (anything of the
                        // note's own) and where the rest of it went.
                        text={hasFoldedAway ? t("attachment_list.no_user_attachments") : t("attachment_list.no_attachments")}
                        // Where something is folded away underneath, the placeholder gives up the room
                        // it would otherwise fill and settles directly above the row offering it: the two
                        // are one answer to what the note is carrying, and a placeholder centred in the
                        // pane leaves the other half of that answer at the bottom edge. Small for the
                        // same reason — a 4em mark over a single line, with the row tucked under it,
                        // is a lot of furniture for a note that has nothing of its own.
                        size={hasFoldedAway ? "small" : "normal"}
                        className={hasFoldedAway ? "beside-folded-away" : undefined}
                    />
                )}
                {/* Keyed by the note so that moving to another one starts folded again, whatever was
                    opened on the last. */}
                {hasFoldedAway && <SystemAttachments key={note.noteId} attachments={groups.system} />}
            </div>
        </div>
    );
}

/** The cards themselves, in the order the group came in. */
function AttachmentGrid({ attachments }: { attachments: FAttachment[] }) {
    return (
        <div className="attachment-list-wrapper">
            {attachments.map(attachment => <AttachmentInfo key={attachment.attachmentId} attachment={attachment} />)}
        </div>
    );
}

/**
 * What the app made for itself, folded away under what the reader placed.
 *
 * A disclosure rather than a second half of a switcher: these are not an alternative view of the note's
 * attachments but a footnote to them, and giving them a button of their own equal to the reader's own
 * made every note carrying a single link preview open on a mode chooser. Folded always, on every note —
 * the count says how much is behind it, which is as much as someone who is not looking for them needs.
 *
 * The cards are not built until it is first opened. Each one fetches its content and renders a preview,
 * and a link-heavy note carries more of these than of anything else; a collapsed section that has
 * loaded all of them costs the same as the old switcher did on the tab nobody chose.
 */
function SystemAttachments({ attachments }: { attachments: FAttachment[] }) {
    const [ expanded, setExpanded ] = useState(false);
    // Kept mounted once opened, so folding it back does not throw away what was just loaded.
    const [ everExpanded, setEverExpanded ] = useState(false);

    return (
        <ExternallyControlledCollapsible
            className="attachment-system-group"
            /* `amount` rather than i18next's `count`, which would pull the label into the plural
               machinery — the number here is parenthetical, not a counted noun, so the sentence is the
               same either way and the pair of identical English forms would be noise for translators. */
            title={t("attachment_list.system_group", { amount: attachments.length })}
            expanded={expanded}
            setExpanded={(newExpanded) => {
                if (newExpanded) setEverExpanded(true);
                setExpanded(newExpanded);
            }}
        >
            {everExpanded && <AttachmentGrid attachments={attachments} />}
        </ExternallyControlledCollapsible>
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
                <ActionButton
                    icon="bx bx-collapse-alt"
                    text={t("compress-images")}
                    onClick={() => void showImageCompressionDialog({ type: "note", noteId })}
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
export function AttachmentDetail({ note, viewScope, noteContext }: TypeWidgetProps) {
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
                    attachment && <AttachmentInfo attachment={attachment} isFullDetail ownerNote={note} noteContext={noteContext} viewScope={viewScope} />
                ) : (
                    <strong>{t("attachment_detail.attachment_deleted")}</strong>
                )}
            </div>
        </>
    );
}

function AttachmentInfo({ attachment, isFullDetail, ownerNote, noteContext, viewScope }: { attachment: FAttachment, isFullDetail?: boolean, ownerNote?: FNote, noteContext?: NoteContext, viewScope?: ViewScope }) {
    const contentWrapper = useRef<HTMLDivElement>(null);
    const imageViewerWrapper = useRef<HTMLDivElement>(null);
    const [ title, setTitle ] = useState(attachment.title);
    const [ textContent, setTextContent ] = useState<string | null>(null);
    // Tracked in state so the deletion warning reacts to entity reloads. The FAttachment is mutated
    // in place by froca, so reading it directly during render wouldn't re-render an image attachment
    // (whose title/content don't change when only the erasure schedule does).
    const [ scheduledForErasureSince, setScheduledForErasureSince ] = useState(attachment.utcDateScheduledForErasureSince);
    // Same reason, for the content itself: replacing an attachment changes neither its id nor its title, so
    // without this nothing here re-renders and the viewer/player would keep showing what it first loaded.
    const [ modified, setModified ] = useState(attachment.utcDateModified);
    // "importSource" attachments (e.g. OneNote debug source) behave like ordinary files for
    // preview, OCR and link-copying purposes.
    const isFileLike = attachment.role === "file" || attachment.role === "importSource";
    const isPicture = isImageAttachmentRole(attachment.role);
    // A link preview's pictures are deliberately left out: the server already sized both, and both
    // belong to a preview rather than to the note, so reading text out of them — or offering to
    // recompress them further down — is noise in every attachment list that holds a preview.
    const supportsOcr = attachment.role === "image" || isFileLike;

    // Opened in full detail, an image gets the interactive zoom/pan viewer and audio/video the full media
    // player — both mounted here rather than through the content renderer, which has no tab context to hand
    // them (and it is the tab that lets them navigate between the note's other attachments). Everything else,
    // in either view, is rendered imperatively via the content renderer.
    const isZoomableImage = !!isFullDetail && isPicture;
    const isPlayableMedia = !!isFullDetail && (attachment.mime.startsWith("audio/") || attachment.mime.startsWith("video/"));
    const rendersItself = isZoomableImage || isPlayableMedia;
    const imageSrc = `api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}?${modified}`;

    /** Unmounts whatever the content renderer previously mounted here (a media player), so that replacing
     *  or discarding the content doesn't leak its Preact root — or leave its audio playing. */
    function disposeContent() {
        const wrapper = contentWrapper.current;
        if (wrapper) content_renderer.disposeInteractiveContent($(wrapper));
    }

    function refresh() {
        if (!rendersItself) {
            // The full-detail view has a pane to itself, so it gets the pdf.js toolbar; a list-view preview
            // stays bare.
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
        setModified(attachment.utcDateModified);
    }

    useEffect(() => {
        refresh();
        return disposeContent;
    }, [ attachment, rendersItself ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttachmentRows().find(attachment => attachment.attachmentId)) {
            refresh();
        }
    });

    // Electron right-click menu (copy image / reference) for the interactive image viewer.
    useEffect(() => {
        if (isZoomableImage) {
            return imageContextMenu.setupContextMenu(refToJQuerySelector(imageViewerWrapper));
        }
    }, [ isZoomableImage ]);

    async function copyAttachmentReferenceToClipboard() {
        if (isPicture) {
            const $img = refToJQuerySelector(isZoomableImage ? imageViewerWrapper : contentWrapper).find("img");
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
                    <AttachmentIcon attachment={attachment} />
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
                    {/* The media type used to sit here too, spelled out. On a card whose title ends in
                        the extension and whose content is drawn right below, `image/svg+xml` told a
                        reader nothing they could not already see. */}
                    <AttachmentDetails attachment={attachment} />
                </div>

                {scheduledForErasureSince && <DeletionBadge utcDateScheduledForErasureSince={scheduledForErasureSince} />}
                {textContent && <TextPreview content={textContent} mime={attachment.mime} />}
                {isZoomableImage ? (
                    <div key="image-viewer" ref={imageViewerWrapper} className="attachment-content-wrapper attachment-image-viewer">
                        <ImageViewer key={`${attachment.attachmentId}-${modified}`} src={imageSrc} alt={attachment.title} />
                        <SiblingNavigator
                            note={ownerNote}
                            noteContext={noteContext}
                            viewScope={viewScope}
                            previousTooltipI18nKey="image_navigation.previous"
                            nextTooltipI18nKey="image_navigation.next"
                            extraPreviousKeys={[ "Backspace" ]}
                            extraNextKeys={[ "Space" ]}
                        />
                    </div>
                ) : isPlayableMedia ? (
                    <div key="media-player" className="attachment-content-wrapper attachment-media-player">
                        <MediaPreview
                            entity={attachment}
                            environment="standalone"
                            noteContext={noteContext}
                            ownerNote={ownerNote}
                            viewScope={viewScope}
                        />
                    </div>
                ) : (
                    <div key="rendered" ref={contentWrapper} className="attachment-content-wrapper" />
                )}
            </div>

        </div>
    );
}

/**
 * The line under the title. Its size always, and what kind of thing it is only where the icon beside the
 * title has not already said so — see {@link attachmentRoleLabel}.
 */
function AttachmentDetails({ attachment }: { attachment: FAttachment }) {
    const size = utils.formatSize(attachment.contentLength);
    const role = attachmentRoleLabel(attachment.role);

    return (
        <div className="attachment-details">
            {role ? t("attachment_detail_2.kind_and_size", { role, size }) : size}
        </div>
    );
}

/**
 * What the attachment is, ahead of its name.
 *
 * Two marks rather than one. The inner is the content's, or the role's where the role is the app's own
 * doing — but a PDF's mark is the same one a PDF note wears, and a card carrying it alone reads as a note
 * that happens to be listed here. So it is overprinted with the paperclip the app uses for attachments
 * everywhere else, which says the one thing the content mark cannot: this belongs to a note rather than
 * being one.
 */
function AttachmentIcon({ attachment }: { attachment: FAttachment }) {
    return (
        <span className="attachment-icon">
            <Icon icon={attachmentIcon(attachment.role, attachment.mime)} />
            <Icon className="attachment-icon-marker" icon="bx bx-paperclip" />
        </span>
    );
}

/**
 * Marks an attachment the cleanup job has scheduled for erasure. Pinned over the corner of its own card
 * rather than given a row of its own: the countdown is a state the attachment is in, not something to act
 * on right now, and a banner between the title and the preview pushed every following attachment down the
 * list for it. What to do about it — link it back, or convert it to a note — is a sentence too long for a
 * pill, so it goes in the tooltip, next to the two menu entries that carry it out.
 */
function DeletionBadge({ utcDateScheduledForErasureSince }: { utcDateScheduledForErasureSince: string }) {
    const scheduledSinceTimestamp = utils.parseDate(utcDateScheduledForErasureSince)?.getTime();
    // use default value (30 days in seconds) from options_init as fallback, in case getInt returns null
    const intervalMs = (options.getInt("eraseUnusedAttachmentsAfterSeconds") || 2592000) * 1000;
    const willBeDeletedInMs = scheduledSinceTimestamp !== undefined
        ? scheduledSinceTimestamp + intervalMs - Date.now()
        : undefined;

    return (
        <Badge
            className="attachment-deletion-badge"
            icon="bx bx-trash"
            text={willBeDeletedInMs !== undefined && willBeDeletedInMs >= 60000
                ? t("attachment_detail_2.deletion_badge", { time: utils.formatTimeInterval(willBeDeletedInMs) })
                : t("attachment_detail_2.deletion_badge_soon")}
            tooltip={t("attachment_detail_2.deletion_badge_tooltip")}
        />
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
                // Doesn't scroll, so it keeps the working backdrop blur — see the prop's own docs.
                noDropdownListStyle
                // The card clips its overflow, to keep a picture inside its rounded corners, and a menu
                // opening from the header is taller than the header has room for — so it is rendered
                // into the body to stand clear of the card, as the highlights card's menu is.
                portalToBody
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

                {attachment.role === "image" && (
                    <FormListItem
                        icon="bx bx-collapse-alt"
                        onClick={() => void showImageCompressionDialog({
                            type: "attachment",
                            attachmentId: attachment.attachmentId,
                            mime: attachment.mime
                        })}
                    >{t("compress-image")}</FormListItem>
                )}
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
