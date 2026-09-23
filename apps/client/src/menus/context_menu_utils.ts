import type FNote from "../entities/fnote"
import type { MenuItem } from "./context_menu"
import { t } from "../services/i18n"
import { setArchivedOnNotes, shared } from "../services/note_set"
import { escapeHtml } from "../services/utils"

/**
 * The entry that archives the notes, or unarchives them when they are all archived already.
 *
 * Returns nothing where the notes disagree: one entry cannot say what picking it would do, and
 * both entries at once would read as two states the same notes are in.
 */
export function getArchiveMenuItems<T>(notes: FNote[]): MenuItem<T>[] {
    const state = shared(notes, (note) => note.isArchived)
    if (!state.agreed) {
        return []
    }

    return [ state.value
        ? {
            title: t("board_view.unarchive-note"),
            uiIcon: "bx bx-archive-out",
            handler: () => { void setArchivedOnNotes(notes, false) }
        }
        : {
            title: t("board_view.archive-note"),
            uiIcon: "bx bx-archive",
            handler: () => { void setArchivedOnNotes(notes, true) }
        } ]
}

/**
 * A name the user wrote, as a menu title.
 *
 * A menu reads a title as markup, so the name is escaped into the text it is meant to be, and boxed
 * so that `style.css` clips a long one rather than letting it widen the menu.
 */
export function menuName(name: string) {
    return `<span class="tn-menu-name">${escapeHtml(name)}</span>`
}
