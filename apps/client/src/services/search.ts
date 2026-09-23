import type { SearchWithTokensResponse } from "@triliumnext/commons";

import server from "./server.js";
import froca from "./froca.js";

async function searchForNoteIds(searchString: string) {
    return await server.get<string[]>(`search/${encodeURIComponent(searchString)}`);
}

async function searchForNotes(searchString: string) {
    const noteIds = await searchForNoteIds(searchString);

    return await froca.getNotes(noteIds);
}

/**
 * Runs a search restricted to one subtree and returns the matching note ids together with the
 * tokens to highlight and any parse error, for filtering a collection down to the matches.
 */
async function searchInSubtree(searchString: string, ancestorNoteId: string) {
    return await server.get<SearchWithTokensResponse>(
        `search/${encodeURIComponent(searchString)}`
        + `?ancestorNoteId=${encodeURIComponent(ancestorNoteId)}&includeTokens=true`);
}

export default {
    searchForNoteIds,
    searchForNotes,
    searchInSubtree
};
