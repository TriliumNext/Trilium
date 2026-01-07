import BNote from "src/becca/entities/bnote";

export default {
    searchFromNote(note: BNote) {
        console.warn("Ignore search ", note.title);
    },

    searchNotes(searchString: string, opts?: {}): BNote[] {
        console.warn("Ignore search", searchString);
        return [];
    }
}
