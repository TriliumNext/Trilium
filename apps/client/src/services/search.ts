import server from "./server.js";
import froca from "./froca.js";

async function searchForNoteIds(searchString: string) {
    return await server.get<string[]>(`search?searchString=${encodeURIComponent(searchString)}`);
}

async function searchForNotes(searchString: string) {
    const noteIds = await searchForNoteIds(searchString);

    return await froca.getNotes(noteIds);
}

export default {
    searchForNoteIds,
    searchForNotes
};
