import type { EquivalentNotesResponse } from "@triliumnext/commons";
import type { Request } from "../../http_interface";

import { buildEquivalentNotesResponse } from "../../services/equivalence.js";

function getEquivalentNotes(req: Request<{ noteId: string }>): EquivalentNotesResponse {
    return buildEquivalentNotesResponse(req.params.noteId);
}

export default {
    getEquivalentNotes
};
