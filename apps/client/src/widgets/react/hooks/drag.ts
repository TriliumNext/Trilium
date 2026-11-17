import type { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import toast, { type ToastOptions } from "../../../services/toast";

/** A note the note tree's drag carries, as JSON under the `text` type. */
export interface DragData {
    noteId: string;
    branchId: string;
    title: string;
}

/** The type that marks a drag as holding notes from the note tree, as fancytree's `dnd5` sets. */
export const TREE_CLIPBOARD_TYPE = "application/x-fancytree-node";

export function useNoteTreeDrag(containerRef: RefObject<HTMLElement | null | undefined>, { dragEnabled, dragNotEnabledMessage, callback }: {
    dragEnabled: boolean,
    dragNotEnabledMessage: Omit<ToastOptions, "id">;
    callback: (data: DragData[], e: DragEvent) => void
}) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function onDragEnter(e: DragEvent) {
            if (!dragEnabled) {
                toast.showPersistent({
                    ...dragNotEnabledMessage,
                    id: "drag-not-enabled",
                    timeout: 5000
                });
            }
        }

        function onDragOver(e: DragEvent) {
            e.preventDefault();
        }

        function onDrop(e: DragEvent) {
            toast.closePersistent("drag-not-enabled");
            if (!dragEnabled) {
                return;
            }

            const data = e.dataTransfer?.getData('text');
            if (!data) {
                return;
            }

            const parsedData = JSON.parse(data) as DragData[];
            if (!parsedData.length) {
                return;
            }

            callback(parsedData, e);
        }

        function onDragLeave() {
            toast.closePersistent("drag-not-enabled");
        }

        container.addEventListener("dragenter", onDragEnter);
        container.addEventListener("dragover", onDragOver);
        container.addEventListener("drop", onDrop);
        container.addEventListener("dragleave", onDragLeave);

        return () => {
            container.removeEventListener("dragenter", onDragEnter);
            container.removeEventListener("dragover", onDragOver);
            container.removeEventListener("drop", onDrop);
            container.removeEventListener("dragleave", onDragLeave);
        };
    }, [ containerRef, callback ]);
}

/**
 * Collection-specific wrapper around {@link useNoteTreeDrag}. It standardizes the drag-locked
 * message shared by every collection view and, when the collection hides archived notes, warns the
 * user after a drop that any archived notes were cloned in but stay hidden until "Show archived
 * notes" is enabled (otherwise the note silently has no effect on the view).
 *
 * The `callback` should return the IDs of the notes it actually added (cloned) to the collection so
 * the warning only mentions newly-copied notes, not ones that were already present.
 */
export function useCollectionTreeDrag(containerRef: RefObject<HTMLElement | null | undefined>, { dragEnabled, includeArchived, callback }: {
    dragEnabled: boolean,
    includeArchived: boolean,
    callback: (data: DragData[], e: DragEvent) => string[] | Promise<string[]>
}) {
    const wrappedCallback = useCallback(async (data: DragData[], e: DragEvent) => {
        const addedNoteIds = await callback(data, e);
        if (!includeArchived && addedNoteIds?.length) {
            await warnIfArchivedNotesHidden(addedNoteIds);
        }
    }, [ includeArchived, callback ]);

    useNoteTreeDrag(containerRef, {
        dragEnabled,
        dragNotEnabledMessage: {
            icon: "bx bx-lock-alt",
            title: t("book.drag_locked_title"),
            message: t("book.drag_locked_message")
        },
        callback: wrappedCallback
    });
}

/** Toast a heads-up when freshly cloned notes are archived and the collection hides them. */
async function warnIfArchivedNotesHidden(addedNoteIds: string[]) {
    const notes = await froca.getNotes(addedNoteIds);
    const archivedCount = notes.filter((note) => note.isArchived).length;
    if (!archivedCount) {
        return;
    }
    toast.showMessage(t("book.archived_notes_hidden", { count: archivedCount }), 5000, "bx bx-archive");
}

/**
 * Accepts files dragged onto `containerRef` from outside the page and passes them to `onDrop`.
 * Returns whether such a drag is over the container.
 */
export function useFileDrop(
    containerRef: RefObject<HTMLElement | null>,
    onDrop: (files: File[]) => void
) {
    const [ isDraggedOver, setIsDraggedOver ] = useState(false);
    const onDropRef = useRef(onDrop);
    onDropRef.current = onDrop;

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // A drag that starts in the page, such as an image, can also carry files.
        let isDragFromPage = false;
        // `dragenter` and `dragleave` also fire when the drag moves between the children.
        let depth = 0;

        const carriesFiles = (e: DragEvent) =>
            !isDragFromPage && !!e.dataTransfer?.types.includes("Files");
        const markDragFromPage = () => { isDragFromPage = true; };
        const clearDragFromPage = () => { isDragFromPage = false; };

        function onDragEnter(e: DragEvent) {
            if (!carriesFiles(e)) return;
            e.preventDefault();
            depth++;
            setIsDraggedOver(true);
        }

        function onDragOver(e: DragEvent) {
            if (!carriesFiles(e) || !e.dataTransfer) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        }

        function onDragLeave(e: DragEvent) {
            if (!carriesFiles(e)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) {
                setIsDraggedOver(false);
            }
        }

        function onDropFiles(e: DragEvent) {
            if (!carriesFiles(e)) return;
            e.preventDefault();
            depth = 0;
            setIsDraggedOver(false);

            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length) {
                onDropRef.current(files);
            }
        }

        document.addEventListener("dragstart", markDragFromPage, true);
        document.addEventListener("dragend", clearDragFromPage, true);
        // A drop can remove the dragged element, and its `dragend` then never reaches the document.
        document.addEventListener("drop", clearDragFromPage);
        container.addEventListener("dragenter", onDragEnter);
        container.addEventListener("dragover", onDragOver);
        container.addEventListener("dragleave", onDragLeave);
        container.addEventListener("drop", onDropFiles);

        return () => {
            document.removeEventListener("dragstart", markDragFromPage, true);
            document.removeEventListener("dragend", clearDragFromPage, true);
            document.removeEventListener("drop", clearDragFromPage);
            container.removeEventListener("dragenter", onDragEnter);
            container.removeEventListener("dragover", onDragOver);
            container.removeEventListener("dragleave", onDragLeave);
            container.removeEventListener("drop", onDropFiles);
        };
    }, [ containerRef ]);

    return isDraggedOver;
}
