import { TypeWidgetProps } from "./type_widget";
import { useContext, useEffect, useState } from "preact/hooks";
import { useTriliumEvent, useTriliumOption } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";
import Button from "../react/Button";
import { t } from "../../services/i18n";
import dialog from "../../services/dialog";
import server from "../../services/server";
import toast from "../../services/toast";
import froca from "../../services/froca";
import appContext from "../../components/app_context";
import { formatSize } from "../../services/utils";
import branches from "../../services/branches";
import sync from "../../services/sync";
import "./Gallery.css";

interface ImageItem {
    id: string;
    url: string;
    title: string;
    type: 'note' | 'attachment';
    noteId?: string; // For attachments, store the parent note ID
    size?: number; // Size in bytes
}

export default function Gallery({ note }: TypeWidgetProps) {
    const [images, setImages] = useState<ImageItem[]>([]);
    const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);
    const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [totalSize, setTotalSize] = useState<number>(0);
    const [isGalleryShared, setIsGalleryShared] = useState<boolean>(false);
    const [syncServerHost] = useTriliumOption("syncServerHost");
    const parentComponent = useContext(ParentComponent);

    async function loadImages() {
        const imageItems: ImageItem[] = [];

        // Check if the gallery note itself is shared
        const galleryIsShared = note.hasAncestor("_share");
        setIsGalleryShared(galleryIsShared);

        // Check if we should hide child images
        const hideChildImages = note.hasLabel("hideChildAttachments");

        // First, check for images attached directly to this gallery note
        const directAttachments = await note.getAttachments();
        const directImageAttachments = directAttachments.filter(a => a.role === "image");

        // Process direct attachments
        for (const attachment of directImageAttachments) {
            imageItems.push({
                id: attachment.attachmentId,
                url: `api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}`,
                title: attachment.title,
                type: 'attachment' as const,
                noteId: attachment.ownerId,
                size: attachment.contentLength || 0
            });
        }

        // Only load child notes and their attachments if hideChildImages is not set
        if (!hideChildImages) {
            // Then check child notes
            const childNotes = await note.getChildNotes();
            const imageNotes = childNotes.filter(n => n.type === "image");

            // Process image notes in parallel
            const imageBlobPromises = imageNotes.map(async (imageNote) => {
                const blob = await imageNote.getBlob();
                const size = blob?.contentLength || 0;

                return {
                    id: imageNote.noteId,
                    url: `api/images/${imageNote.noteId}/${encodeURIComponent(imageNote.title)}`,
                    title: imageNote.title,
                    type: 'note' as const,
                    size
                };
            });

            const imageNoteItems = await Promise.all(imageBlobPromises);
            imageItems.push(...imageNoteItems);

            // Process child note attachments in parallel
            const attachmentPromises = childNotes.map(async (childNote) => {
                const attachments = await childNote.getAttachments();
                const imageAttachments = attachments.filter(a => a.role === "image");

                return imageAttachments.map(attachment => ({
                    id: attachment.attachmentId,
                    url: `api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}`,
                    title: attachment.title,
                    type: 'attachment' as const,
                    noteId: attachment.ownerId,
                    size: attachment.contentLength || 0
                }));
            });

            const attachmentArrays = await Promise.all(attachmentPromises);
            const allAttachments = attachmentArrays.flat();

            imageItems.push(...allAttachments);
        }

        // Calculate total size once at the end from all items
        const calculatedTotalSize = imageItems.reduce((sum, item) => sum + (item.size || 0), 0);

        setImages(imageItems);
        setTotalSize(calculatedTotalSize);
    }
    useEffect(() => {
        loadImages();
    }, [note]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const childNoteIds = images.map(img => img.noteId).filter(Boolean);

        const shouldReload =
            loadResults.getBranchRows().some(b => b.parentNoteId === note.noteId || b.noteId === note.noteId) ||
            loadResults.getNoteIds().some(id => id === note.noteId || childNoteIds.includes(id)) ||
            loadResults.getAttachmentRows().some(att => att.ownerId === note.noteId || childNoteIds.includes(att.ownerId)) ||
            loadResults.getAttributeRows().some(attr => attr.noteId === note.noteId && attr.name === "hideChildAttachments");

        if (shouldReload) {
            loadImages();
        }
    });

    function handleUploadImages() {
        parentComponent?.triggerCommand("showUploadAttachmentsDialog", { noteId: note.noteId });
    }

    function handleImageClick(img: ImageItem, index: number, e: MouseEvent) {
        e.stopPropagation();

        if (isSelectionMode) {
            toggleImageSelection(img.id);
        } else {
            setSelectedImage(img);
            setSelectedIndex(index);
        }
    }

    function handleLinkClick(img: ImageItem, e: MouseEvent) {
        e.stopPropagation();

        if (img.type === 'note') {
            // Navigate to the note
            appContext.tabManager.getActiveContext()?.setNote(img.id);
        } else if (img.noteId && img.noteId !== note.noteId) {
            // For attachments on child notes, navigate to the parent note
            appContext.tabManager.getActiveContext()?.setNote(img.noteId);
        }
        // Note: No else clause - we don't do anything for gallery note attachments
    }

    async function handleCopyImageLink(img: ImageItem, e: MouseEvent) {
        e.stopPropagation();

        if (!isGalleryShared) {
            toast.showError(t("gallery.not_shared"));
            return;
        }

        let imageUrl: string;

        if (img.type === 'note') {
            const imageNote = froca.getNoteFromCache(img.id);
            if (!imageNote) {
                toast.showError(t("gallery.image_not_found"));
                return;
            }

            const shareId = imageNote.getOwnedLabelValue("shareAlias") || img.id;
            imageUrl = getAbsoluteUrl(`/share/api/images/${shareId}/${encodeURIComponent(img.title)}`);
        } else {
            imageUrl = getAbsoluteUrl(`/share/api/attachments/${img.id}/image/${encodeURIComponent(img.title)}`);
        }

        try {
            await navigator.clipboard.writeText(imageUrl);
            toast.showMessage(t("gallery.copy_image_link"));
        } catch (error) {
            toast.showError(t("gallery.share_copy_failed"));
        }
    }

    async function handleToggleHideChildImages() {
        const currentValue = note.hasLabel("hideChildAttachments");

        if (currentValue) {
            // Remove the attribute
            const attr = note.getOwnedAttributes("label", "hideChildAttachments")[0];
            if (attr) {
                await server.remove(`notes/${note.noteId}/attributes/${attr.attributeId}`);
                toast.showMessage(t("gallery.show_child_images_btn"));
            }
        } else {
            // Add the attribute
            await server.post(`notes/${note.noteId}/attributes`, {
                type: "label",
                name: "hideChildAttachments",
                value: ""
            });
            toast.showMessage(t("gallery.hide_child_images_btn"));
        }

        await loadImages();
    }

    function getAbsoluteUrl(path: string): string {
        if (syncServerHost) {
            return new URL(path, syncServerHost).href;
        }
        const origin = `${location.protocol}//${location.host}`;
        const pathname = location.pathname.replace(/\/$/, '');
        return `${origin}${pathname}${path}`;
    }

    function toggleImageSelection(imageId: string) {
        setSelectedImages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(imageId)) {
                newSet.delete(imageId);
            } else {
                newSet.add(imageId);
            }
            return newSet;
        });
    }

    function toggleSelectionMode() {
        setIsSelectionMode(!isSelectionMode);
        if (isSelectionMode) {
            setSelectedImages(new Set());
        }
    }

    function selectAll() {
        setSelectedImages(new Set(images.map(img => img.id)));
    }

    function deselectAll() {
        setSelectedImages(new Set());
    }

    function closeLightbox() {
        setSelectedImage(null);
        setSelectedIndex(-1);
    }

    function navigateImage(direction: 'prev' | 'next') {
        if (images.length === 0) return;

        let newIndex = selectedIndex;
        if (direction === 'prev') {
            newIndex = selectedIndex > 0 ? selectedIndex - 1 : images.length - 1;
        } else {
            newIndex = selectedIndex < images.length - 1 ? selectedIndex + 1 : 0;
        }

        setSelectedIndex(newIndex);
        setSelectedImage(images[newIndex]);
    }

    async function handleDeleteImage(img: ImageItem, e?: MouseEvent) {
        if (e) {
            e.stopPropagation();
        }

        // Check if this image belongs to another note
        const belongsToOtherNote = img.type === 'note' || (img.noteId && img.noteId !== note.noteId);

        let confirmMessage = img.type === 'note'
            ? t("gallery.confirm_delete_note", { title: img.title })
            : t("gallery.confirm_delete_attachment", { title: img.title });

        // Add warning if it belongs to another note
        if (belongsToOtherNote) {
            confirmMessage += "\n\n" + t("gallery.warning_delete_other_note");
        }

        const confirmed = await dialog.confirm(confirmMessage);

        if (!confirmed) {
            return;
        }

        try {
            if (img.type === 'note') {
                await server.remove(`notes/${img.id}`);
                toast.showMessage(t("gallery.delete_note_success", { title: img.title }));
            } else {
                await server.remove(`attachments/${img.id}`);
                toast.showMessage(t("gallery.delete_attachment_success", { title: img.title }));
            }

            if (selectedImage?.id === img.id) {
                closeLightbox();
            }

            await loadImages();
        } catch (error: any) {
            toast.showError(t("gallery.delete_error", { message: error.message || String(error), title: img.title }));
        }
    }

    async function handleDeleteSelected() {
        if (selectedImages.size === 0) return;

        const confirmMessage = t("gallery.confirm_delete_multiple", { count: selectedImages.size });

        if (!await dialog.confirm(confirmMessage)) {
            return;
        }

        const imagesToDelete = images.filter(img => selectedImages.has(img.id));

        const deletePromises = imagesToDelete.map(img => {
            if (img.type === 'note') {
                return server.remove(`notes/${img.id}`);
            } else {
                return server.remove(`attachments/${img.id}`);
            }
        });

        const results = await Promise.allSettled(deletePromises);

        let successCount = 0;
        let errorCount = 0;

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successCount++;
            } else {
                errorCount++;
                console.error(`Failed to delete image ${imagesToDelete[index].id}:`, result.reason);
            }
        });

        if (successCount > 0) {
            toast.showMessage(t("gallery.delete_multiple_success", { count: successCount }));
        }
        if (errorCount > 0) {
            toast.showError(t("gallery.delete_multiple_error", { count: errorCount }));
        }

        setSelectedImages(new Set());
        setIsSelectionMode(false);
        await loadImages();
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (!selectedImage) return;

        if (e.key === 'Escape') {
            closeLightbox();
        } else if (e.key === 'ArrowLeft') {
            navigateImage('prev');
        } else if (e.key === 'ArrowRight') {
            navigateImage('next');
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            handleDeleteImage(selectedImage);
        }
    }

    useEffect(() => {
        if (selectedImage) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [selectedImage, selectedIndex]);

    return (
        <div className="gallery-container">
            <div className="gallery-toolbar">
                <div className="gallery-toolbar-left">
                    <Button
                        icon="bx bx-upload"
                        text={t("gallery.upload_images")}
                        onClick={handleUploadImages}
                        size="small"
                    />
                    <Button
                        icon={isSelectionMode ? "bx bx-x" : "bx bx-select-multiple"}
                        text={isSelectionMode ? t("gallery.cancel_selection") : t("gallery.select")}
                        onClick={toggleSelectionMode}
                        size="small"
                    />
                    <Button
                        icon={note.hasLabel("hideChildAttachments") ? "bx bx-show" : "bx bx-hide"}
                        text={note.hasLabel("hideChildAttachments") ? t("gallery.show_child_images_btn") : t("gallery.hide_child_images_btn")}
                        onClick={handleToggleHideChildImages}
                        size="small"
                        title={t("gallery.toggle_child_images_tooltip")}
                    />
                </div>

                {isSelectionMode && (
                    <div className="gallery-selection-actions">
                        <Button
                            text={t("gallery.select_all")}
                            onClick={selectAll}
                            size="small"
                        />
                        <Button
                            text={t("gallery.deselect_all")}
                            onClick={deselectAll}
                            size="small"
                            disabled={selectedImages.size === 0}
                        />
                        <Button
                            icon="bx bx-trash"
                            text={t("gallery.delete_selected", { count: selectedImages.size })}
                            onClick={handleDeleteSelected}
                            size="small"
                            disabled={selectedImages.size === 0}
                            className="btn-danger"
                        />
                    </div>
                )}

                <span className="gallery-count">
                    {t("gallery.image_count", { count: images.length })}
                    {totalSize > 0 && ` (${formatSize(totalSize)})`}
                </span>
            </div>

            {images.length === 0 ? (
                <div className="gallery-empty">
                    <div className="gallery-empty-icon">
                        <span className="bx bx-image-alt"></span>
                    </div>
                    <p>{t("gallery.no_images")}</p>
                    <Button
                        icon="bx bx-upload"
                        text={t("gallery.upload_first_image")}
                        onClick={handleUploadImages}
                        primary
                    />
                </div>
            ) : (
                <div className="gallery-masonry">
                    {images.map((img, index) => (
                        <div
                            className={`gallery-item ${selectedImages.has(img.id) ? 'selected' : ''} ${isSelectionMode ? 'selection-mode' : ''}`}
                            key={img.id}
                            onClick={(e) => handleImageClick(img, index, e)}
                        >
                            {isSelectionMode && (
                                <div className="gallery-item-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={selectedImages.has(img.id)}
                                        onChange={() => toggleImageSelection(img.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label={t("gallery.select_image", { title: img.title })}
                                    />
                                </div>
                            )}
                            <img src={img.url} alt={img.title} loading="lazy" />
                            <div className="gallery-item-overlay">
                                <div className="gallery-item-title">{img.title}</div>
                                {!isSelectionMode && (
                                    <div className="gallery-item-actions">
                                        {isGalleryShared && (
                                            <button
                                                type="button"
                                                className="gallery-item-copy-link"
                                                onClick={(e) => handleCopyImageLink(img, e)}
                                                title={t("gallery.copy_image_link")}
                                            >
                                                <span className="bx bx-link"></span>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="gallery-item-delete"
                                            onClick={(e) => handleDeleteImage(img, e)}
                                            title={t("gallery.delete")}
                                        >
                                            <span className="bx bx-trash"></span>
                                        </button>
                                    </div>
                                )}
                            </div>
                            {!isSelectionMode && (img.type === 'note' || (img.noteId && img.noteId !== note.noteId)) && (
                                <button
                                    type="button"
                                    className="gallery-item-link"
                                    onClick={(e) => handleLinkClick(img, e)}
                                    title={t("gallery.goto_note")}
                                >
                                    <span className="bx bx-right-arrow-alt"></span>
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {selectedImage && !isSelectionMode && (
                <div className="gallery-lightbox" onClick={closeLightbox}>
                    <button
                        type="button"
                        className="gallery-lightbox-close"
                        onClick={closeLightbox}
                        title={t("gallery.close")}
                    >
                        <span className="bx bx-x"></span>
                    </button>

                    <button
                        type="button"
                        className="gallery-lightbox-delete"
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(selectedImage); }}
                        title={t("gallery.delete")}
                    >
                        <span className="bx bx-trash"></span>
                    </button>

                    {isGalleryShared && (
                        <button
                            type="button"
                            className="gallery-lightbox-copy-link"
                            onClick={(e) => { e.stopPropagation(); handleCopyImageLink(selectedImage, e); }}
                            title={t("gallery.copy_image_link")}
                        >
                            <span className="bx bx-link"></span>
                        </button>
                    )}

                    {images.length > 1 && (
                        <>
                            <button
                                type="button"
                                className="gallery-lightbox-nav gallery-lightbox-prev"
                                onClick={(e) => { e.stopPropagation(); navigateImage('prev'); }}
                                title={t("gallery.previous")}
                            >
                                <span className="bx bx-chevron-left"></span>
                            </button>
                            <button
                                type="button"
                                className="gallery-lightbox-nav gallery-lightbox-next"
                                onClick={(e) => { e.stopPropagation(); navigateImage('next'); }}
                                title={t("gallery.next")}
                            >
                                <span className="bx bx-chevron-right"></span>
                            </button>
                        </>
                    )}

                    <div className="gallery-lightbox-content" onClick={(e) => e.stopPropagation()}>
                        <img src={selectedImage.url} alt={selectedImage.title} />
                        <div className="gallery-lightbox-info">
                            <h3>{selectedImage.title}</h3>
                            <span className="gallery-lightbox-counter">
                                {selectedIndex + 1} / {images.length}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
