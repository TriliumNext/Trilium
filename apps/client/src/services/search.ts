import froca from "./froca.js";
import server from "./server.js";

async function searchForNoteIds(searchString: string) {
    return await server.get<string[]>(`search/${encodeURIComponent(searchString)}`);
}

async function searchForNotes(searchString: string) {
    const noteIds = await searchForNoteIds(searchString);

    return await froca.getNotes(noteIds);
}

async function searchForNotesIncludingHidden(searchString: string) {
    const result = await server.get<{ searchResultNoteIds?: string[] }>(`quick-search/${encodeURIComponent(searchString)}`);
    return await froca.getNotes(result.searchResultNoteIds || []);
}

export default {
    searchForNoteIds,
    searchForNotes,
    searchForNotesIncludingHidden
};
