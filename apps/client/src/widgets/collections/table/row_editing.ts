import { RefObject } from "preact";
import { EventCallBackMethods, RowComponent, Tabulator } from "tabulator-tables";

import { CommandListenerData } from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import { setAttribute, setLabel } from "../../../services/attributes";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import note_create, { CreateNoteOpts } from "../../../services/note_create";
import server from "../../../services/server";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import { useLegacyImperativeHandlers } from "../../react/hooks";

export default function useRowTableEditing(api: RefObject<Tabulator>, attributeDetailWidget: AttributeDetailWidget, parentNote: FNote): Partial<EventCallBackMethods> {
    // Adding new rows
    useLegacyImperativeHandlers({
        addNewRowCommand({ customOpts, parentNotePath: customNotePath }: CommandListenerData<"addNewRow">) {
            const notePath = customNotePath ?? parentNote.noteId;
            if (notePath) {
                const opts: CreateNoteOpts = {
                    activate: false,
                    isProtected: parentNote.isProtected,
                    ...customOpts
                };
                note_create.createNote(notePath, opts).then(({ branch }) => {
                    if (branch) {
                        setTimeout(() => {
                            if (!api.current) return;
                            focusOnBranch(api.current, branch?.branchId);
                        }, 100);
                    }
                });
            }
        }
    });

    // Editing existing rows.
    return {
        cellEdited: async (cell) => {
            const noteId = cell.getRow().getData().noteId;
            const field = cell.getField();
            let newValue = cell.getValue();

            if (field === "title") {
                server.put(`notes/${noteId}/title`, { title: newValue });
                return;
            }

            if (field.includes(".")) {
                const [ type, name ] = field.split(".", 2);
                if (type === "labels") {
                    if (typeof newValue === "boolean") {
                        newValue = newValue ? "true" : "false";
                    } else if (typeof newValue === "number") {
                        newValue = String(newValue);
                    }
                    setLabel(noteId, name, newValue);
                } else if (type === "relations") {
                    const note = await froca.getNote(noteId);
                    if (note) {
                        setAttribute(note, "relation", name, newValue);
                    }
                }
            }
        },
        rowMoved(row) {
            const branchIdsToMove = [ row.getData().branchId ];

            const prevRow = row.getPrevRow();
            if (prevRow) {
                branches.moveAfterBranch(branchIdsToMove, prevRow.getData().branchId);
                return;
            }

            const nextRow = row.getNextRow();
            if (nextRow) {
                branches.moveBeforeBranch(branchIdsToMove, nextRow.getData().branchId);
            }
        }
    };
}

function focusOnBranch(api: Tabulator, branchId: string) {
    const row = findRowDataById(api.getRows(), branchId);
    if (!row) return;

    // Expand the parent tree if any.
    if (api.options.dataTree) {
        const parent = row.getTreeParent();
        if (parent) {
            parent.treeExpand();
        }
    }

    row.getCell("title").edit();
}

function findRowDataById(rows: RowComponent[], branchId: string): RowComponent | null {
    for (const row of rows) {
        const item = row.getIndex() as string;

        if (item === branchId) {
            return row;
        }

        const found = findRowDataById(row.getTreeChildren(), branchId);
        if (found) return found;
    }
    return null;
}
