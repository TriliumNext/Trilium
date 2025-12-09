import { useLegacyImperativeHandlers } from "../../react/hooks";
import { Attribute } from "../../../services/attribute_parser";
import { RefObject } from "preact";
import { Tabulator } from "tabulator-tables";
import { useRef } from "preact/hooks";
import { CommandListenerData, EventData } from "../../../components/app_context";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import attributes from "../../../services/attributes";
import FNote from "../../../entities/fnote";
import { getAttributeFromField } from "./utils";
import dialog from "../../../services/dialog";
import { t } from "i18next";
import { executeBulkActions } from "../../../services/bulk_action";

export default function useColTableEditing(api: RefObject<Tabulator>, attributeDetailWidget: AttributeDetailWidget, parentNote: FNote) {

    const existingAttributeToEdit = useRef<Attribute>();
    const newAttribute = useRef<Attribute>();
    const newAttributePosition = useRef<number>();

    useLegacyImperativeHandlers({
        addNewTableColumnCommand({ referenceColumn, columnToEdit, direction, type }: EventData<"addNewTableColumn">) {
            let attr: Attribute | undefined;

            existingAttributeToEdit.current = undefined;
            if (columnToEdit) {
                attr = getAttributeFromField(parentNote, columnToEdit.getField());
                if (attr) {
                    existingAttributeToEdit.current = { ...attr };
                }
            }

            if (!attr) {
                attr = {
                    type: "label",
                    name: `${type ?? "label"}:myLabel`,
                    value: "promoted,single,text",
                    isInheritable: true
                };
            }

            if (referenceColumn && api.current) {
                let newPosition = api.current.getColumns().indexOf(referenceColumn);
                if (direction === "after") {
                    newPosition++;
                }

                newAttributePosition.current = newPosition;
            } else {
                newAttributePosition.current = undefined;
            }

            attributeDetailWidget.showAttributeDetail({
                attribute: attr,
                allAttributes: [ attr ],
                isOwned: true,
                x: 0,
                y: 150,
                focus: "name",
                hideMultiplicity: true
            });
        },
        async updateAttributeListCommand({ attributes }: CommandListenerData<"updateAttributeList">) {
            newAttribute.current = attributes[0];
        },
        async saveAttributesCommand() {
            if (!newAttribute.current || !api.current) {
                return;
            }

            const { name, value, isInheritable } = newAttribute.current;

            api.current.blockRedraw();
            const isRename = (existingAttributeToEdit.current && existingAttributeToEdit.current.name !== name);
            try {
                if (isRename) {
                    const oldName = existingAttributeToEdit.current!.name.split(":")[1];
                    const [ type, newName ] = name.split(":");
                    await renameColumn(parentNote.noteId, type as "label" | "relation", oldName, newName);
                }

                if (existingAttributeToEdit.current && (isRename || existingAttributeToEdit.current.isInheritable !== isInheritable)) {
                    attributes.removeOwnedLabelByName(parentNote, existingAttributeToEdit.current.name);
                }
                attributes.setLabel(parentNote.noteId, name, value, isInheritable);
            } finally {
                api.current.restoreRedraw();
            }
        },
        async deleteTableColumnCommand({ columnToDelete }: CommandListenerData<"deleteTableColumn">) {
            if (!api.current || !columnToDelete || !await dialog.confirm(t("table_view.delete_column_confirmation"))) {
                return;
            }

            let [ type, name ] = columnToDelete.getField()?.split(".", 2);
            if (!type || !name) {
                return;
            }
            type = type.replace("s", "");

            api.current.blockRedraw();
            try {
                await deleteColumn(parentNote.noteId, type as "label" | "relation", name);
                attributes.removeOwnedLabelByName(parentNote, `${type}:${name}`);
            } finally {
                api.current.restoreRedraw();
            }
        }
    });

    function resetNewAttributePosition() {
        newAttribute.current = undefined;
        newAttributePosition.current = undefined;
        existingAttributeToEdit.current = undefined;
    }

    return { newAttributePosition, resetNewAttributePosition };
}

async function deleteColumn(parentNoteId: string, type: "label" | "relation", columnName: string) {
    if (type === "label") {
        return executeBulkActions([parentNoteId], [{
            name: "deleteLabel",
            labelName: columnName
        }], true);
    } else {
        return executeBulkActions([parentNoteId], [{
            name: "deleteRelation",
            relationName: columnName
        }], true);
    }
}

async function renameColumn(parentNoteId: string, type: "label" | "relation", originalName: string, newName: string) {
    if (type === "label") {
        return executeBulkActions([parentNoteId], [{
            name: "renameLabel",
            oldLabelName: originalName,
            newLabelName: newName
        }], true);
    } else {
        return executeBulkActions([parentNoteId], [{
            name: "renameRelation",
            oldRelationName: originalName,
            newRelationName: newName
        }], true);
    }
}
