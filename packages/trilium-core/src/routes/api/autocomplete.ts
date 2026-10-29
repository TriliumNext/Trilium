import type { Request } from "../../http_interface";

import { getHoistedNoteId } from "../../services/context.js";
import { executeSearch } from "../../services/search/search_executor.js";

function getAutocomplete(req: Request) {
    const { query, fastSearch, limit, filter, activeNoteId } = req.query;
    return executeSearch("autocomplete", {
        hoistedNoteId: getHoistedNoteId(), query, fastSearch, limit, filter, activeNoteId
    });
}

export default {
    getAutocomplete
};
