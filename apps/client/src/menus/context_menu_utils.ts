import type FNote from "../entities/fnote"
import type { MenuCommandItem, MenuItem } from "./context_menu"
import froca from "../services/froca"
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

/** A row with the icon and title of the note at `notePath`, with its path in the shortcut slot. */
export async function notePathMenuItem<T>(
    notePath: string,
    handler: () => void
): Promise<MenuCommandItem<T>> {
    const { default: tree, NOTE_PATH_TITLE_SEPARATOR } = await import("../services/tree");
    const titles = await tree.getNotePathTitleComponents(notePath);
    const title = titles.pop() ?? "";
    const noteId = notePath.split("/").at(-1) ?? "";

    return {
        title: escapeHtml(title),
        trailingText: titles.join(NOTE_PATH_TITLE_SEPARATOR) || undefined,
        uiIcon: froca.getNoteFromCache(noteId)?.getIcon(),
        handler
    };
}

/**
 * A row that opens `items` as a submenu, enabled while any of their commands is, a row of actions
 * included.
 */
export function submenuItem<T>(
    row: Pick<MenuCommandItem<T>, "title" | "uiIcon">,
    items: MenuItem<T>[]
): MenuCommandItem<T> {
    return { ...row, enabled: items.some(isEnabledCommand), items }
}

/**
 * A row that runs `primary` on click and shows its shortcut. Its submenu lists `primary`, then
 * `variants`: a tap on a touch device only opens a submenu row.
 */
export function splitMenuItem<T>(
    primary: MenuCommandItem<T>,
    variants: MenuItem<T>[]
): MenuCommandItem<T> {
    return {
        ...submenuItem({ title: primary.title, uiIcon: primary.uiIcon }, [ primary, ...variants ]),
        shortcut: primary.shortcut,
        keyboardShortcut: primary.keyboardShortcut,
        handler: primary.enabled === false ? undefined : primary.handler
    }
}

function isEnabledCommand<T>(item: MenuItem<T>): boolean {
    if ("kind" in item) {
        return item.kind === "actions" && item.items.some(isEnabledCommand)
    }
    return item.enabled !== false
}
