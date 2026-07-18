import { date_utils as dateUtils, note_types as noteTypeService } from "@triliumnext/core";

import { becca } from "@triliumnext/core";

function mandatory(obj: unknown) {
    if (obj === undefined) {
        return `mandatory, but not set`;
    }
}

function notNull(obj: unknown) {
    if (obj === null) {
        return `cannot be null`;
    }
}

function isString(obj: unknown) {
    if (obj === undefined || obj === null) {
        return;
    }

    if (typeof obj !== "string") {
        return `'${obj}' is not a string`;
    }
}

function isLocalDateTime(obj: unknown) {
    if (typeof obj !== "string") {
        return;
    }

    return dateUtils.validateLocalDateTime(obj);
}

function isUtcDateTime(obj: unknown) {
    if (typeof obj !== "string") {
        return;
    }

    return dateUtils.validateUtcDateTime(obj);
}

function isBoolean(obj: unknown) {
    if (obj === undefined || obj === null) {
        return;
    }

    if (typeof obj !== "boolean") {
        return `'${obj}' is not a boolean`;
    }
}

function isInteger(obj: unknown) {
    if (obj === undefined || obj === null) {
        return;
    }

    if (!Number.isInteger(obj)) {
        return `'${obj}' is not an integer`;
    }
}

function isNoteId(obj: unknown) {
    if (obj === undefined || obj === null) {
        return;
    }

    if (typeof obj !== "string") {
        return `'${obj}' is not a valid noteId`;
    }

    if (!(obj in becca.notes)) {
        return `Note '${obj}' does not exist`;
    }
}

function isNoteType(obj: unknown) {
    if (obj === undefined || obj === null) {
        return;
    }

    const noteTypes = noteTypeService.getNoteTypeNames();

    if (typeof obj !== "string" || !noteTypes.includes(obj)) {
        return `'${obj}' is not a valid note type, allowed types are: ${noteTypes.join(", ")}`;
    }
}

function isAttributeType(obj: unknown) {
    if (obj === undefined || obj === null) {
        return;
    }

    if (typeof obj !== "string" || !["label", "relation"].includes(obj)) {
        return `'${obj}' is not a valid attribute type, allowed types are: label, relation`;
    }
}

function isValidEntityId(obj: unknown) {
    if (obj === undefined || obj === null) {
        return;
    }

    if (typeof obj !== "string" || !/^[A-Za-z0-9_]{4,128}$/.test(obj)) {
        return `'${obj}' is not a valid entityId. Only alphanumeric characters are allowed of length 4 to 32.`;
    }
}

export default {
    mandatory,
    notNull,
    isString,
    isBoolean,
    isInteger,
    isNoteId,
    isNoteType,
    isAttributeType,
    isValidEntityId,
    isLocalDateTime,
    isUtcDateTime
};
