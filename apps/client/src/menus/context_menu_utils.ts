import { t } from "../services/i18n"
import attributes from "../services/attributes"
import FNote from "../entities/fnote"

export function getArchiveMenuItem(note: FNote) {
    if (!note.isArchived) {
        return {
            title: t("board_view.archive-note"),
            uiIcon: "bx bx-archive",
            handler: () => attributes.addLabel(note.noteId, "archived")
        }
    } else {
        return {
            title: t("board_view.unarchive-note"),
            uiIcon: "bx bx-archive-out",
            handler: async () => {
                attributes.removeOwnedLabelByName(note, "archived")
            }
        }
    }
}