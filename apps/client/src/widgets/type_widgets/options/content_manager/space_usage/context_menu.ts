import appContext from "../../../../../components/app_context";
import type FNote from "../../../../../entities/fnote";
import contextMenu, {
    type ContextMenuEvent,
    type MenuItem
} from "../../../../../menus/context_menu";
import branches from "../../../../../services/branches";
import dialog from "../../../../../services/dialog";
import froca from "../../../../../services/froca";
import { t } from "../../../../../services/i18n";
import { downloadFileNote } from "../../../../../services/open";
import options from "../../../../../services/options";
import server from "../../../../../services/server";
import toast from "../../../../../services/toast";
import { showImageCompressionDialog } from "../../../../dialogs/image_compression/image_compression_dialog";

const ROOT_NOTE_ID = "root";

/** Switches the section to Browse, focused on the given path. */
export type ShowDetailsHandler = (notePath: string[]) => void;

/**
 * Asks the section for a fresh reading, after this menu changed what there is to measure.
 *
 * The views take a reading when asked rather than following the database, so an action taken from
 * within them has to say so — otherwise a note the user just deleted keeps its cell, and the totals
 * keep counting it.
 */
export type ContentChangedHandler = () => void;

/**
 * The actions every Space Usage view offers on a note it draws — the treemap cells of Overview, the
 * children ring and center note of Browse. One builder so a note answers the same way whichever
 * chart the pointer is over.
 *
 * `notePath` runs from the root (inclusive) down to the note: the charts already carry it for their
 * links, and it is what identifies the placement to act on — a clone occupies space once, at the
 * canonical placement the usage figures were attributed to, so that is the branch Delete removes
 * and the path Export resolves.
 */
export async function openSpaceUsageContextMenu(
    event: ContextMenuEvent,
    notePath: string[],
    onShowDetails: ShowDetailsHandler,
    onContentChanged: ContentChangedHandler
) {
    event.preventDefault();
    event.stopPropagation();

    const noteId = notePath[notePath.length - 1];
    const parentNoteId = notePath[notePath.length - 2];
    // Silent: the usage snapshot predates the menu, so the note may already be gone — no menu,
    // no error.
    const note = noteId ? await froca.getNote(noteId, true) : null;

    if (!note) {
        return;
    }

    // The root has no parent, so no path the export dialog can resolve into a branch. Note that
    // `getBranchId` answers the placeholder "none_root" for the root rather than nothing, so the
    // root is recognised by its ID and never by the absence of a branch.
    const isRoot = noteId === ROOT_NOTE_ID;
    const branchId = parentNoteId ? await froca.getBranchId(parentNoteId, noteId) : null;
    const notePathString = notePath.join("/");

    // Wording and icons are borrowed from the surfaces that already offer these actions — the tree
    // context menu and the note menu — so a note reads the same here as it does there. Only "Show
    // details" is particular to Space Usage.
    const items: MenuItem<never>[] = [
        {
            title: t("tree-context-menu.open-in-popup"),
            uiIcon: "bx bx-edit",
            handler: () => quickEditNote(notePath)
        },
        {
            title: t("tree-context-menu.open-in-a-new-tab"),
            uiIcon: "bx bx-link-external",
            handler: () => openNoteInNewTab(noteId)
        },
        {
            title: t("space_usage.menu_show_details"),
            uiIcon: "bx bx-detail",
            handler: () => onShowDetails(notePath)
        },
        {
            title: t("compress-images"),
            uiIcon: "bx bx-image",
            handler: () => {
                // An image note *is* one image, so the dialog is told its type and offers only the
                // settings that could reach it; any other note is a collection of however many.
                const mime = note.type === "image" ? note.mime : undefined;

                // Only once images were actually replaced: their notes just changed size, and the
                // views take a reading when asked rather than following the database. A run that
                // compressed nothing — or failed, which answers as no run — leaves them be.
                void showImageCompressionDialog({ type: "note", noteId, mime })
                    .then((result) => result?.compressedCount && onContentChanged());
            }
        },

        { kind: "separator" },

        ...(isDownloadable(note) ? [ {
            title: t("file_properties.download"),
            uiIcon: "bx bx-download",
            enabled: note.isContentAvailable(),
            handler: () => downloadFileNote(note, null, null)
        } ] : []),
        {
            title: t("tree-context-menu.export"),
            uiIcon: "bx bx-export",
            enabled: !!parentNoteId,
            handler: () => {
                void appContext.triggerCommand("showExportDialog", {
                    notePath: notePathString,
                    defaultType: "subtree"
                });
            }
        },

        // The root cannot be deleted at all, so it is left out rather than shown struck through —
        // and its separator goes with it, or the menu would end on a dangling divider.
        ...(isRoot ? [] : [
            { kind: "separator" as const },
            {
                title: t("tree-context-menu.delete"),
                uiIcon: "bx bx-trash destructive-action-icon",
                enabled: !!branchId,
                handler: () => {
                    if (!branchId) {
                        return;
                    }

                    // Only once the deletion actually happened: `deleteNotes` answers false when
                    // the user backs out of its confirmation, and re-measuring the whole database
                    // for a cancelled action is exactly what the views avoid doing.
                    void branches.deleteNotes([ branchId ], false, false)
                        .then((deleted) => deleted && onContentChanged());
                }
            }
        ])
    ];

    await contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items,
        // Every item carries its own handler; nothing here dispatches a command by name.
        selectMenuItemHandler: () => {}
    });
}

/**
 * The menu on the deleted-notes cell, which stands for space the tree has already let go of but the
 * database still holds until the retention window runs out. Its one action is releasing that space
 * now — the same erasure the Recent Changes dialog and the options page run, and confirmation-free
 * as it is there.
 *
 * Only the wording is this tool's own: the erasure takes deleted attachments with it, whose owning
 * notes may well be alive, and here the cell is measured in bytes rather than listed as notes — so
 * it says "deleted data" where Recent Changes, which lists exactly the notes it will erase, says
 * "deleted notes".
 */
export async function openDeletedNotesContextMenu(
    event: ContextMenuEvent,
    onContentChanged: ContentChangedHandler
) {
    event.preventDefault();
    event.stopPropagation();

    await contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [ {
            title: t("space_usage.menu_erase_deleted"),
            uiIcon: "bx bx-trash destructive-action-icon",
            handler: () => {
                void server.post("notes/erase-deleted-notes-now").then(() => {
                    toast.showMessage(t("space_usage.erase_deleted_message"));
                    // The cell just lost everything it stood for, so the section has to measure
                    // again — the views take a reading when asked, never on their own.
                    onContentChanged();
                });
            }
        } ],
        selectMenuItemHandler: () => {}
    });
}

/**
 * The menu on the revisions cell, offering the same trimming as the options page: dropping the
 * snapshots each note keeps beyond its limit.
 *
 * Without a limit set, nothing is excess and the action would do nothing at all — so it says why and
 * shows the setting instead, by taking the settings dialog it is already inside to the card that
 * holds it, the way the deleted-notes view offers its own retention settings.
 */
export async function openRevisionsContextMenu(
    event: ContextMenuEvent,
    onContentChanged: ContentChangedHandler
) {
    event.preventDefault();
    event.stopPropagation();

    await contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [ {
            title: t("revisions_snapshot_limit.erase_excess_revision_snapshots"),
            uiIcon: "bx bx-trash destructive-action-icon",
            handler: () => {
                // A negative limit is the one that keeps everything, so there is nothing to trim
                // down to; 0 is a limit like any other, and erases every snapshot there is. An
                // unreadable option is treated as no limit rather than as the harshest one.
                if ((options.getInt("revisionSnapshotNumberLimit") ?? -1) < 0) {
                    // Offered rather than done: the card lives on another settings page, and being
                    // taken off the map is only worth it for someone who means to set the limit.
                    void dialog.confirm(t("space_usage.revisions_limit_required"))
                        .then(async (confirmed) => {
                            if (confirmed) {
                                await appContext.triggerCommand("showOptions", { section: "_optionsOther" });
                                await revealRevisionLimitField();
                            }
                        });
                    return;
                }

                void server.post("revisions/erase-all-excess-revisions").then(() => {
                    toast.showMessage(t("revisions_snapshot_limit.erase_excess_revision_snapshots_prompt"));
                    onContentChanged();
                });
            }
        } ],
        selectMenuItemHandler: () => {}
    });
}

/**
 * The default action on a Space Usage note: the quick-edit popup, which stacks above the settings
 * dialog instead of replacing what the user was looking at.
 */
export function quickEditNote(notePath: string[]) {
    void appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath.join("/") });
}

/**
 * The same popup, showing one of the note's attachments instead of the note itself — what the
 * composition ring's attachment segments stand for.
 */
export function quickEditAttachment(notePath: string[], attachmentId: string) {
    void appContext.triggerCommand("openInPopup", {
        noteIdOrPath: notePath.join("/"),
        viewScope: { viewMode: "attachments", attachmentId }
    });
}

/** Opens the note in a new tab, leaving the settings page in place. */
export function openNoteInNewTab(noteId: string) {
    void appContext.tabManager.openContextWithNote(noteId, {
        activate: true,
        hoistedNoteId: appContext.tabManager.getActiveContext()?.hoistedNoteId ?? null
    });
}

/** Note types whose content is a saveable file — the same ones the ribbon offers Download for. */
function isDownloadable(note: FNote) {
    return note.type === "file" || note.type === "image";
}

/**
 * Brings the snapshot limit field into view with the cursor in it, once the settings page holding it
 * has rendered: someone who accepted being taken there should land on the field to fill in, not on a
 * page to search through.
 *
 * The field is found by its name, which the settings row keeps as given (its `id` carries a random
 * suffix, being unique per mount). Awaited in short steps because the page renders after the command
 * that asks for it, and given up on quietly — a page that never came is not worth an error.
 */
async function revealRevisionLimitField() {
    for (let attempt = 0; attempt < 20; attempt++) {
        const field = document.querySelector<HTMLElement>('[name="revision-snapshot-number-limit"]');

        if (field) {
            // Focused first, without the jump it would cause on its own, so the smooth scroll is
            // the only movement the eye has to follow.
            field.focus({ preventScroll: true });
            field.scrollIntoView({ block: "center", behavior: "smooth" });
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
