import type { SpaceUsageDeletedNotes } from "@triliumnext/commons";

import { t } from "../../../services/i18n";

/**
 * "0 deleted notes, 2 deleted attachments" — what the deleted bucket's size is actually spread over.
 *
 * Both counts are always named, however small either is: the size covers deleted notes and deleted
 * attachments together, and an attachment is deleted on its own whenever one is replaced (a canvas
 * re-render, a re-uploaded image). Naming only the notes made a database full of superseded
 * attachments read as "840 MiB in 0 notes".
 */
export function deletedEntitiesLabel(deleted?: SpaceUsageDeletedNotes) {
    return t("space_usage.deleted_entities", {
        notes: t("space_usage.deleted_notes", { count: deleted?.noteCount ?? 0 }),
        attachments: t("space_usage.deleted_attachments", { count: deleted?.attachmentCount ?? 0 })
    });
}
