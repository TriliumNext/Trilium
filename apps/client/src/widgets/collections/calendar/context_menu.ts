import type { CommandNames } from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import contextMenu, { ContextMenuEvent, type MenuItem } from "../../../menus/context_menu";
import { getArchiveMenuItems } from "../../../menus/context_menu_utils";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import link_context_menu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import { t } from "../../../services/i18n";
import { buildAttributeMenuItems } from "../attribute_menu";
import { type PromotedAttributeSetting, resolvePromotedAttributes } from "../promoted_attributes";
import { drawnEventLabels } from "./utils";

/**
 * Opens the menu of an event's note: the places to open it in, and on a calendar that is not
 * read-only, setting its attributes, archiving, deleting and coloring it.
 */
export function openCalendarContextMenu(e: ContextMenuEvent, note: FNote, parentNote: FNote, componentId?: string, isReadOnly = false,
    attributeSettings?: PromotedAttributeSetting[]) {
    e.preventDefault();
    e.stopPropagation();

    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: [
            ...link_context_menu.getItems(e),
            ...(isReadOnly ? [] : getEditingItems(note, parentNote, componentId, attributeSettings))
        ],
        selectMenuItemHandler: ({ command }) =>  link_context_menu.handleLinkContextMenuItem(command, e, note.noteId),
    });
}

function getEditingItems(note: FNote, calendar: FNote, componentId: string | undefined,
    attributeSettings: PromotedAttributeSetting[] | undefined): MenuItem<CommandNames>[] {
    // Resolved as `buildEvents()` resolves them, so the menu offers what the events show.
    const attributes = resolvePromotedAttributes(
        calendar, attributeSettings, drawnEventLabels(calendar), [ note ], { unarrangedHidden: true })
        .filter((attribute) => !attribute.drawnByCollection);

    const attributeItems = buildAttributeMenuItems<CommandNames>({ notes: [ note ], attributes });

    return [
        // The section opens with a heading, which draws its own line in place of a separator.
        ...(attributeItems.length ? attributeItems : [ { kind: "separator" } as const ]),
        { kind: "separator" },
        ...getArchiveMenuItems<CommandNames>([ note ]),
        {
            title: t("calendar_view.delete_note"),
            uiIcon: "bx bx-trash",
            handler: async () => {
                let branchIdToDelete: string | null = null;
                for (const parentBranch of note.getParentBranches()) {
                    const parentNote = await parentBranch.getNote();
                    if (parentNote?.hasAncestor(parentNote.noteId)) {
                        branchIdToDelete = parentBranch.branchId;
                    }
                }

                if (branchIdToDelete) {
                    await branches.deleteNotes([ branchIdToDelete ], false, false, componentId);
                }
            }
        },
        { kind: "separator" },
        {
            kind: "custom",
            componentFn: () => NoteColorPicker({note})
        }
    ];
}
