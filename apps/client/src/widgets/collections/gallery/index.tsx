import "./index.css";

import { ToggleInParentResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import linkContextMenu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import { copyTextWithToast } from "../../../services/clipboard_ext";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import link from "../../../services/link";
import noteCreateService from "../../../services/note_create";
import options from "../../../services/options";
import server from "../../../services/server";
import toast from "../../../services/toast";
import tree from "../../../services/tree";
import ActionButton from "../../react/ActionButton";
import Alert from "../../react/Alert";
import { FormFileUploadActionButton } from "../../react/FormFileUpload";
import { useTriliumEvent } from "../../react/hooks";
import type { ViewModeProps } from "../interface";
import { useFilteredNoteIds } from "../legacy/utils";

const INITIAL_LOAD = 50;
const LOAD_MORE_INCREMENT = 50;

const VISUAL_NOTE_TYPES = ['image', 'canvas', 'mermaid', 'mindMap'] as const;

function isVisualType(type: string): boolean {
    return (VISUAL_NOTE_TYPES as readonly string[]).includes(type);
}

function isGalleryNote(note: FNote): boolean {
    return note.hasLabel('collection') && note.getLabelValue('viewType') === 'gallery';
}

function getImageSrc(note: FNote): string | undefined {
    switch (note.type) {
        case 'image':
            return `api/images/${note.noteId}/${encodeURIComponent(note.title)}`;
        case 'canvas':
            return `api/images/${note.noteId}/canvas.png`;
        case 'mermaid':
            return `api/images/${note.noteId}/mermaid.svg`;
        case 'mindMap':
            return `api/images/${note.noteId}/mindmap.svg`;
        default:
            return undefined;
    }
}

function getShareUrl(note: FNote): string {
    const shareId = note.hasOwnedLabel("shareRoot")
        ? ""
        : note.getOwnedLabelValue("shareAlias") || note.noteId;

    const syncServerHost = options.get("syncServerHost");
    if (syncServerHost) {
        return new URL(`/share/${shareId}`, syncServerHost).href;
    }

    let host = location.host;
    if (host.endsWith("/")) {
        host = host.substring(0, host.length - 1);
    }
    return `${location.protocol}//${host}${location.pathname}share/${shareId}`;
}

export default function GalleryView({ note, noteIds: unfilteredNoteIds }: ViewModeProps<{}>) {
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
    const [lastSelectedNoteId, setLastSelectedNoteId] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [displayCount, setDisplayCount] = useState(INITIAL_LOAD);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    // Track how many notes actually exist in froca to trigger recalculation when new notes are loaded
    const loadedNoteCount = noteIds?.filter(id => froca.notes[id]).length ?? 0;

    // Memoize the filtered and sorted notes to avoid recalculating on every render
    const { sortedNotes, imageCount, galleryCount } = useMemo(() => {
        const allNotes = noteIds?.map(noteId => froca.notes[noteId]).filter(Boolean) || [];

        const notes = allNotes
            .filter(childNote => isGalleryNote(childNote) || isVisualType(childNote.type))
            .sort((a, b) => {
                const aIsGallery = isGalleryNote(a);
                const bIsGallery = isGalleryNote(b);

                if (aIsGallery && !bIsGallery) return -1;
                if (!aIsGallery && bIsGallery) return 1;
                return 0;
            });

        const imgCount = notes.filter(note => isVisualType(note.type)).length;
        const galCount = notes.filter(note => isGalleryNote(note)).length;

        return { sortedNotes: notes, imageCount: imgCount, galleryCount: galCount };
    }, [noteIds, loadedNoteCount]);

    // Only display a subset of notes for virtual scrolling
    const displayedNotes = sortedNotes.slice(0, displayCount);
    const hasMore = displayCount < sortedNotes.length;

    // Infinite scroll with IntersectionObserver
    useEffect(() => {
        if (!hasMore || !loadMoreRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setDisplayCount(prev => Math.min(prev + LOAD_MORE_INCREMENT, sortedNotes.length));
                }
            },
            {
                rootMargin: '300px', // Load before user reaches the bottom
                threshold: 0.1
            }
        );

        observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [hasMore, sortedNotes.length]);

    // Reset display count when note changes
    useEffect(() => {
        setDisplayCount(INITIAL_LOAD);
    }, [note.noteId]);

    const toggleSelection = (noteId: string, isCtrlKey: boolean, isShiftKey: boolean) => {
        setSelectedNoteIds(prev => {
            const newSet = new Set(prev);

            if (isShiftKey && lastSelectedNoteId && sortedNotes) {
                const lastIndex = sortedNotes.findIndex(n => n.noteId === lastSelectedNoteId);
                const currentIndex = sortedNotes.findIndex(n => n.noteId === noteId);

                if (lastIndex !== -1 && currentIndex !== -1) {
                    const start = Math.min(lastIndex, currentIndex);
                    const end = Math.max(lastIndex, currentIndex);

                    for (let i = start; i <= end; i++) {
                        newSet.add(sortedNotes[i].noteId);
                    }
                }
            } else if (isCtrlKey) {
                if (newSet.has(noteId)) {
                    newSet.delete(noteId);
                } else {
                    newSet.add(noteId);
                }
            } else {
                newSet.clear();
                newSet.add(noteId);
            }

            return newSet;
        });

        if (!isCtrlKey || !selectedNoteIds.has(noteId)) {
            setLastSelectedNoteId(noteId);
        }
    };

    const handleSelectAll = () => {
        if (sortedNotes && sortedNotes.length > 0) {
            setSelectedNoteIds(new Set(sortedNotes.map(n => n.noteId)));
            setLastSelectedNoteId(sortedNotes[sortedNotes.length - 1].noteId);
        }
    };

    const clearSelection = () => {
        setSelectedNoteIds(new Set());
        setLastSelectedNoteId(null);
    };

    const handleUpload = async (files: FileList | null) => {
        if (!files || files.length === 0 || !note) return;

        setIsUploading(true);
        const totalFiles = files.length;
        let successCount = 0;
        const toastId = "gallery-upload-progress";

        try {
            for (let i = 0; i < totalFiles; i++) {
                const file = files[i];
                try {
                    toast.showPersistent({
                        id: toastId,
                        icon: "bx bx-upload",
                        message: t("import.in-progress", { progress: `${i + 1}/${totalFiles}` }),
                        progress: ((i + 1) / totalFiles) * 100
                    });

                    const result = await noteCreateService.createNote(note.noteId, {
                        title: file.name,
                        type: 'image',
                        mime: file.type || 'image/png',
                        content: '',
                        activate: false
                    });

                    if (!result?.note) {
                        toast.showError(t("import.failed", { message: `Failed to create note for ${file.name}` }));
                        continue;
                    }

                    const uploadResult = await server.upload(`images/${result.note.noteId}`, file);

                    if (uploadResult.uploaded) {
                        successCount++;
                    } else {
                        toast.showError(t("import.failed", { message: uploadResult.message || "Unknown error" }));
                    }
                } catch (error) {
                    console.error(`Failed to upload ${file.name}:`, error);
                    toast.showError(t("import.failed", { message: file.name }));
                }
            }

            toast.closePersistent(toastId);

            if (successCount > 0) {
                toast.showMessage(t("import.successful"));
            }
        } finally {
            setIsUploading(false);
        }
    };

    const handleCreateGallery = async () => {
        const newTitle = await new Promise<string | null>((resolve) => {
            appContext.triggerCommand("showPromptDialog", {
                title: t("gallery.new_gallery"),
                message: t("gallery.enter_gallery_name"),
                defaultValue: t("gallery.default_gallery_name"),
                callback: resolve
            });
        });

        if (!newTitle) return;

        try {
            await noteCreateService.createNote(note.noteId, {
                title: newTitle,
                type: 'book',
                content: '',
                templateNoteId: '_template_gallery',
                activate: false
            });

            toast.showMessage(t("gallery.gallery_created"));
        } catch (error) {
            console.error('Failed to create gallery:', error);
            toast.showError(t("gallery.gallery_creation_failed"));
        }
    };

    const deleteNotes = async (noteIdsToDelete: string[]) => {
        if (noteIdsToDelete.length === 0) return;

        const branchIds: string[] = [];
        for (const noteId of noteIdsToDelete) {
            const noteToDelete = froca.notes[noteId];
            if (noteToDelete) {
                const branch = noteToDelete.getParentBranches().find(b => b.parentNoteId === note.noteId);
                if (branch) {
                    branchIds.push(branch.branchId);
                }
            }
        }

        if (branchIds.length > 0) {
            await branches.deleteNotes(branchIds, false, false);
            clearSelection();
        }
    };

    const handleDeleteSelected = async () => {
        if (selectedNoteIds.size === 0) return;
        await deleteNotes(Array.from(selectedNoteIds));
    };

    const isEmpty = sortedNotes.length === 0;

    return (
        <div class="note-list gallery-view">
            <GalleryToolbar
                selectedCount={selectedNoteIds.size}
                totalCount={sortedNotes?.length ?? 0}
                imageCount={imageCount}
                galleryCount={galleryCount}
                isUploading={isUploading}
                currentNote={note}
                onUpload={handleUpload}
                onCreateGallery={handleCreateGallery}
                onSelectAll={handleSelectAll}
                onClearSelection={clearSelection}
                onDeleteSelected={handleDeleteSelected}
            />

            {isEmpty && (
                <Alert type="info" className="gallery-empty-help">
                    {t("gallery.empty_gallery")}
                </Alert>
            )}

            <div class="note-list-wrapper">
                <div class="gallery-container">
                    {displayedNotes.map(childNote => (
                        <GalleryCard
                            key={childNote.noteId}
                            note={childNote}
                            parentNote={note}
                            isSelected={selectedNoteIds.has(childNote.noteId)}
                            selectedNoteIds={selectedNoteIds}
                            toggleSelection={toggleSelection}
                            deleteNotes={deleteNotes}
                        />
                    ))}
                </div>

                {/* Infinite scroll trigger */}
                {hasMore && (
                    <div
                        ref={loadMoreRef}
                        className="gallery-load-more"
                    >
                        <div className="gallery-load-more-text">
                            {t('gallery.loading_more', { loaded: displayedNotes.length, total: sortedNotes.length })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

interface GalleryToolbarProps {
    selectedCount: number;
    totalCount: number;
    imageCount: number;
    galleryCount: number;
    isUploading: boolean;
    onUpload: (files: FileList | null) => void;
    onCreateGallery: () => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onDeleteSelected: () => void;
}

function GalleryToolbar({
    selectedCount,
    totalCount,
    imageCount,
    galleryCount,
    isUploading,
    onUpload,
    onCreateGallery,
    onSelectAll,
    onClearSelection,
    onDeleteSelected,
    currentNote
}: GalleryToolbarProps & { currentNote: FNote }) {

    // Check if current note is a gallery with parents
    const hasParentGallery = currentNote && currentNote.getParentNotes().some(parent => isGalleryNote(parent));

    const handleGoBack = () => {
        if (currentNote) {
            const parentGallery = currentNote.getParentNotes().find(parent => isGalleryNote(parent));

            if (parentGallery) {
                appContext.tabManager.getActiveContext()?.setNote(parentGallery.noteId);
            }
        }
    };

    const handleCreateGalleryClick = () => {
        if (selectedCount > 0) {
            onClearSelection();
        }
        onCreateGallery();
    };

    const handleUploadChange = (files: FileList | null) => {
        if (selectedCount > 0) {
            onClearSelection();
        }
        onUpload(files);
    };

    return (
        <div className="gallery-toolbar">
            <div className="gallery-toolbar-left">
                {hasParentGallery && (
                    <ActionButton
                        icon="bx bx-arrow-back"
                        text={t("gallery.back_to_parent")}
                        frame
                        onClick={handleGoBack}
                    />
                )}
                <ActionButton
                    icon="bx bx-folder-plus"
                    text={t("gallery.new_gallery")}
                    frame
                    onClick={handleCreateGalleryClick}
                />
                <FormFileUploadActionButton
                    icon="bx bx-upload"
                    text={t("upload_attachments.upload")}
                    frame
                    disabled={isUploading}
                    onChange={handleUploadChange}
                    multiple
                    accept="image/*"
                />
                {galleryCount > 0 && (
                    <span className="gallery-toolbar-status">
                        {t("gallery.gallery_count", { count: galleryCount })}
                    </span>
                )}
                {imageCount > 0 && (
                    <span className="gallery-toolbar-status">
                        {t("gallery.image_count", { count: imageCount })}
                    </span>
                )}
            </div>

            <div className="gallery-toolbar-right">
                {selectedCount === 0 ? (
                    <ActionButton
                        icon="bx bx-select-multiple"
                        text={t("gallery.select_all")}
                        frame
                        onClick={onSelectAll}
                        disabled={totalCount === 0}
                    />
                ) : (
                    <>
                        <span className="gallery-toolbar-selection-count">
                            {t("gallery.items_selected", { count: selectedCount })}
                        </span>
                        <ActionButton
                            icon="bx bx-x"
                            text={t("gallery.clear_selection")}
                            frame
                            onClick={onClearSelection}
                        />
                        <ActionButton
                            icon="bx bx-trash"
                            text={t("gallery.delete_selected")}
                            frame
                            className="btn-delete"
                            onClick={onDeleteSelected}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

interface GalleryCardProps {
    note: FNote;
    parentNote: FNote;
    isSelected: boolean;
    selectedNoteIds: Set<string>;
    toggleSelection: (noteId: string, isCtrlKey: boolean, isShiftKey: boolean) => void;
    deleteNotes: (noteIdsToDelete: string[]) => Promise<void>;
}

function GalleryCard({ note, parentNote, isSelected, selectedNoteIds, toggleSelection, deleteNotes }: GalleryCardProps) {
    const [noteTitle, setNoteTitle] = useState<string>();
    const [imageSrc, setImageSrc] = useState<string>();
    const [isShared, setIsShared] = useState(() => note.isShared());
    const notePath = getNotePath(parentNote, note);
    const isGallery = isGalleryNote(note);

    const childCount = useMemo(() => {
        if (!isGallery) {
            return 0;
        }

        const childNoteIds = note.children || [];
        return childNoteIds.filter(childId => {
            const child = froca.notes[childId];
            if (!child) return false;
            return isVisualType(child.type) || isGalleryNote(child);
        }).length;
    }, [isGallery, note.children]);

    const refreshData = useCallback(() => {
        tree.getNoteTitle(note.noteId, parentNote.noteId).then(setNoteTitle);
        setImageSrc(getImageSrc(note));
        setIsShared(note.isShared());
    }, [note, parentNote.noteId]);

    useEffect(() => {
        refreshData();
    }, [refreshData]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.isNoteReloaded(note.noteId)) {
            refreshData();
        }
    });

    const handleRename = async () => {
        const newTitle = await new Promise<string | null>((resolve) => {
            appContext.triggerCommand("showPromptDialog", {
                title: t("rename_note.rename_note"),
                message: t("rename_note.rename_note_title_to"),
                defaultValue: note.title,
                callback: resolve
            });
        });

        if (newTitle && newTitle !== note.title) {
            await server.put(`notes/${note.noteId}/title`, { title: newTitle });
            setNoteTitle(newTitle);
        }
    };

    const handleToggleShare = async (noteToShare: FNote) => {
        const shouldShare = !noteToShare.isShared();
        const resp = await server.put<ToggleInParentResponse>(`notes/${noteToShare.noteId}/toggle-in-parent/_share/${shouldShare}`);

        if (!resp.success && "message" in resp) {
            toast.showError(resp.message);
        } else {
            setIsShared(shouldShare);
        }
    };

    const handleClick = (e: MouseEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            toggleSelection(note.noteId, true, false);
        } else if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            toggleSelection(note.noteId, false, true);
        } else if (selectedNoteIds.size > 0) {
            e.preventDefault();
            e.stopPropagation();
            toggleSelection(note.noteId, false, false);
        } else {
            link.goToLink(e);
        }
    };

    const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isSelected && selectedNoteIds.size > 0) {
            toggleSelection(note.noteId, false, false);
        }

        const noteIdsToDelete = selectedNoteIds.size > 0 && isSelected
            ? Array.from(selectedNoteIds)
            : [note.noteId];

        const isBulkOperation = noteIdsToDelete.length > 1;

        contextMenu.show({
            x: e.pageX,
            y: e.pageY,
            items: [
                { title: t("link_context_menu.open_note_in_new_window"), command: "openNoteInNewWindow", uiIcon: "bx bx-window-open" },
                { kind: "separator" },
                {
                    title: t("rename_note.rename_note"),
                    uiIcon: "bx bx-rename",
                    enabled: !isBulkOperation,
                    handler: handleRename
                },
                { kind: "separator" },
                {
                    title: isShared
                        ? t("shared_switch.toggle-off-title")
                        : t("shared_switch.toggle-on-title"),
                    uiIcon: isShared ? "bx bx-unlink" : "bx bx-share-alt",
                    enabled: !isBulkOperation,
                    handler: () => handleToggleShare(note)
                },
                { kind: "separator" },
                {
                    title: isBulkOperation
                        ? t("gallery.delete_multiple", { count: noteIdsToDelete.length })
                        : t("note_actions.delete_note"),
                    uiIcon: "bx bx-trash",
                    handler: () => deleteNotes(noteIdsToDelete)
                }
            ],
            selectMenuItemHandler: ({ command }) => {
                if (command) {
                    linkContextMenu.handleLinkContextMenuItem(command, e, notePath);
                }
            }
        });
    };

    const handleShareBadgeClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const shareUrl = getShareUrl(note);
        copyTextWithToast(shareUrl);
    };

    return (
        <div
            className={`gallery-card block-link ${note.isArchived ? "archived" : ""} ${isGallery ? "gallery-folder" : ""} ${isSelected ? "gallery-card-selected" : ""}`}
            data-href={`#${notePath}`}
            data-note-id={note.noteId}
            onClick={(e) => handleClick(e)}
            onContextMenu={(e) => handleContextMenu(e)}
        >
            {isSelected && (
                <div className="gallery-card-selection-indicator">
                    <i className="bx bx-check-circle" />
                </div>
            )}
            {isGallery ? (
                <div className="gallery-image-container gallery-folder-icon">
                    <i className="bx bx-folder" />
                    {isShared && (
                        <button
                            type="button"
                            className="gallery-share-badge"
                            title={t("breadcrumb_badges.shared_copy_to_clipboard")}
                            onClick={handleShareBadgeClick}
                        >
                            <i className="bx bx-share-alt" />
                        </button>
                    )}
                    <div className="gallery-title">
                        {noteTitle}
                        {childCount > 0 && (
                            <span className="gallery-item-count"> ({childCount})</span>
                        )}
                    </div>
                </div>
            ) : imageSrc ? (
                <div className="gallery-image-container">
                    <img src={imageSrc} alt={noteTitle} loading="lazy" />
                    <div className="gallery-type-badge">
                        <i className={note.getIcon()} />
                    </div>
                    {isShared && (
                        <button
                            type="button"
                            className="gallery-share-badge"
                            title={t("breadcrumb_badges.shared_copy_to_clipboard")}
                            onClick={handleShareBadgeClick}
                        >
                            <i className="bx bx-share-alt" />
                        </button>
                    )}
                    <div className="gallery-title">{noteTitle}</div>
                </div>
            ) : null}
        </div>
    );
}

function getNotePath(parentNote: FNote, childNote: FNote) {
    return parentNote.type === "search" ? childNote.noteId : `${parentNote.noteId}/${childNote.noteId}`;
}
