import { AttributeRow } from "@triliumnext/commons";

import FNote from "../../../entities/fnote";
import { setAttribute, setLabel } from "../../../services/attributes";
import note_create from "../../../services/note_create";

interface NewEventOpts {
    title: string;
    startDate: string;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    componentId?: string;
}

interface ChangeEventOpts {
    startDate: string;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    componentId?: string;
}

export async function newEvent(parentNote: FNote, { title, startDate, endDate, startTime, endTime, componentId }: NewEventOpts) {
    const attributes: Omit<AttributeRow, "noteId" | "attributeId">[] = [];
    attributes.push({
        type: "label",
        name: "startDate",
        value: startDate
    });
    if (endDate) {
        attributes.push({
            type: "label",
            name: "endDate",
            value: endDate
        });
    }
    if (startTime) {
        attributes.push({
            type: "label",
            name: "startTime",
            value: startTime
        });
    }
    if (endTime) {
        attributes.push({
            type: "label",
            name: "endTime",
            value: endTime
        });
    }

    // Create the note.
    await note_create.createNote(parentNote.noteId, {
        title,
        isProtected: parentNote.isProtected,
        content: "",
        type: "text",
        attributes,
        activate: false
    }, componentId);
}

export async function changeEvent(note: FNote, { startDate, endDate, startTime, endTime, componentId }: ChangeEventOpts) {
    // Don't store the end date if it's empty.
    if (endDate === startDate) {
        endDate = undefined;
    }

    // Since they can be customized via calendar:startDate=$foo and calendar:endDate=$bar we need to determine the
    // attributes to be effectively updated
    let startAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:startDate").shift()?.value||"startDate";
    let endAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:endDate").shift()?.value||"endDate";

    const noteId = note.noteId;
    setLabel(noteId, startAttribute, startDate, false, componentId);
    setAttribute(note, "label", endAttribute, endDate, componentId);

    startAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:startTime").shift()?.value||"startTime";
    endAttribute = note.getAttributes("label").filter(attr => attr.name == "calendar:endTime").shift()?.value||"endTime";

    setAttribute(note, "label", startAttribute, startTime, componentId);
    setAttribute(note, "label", endAttribute, endTime, componentId);
}
