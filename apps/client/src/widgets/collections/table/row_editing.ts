import { RefObject } from "preact";
import { useContext } from "preact/hooks";
import { EventCallBackMethods, RowComponent, Tabulator } from "tabulator-tables";

import { CommandListenerData } from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import { setAttribute, setLabel, setLabelValues, setRelationValues } from "../../../services/attributes";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import note_create, { CreateNoteOpts } from "../../../services/note_create";
import server from "../../../services/server";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import { useLegacyImperativeHandlers } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";

export default function useRowTableEditing(api: RefObject<Tabulator | null>, attributeDetailWidget: AttributeDetailWidget, parentNote: FNote): Partial<EventCallBackMethods> {
    // Whose writes these are, so that useData can tell a cell this table edited itself from one
    // changed elsewhere. Rebuilding the rows for its own edit replaces them wholesale in Tabulator,
    // which cancels the editor Tab has just opened in the next cell.
    const componentId = useContext(ParentComponent)?.componentId;

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
                // Off the button, so that keys meant for the new title can't press it again.
                if (document.activeElement instanceof HTMLButtonElement) {
                    document.activeElement.blur();
                }
                note_create.createNote(notePath, opts).then(({ branch }) => {
                    if (branch) {
                        focusWhenShown(api, branch.branchId);
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
                server.put(`notes/${noteId}/title`, { title: newValue }, componentId);
                return;
            }

            if (field.includes(".")) {
                const [ type, name ] = field.split(".", 2);
                if (type === "labels") {
                    // A set of values is written as the several labels it is, rather than as one
                    // holding the array stringified.
                    if (Array.isArray(newValue)) {
                        const note = await froca.getNote(noteId);
                        if (note) {
                            await setLabelValues(note, name, newValue as string[], componentId);
                        }
                        return;
                    }

                    if (typeof newValue === "boolean") {
                        newValue = newValue ? "true" : "false";
                    } else if (typeof newValue === "number") {
                        newValue = String(newValue);
                    }
                    setLabel(noteId, name, newValue, false, componentId);
                } else if (type === "relations") {
                    const note = await froca.getNote(noteId);
                    if (note) {
                        // A set of targets is written as the several relations it is, as a set of
                        // label values is.
                        if (Array.isArray(newValue)) {
                            await setRelationValues(note, name, newValue as string[], componentId);
                        } else {
                            setAttribute(note, "relation", name, newValue, componentId);
                        }
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

/** The new row arrives with the next rebuild of the rows, which in a long table takes a while. */
function focusWhenShown(api: RefObject<Tabulator | null>, branchId: string, attempts = 20) {
    setTimeout(() => {
        if (!api.current) return;
        if (!focusOnBranch(api.current, branchId) && attempts > 1) {
            focusWhenShown(api, branchId, attempts - 1);
        }
    }, 100);
}

function focusOnBranch(api: Tabulator, branchId: string) {
    const row = findRowDataById(api.getRows(), branchId);
    if (!row) return false;

    // Expand the parent tree if any.
    if (api.options.dataTree) {
        const parent = row.getTreeParent();
        if (parent) {
            parent.treeExpand();
        }
    }

    // A row past the rendered part of a long table has no cell to edit until it is scrolled to.
    void row.scrollTo("nearest", false).catch(() => {}).then(() => row.getCell("title").edit());
    return true;
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
