import { EventCallBackMethods, RowComponent, Tabulator } from "tabulator-tables";
import { CommandListenerData } from "../../../components/app_context";
import note_create, { CreateNoteOpts } from "../../../services/note_create";
import { useLegacyImperativeHandlers } from "../../react/hooks";
import { RefObject } from "preact";
import { setAttribute, setLabel } from "../../../services/attributes";
import froca from "../../../services/froca";
import server from "../../../services/server";
import branches from "../../../services/branches";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";

export default function useRowTableEditing(api: RefObject<Tabulator>, attributeDetailWidget: AttributeDetailWidget, parentNotePath: string): Partial<EventCallBackMethods> {
    // Adding new rows
    useLegacyImperativeHandlers({
        addNewRowCommand({ customOpts, parentNotePath: customNotePath }: CommandListenerData<"addNewRow">) {
            const notePath = customNotePath ?? parentNotePath;
            if (notePath) {
                const opts: CreateNoteOpts = {
                    activate: false,
                    ...customOpts
                }
                note_create.createNote(notePath, opts).then(({ branch }) => {
                    if (branch) {
                        setTimeout(() => {
                            if (!api.current) return;
                            focusOnBranch(api.current, branch?.branchId);
                        }, 100);
                    }
                })
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
    for (let row of rows) {
        const item = row.getIndex() as string;

        if (item === branchId) {
            return row;
        }

        let found = findRowDataById(row.getTreeChildren(), branchId);
        if (found) return found;
    }
    return null;
}
