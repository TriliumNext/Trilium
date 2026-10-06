import type { SearchWithTokensResponse } from "@triliumnext/commons";

import type Component from "../components/component.js";
import froca from "./froca.js";
import server from "./server.js";
import toast from "./toast.js";
import { getErrorMessage } from "./utils.js";

async function searchForNoteIds(searchString: string) {
    return await server.get<string[]>(`search?searchString=${encodeURIComponent(searchString)}`);
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
        `search?searchString=${encodeURIComponent(searchString)}`
        + `&ancestorNoteId=${encodeURIComponent(ancestorNoteId)}&includeTokens=true`);
}

/**
 * Runs a saved search and triggers `searchRefreshed` so the tab shows its results. Returns the
 * query's error for the caller to show, or `undefined` after showing a failed request as a toast.
 */
async function runSearchNote(component: Component | null | undefined, noteId: string, ntxId: string | null | undefined) {
    let result: { error: string | undefined } | undefined;
    try {
        result = { error: (await froca.loadSearchNote(noteId))?.error ?? undefined };
    } catch (e: unknown) {
        toast.showError(getErrorMessage(e));
    }

    component?.triggerEvent("searchRefreshed", { ntxId });
    return result;
}

export default {
    searchForNoteIds,
    searchForNotes,
    searchInSubtree,
    runSearchNote
};
