import type { Request } from "../../http_interface.js";

import becca from "../../becca/becca.js";
import { ValidationError } from "../../errors.js";
import {
    getReasoningReport,
    inferredAttributeIds,
    noteOpened,
    releaseInferred,
    runReasoning
} from "../../services/reasoning/reasoning.js";

function getReasoning(_req: Request) {
    return getReasoningReport();
}

function run(_req: Request) {
    return runReasoning();
}

function getInferred(req: Request<{ noteId: string }>) {
    return { attributeIds: inferredAttributeIds(req.params.noteId) };
}

function activate(req: Request<{ noteId: string }>) {
    const note = becca.notes[req.params.noteId];
    if (!note || note.isDeleted) {
        return;
    }
    noteOpened(req.params.noteId);
}

function keep(req: Request<{ noteId: string; attributeId: string }>) {
    const { noteId, attributeId } = req.params;
    const attribute = becca.getAttribute(attributeId);
    if (attribute && !attribute.isDeleted && attribute.noteId !== noteId) {
        throw new ValidationError(`Attribute ${attributeId} is not owned by ${noteId}`);
    }
    releaseInferred(attributeId);
}

export default {
    getReasoning,
    run,
    getInferred,
    activate,
    keep
};
