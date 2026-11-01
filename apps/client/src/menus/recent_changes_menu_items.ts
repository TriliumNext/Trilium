import appContext, { type CommandNames } from "../components/app_context";
import froca from "../services/froca";
import hoistedNoteService from "../services/hoisted_note";
import { t } from "../services/i18n";
import server from "../services/server";
import type { MenuCommandItem, MenuItem } from "./context_menu";
import { notePathMenuItem } from "./context_menu_utils";

/** The number of notes the "Recently changed notes" section lists. */
const RECENT_CHANGES_LIMIT = 15;

/**
 * Returns the "Recently changed notes" menu section: the most recently changed notes that have no
 * open tab, newest first, followed by an entry that opens the Recent changes dialog.
 */
export async function getRecentChangesMenuItems(): Promise<MenuItem<CommandNames>[]> {
    const noteItems = await getRecentlyChangedNoteItems();

    return [
        { kind: "header", title: t("tab_row.recently_changed_notes") },
        ...noteItems,
        ...(noteItems.length > 0 ? [ { kind: "separator" } as const ] : []),
        {
            title: t("tab_row.show_all_recent_changes"),
            command: "showRecentChanges",
            uiIcon: "bx bx-history",
            keyboardShortcut: "showRecentChanges"
        }
    ];
}

/**
 * Returns the "Recently changed notes" heading and its notes, without the entry that opens the
 * Recent changes dialog. Returns nothing when no note qualifies.
 */
export async function getRecentlyChangedNotesMenuItems(): Promise<MenuItem<CommandNames>[]> {
    const noteItems = await getRecentlyChangedNoteItems();
    if (noteItems.length === 0) {
        return [];
    }

    return [ { kind: "header", title: t("tab_row.recently_changed_notes") }, ...noteItems ];
}

/** Returns the recently changed notes as menu rows, or no rows when they cannot be loaded. */
async function getRecentlyChangedNoteItems(): Promise<MenuCommandItem<CommandNames>[]> {
    try {
        return await loadRecentlyChangedNoteItems();
    } catch (e) {
        console.error("Failed to load the recently changed notes:", e);
        return [];
    }
}

async function loadRecentlyChangedNoteItems(): Promise<MenuCommandItem<CommandNames>[]> {
    const hoistedNoteId = hoistedNoteService.getHoistedNoteId();
    const openNoteIds = new Set<string>();
    for (const noteContext of appContext.tabManager.getNoteContexts()) {
        if (noteContext.noteId) {
            openNoteIds.add(noteContext.noteId);
        }
    }

    // Requests one extra note per open tab, because open notes are removed from the list.
    const limit = RECENT_CHANGES_LIMIT + openNoteIds.size;
    const noteIds = await server.get<string[]>(
        `recent-changes/${hoistedNoteId}/note-ids?limit=${limit}`
    );
    const notes = await froca.getNotes(
        noteIds.filter((noteId) => !openNoteIds.has(noteId)).slice(0, RECENT_CHANGES_LIMIT),
        true
    );

    const items: MenuCommandItem<CommandNames>[] = [];
    for (const note of notes) {
        const notePath = note.getBestNotePathString(hoistedNoteId);
        if (!notePath) {
            continue;
        }

        items.push(await notePathMenuItem(notePath, () => {
            void appContext.tabManager.openTabWithNoteWithHoisting(notePath, { activate: true });
        }));
    }

    return items;
}
