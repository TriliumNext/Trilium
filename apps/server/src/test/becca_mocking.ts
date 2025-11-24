import BNote from "../becca/entities/bnote.js";
import BBranch from "../becca/entities/bbranch.js";
import BAttribute from "../becca/entities/battribute.js";
import becca from "../becca/becca.js";
import randtoken from "rand-token";
import type SearchResult from "../services/search/search_result.js";
import type { NoteRow, NoteType } from "@triliumnext/commons";
randtoken.generator({ source: "crypto" });

export function findNoteByTitle(searchResults: Array<SearchResult>, title: string): BNote | undefined {
    return searchResults.map((sr) => becca.notes[sr.noteId]).find((note) => note.title === title);
}

export class NoteBuilder {
    note: BNote;
    constructor(note: BNote) {
        this.note = note;
    }

    label(name: string, value = "", isInheritable = false) {
        new BAttribute({
            attributeId: id(),
            noteId: this.note.noteId,
            type: "label",
            isInheritable,
            name,
            value
        });

        return this;
    }

    relation(name: string, targetNote: BNote) {
        new BAttribute({
            attributeId: id(),
            noteId: this.note.noteId,
            type: "relation",
            name,
            value: targetNote.noteId
        });

        return this;
    }

    child(childNoteBuilder: NoteBuilder, prefix = "") {
        new BBranch({
            branchId: id(),
            noteId: childNoteBuilder.note.noteId,
            parentNoteId: this.note.noteId,
            prefix,
            notePosition: 10
        });

        return this;
    }
}

export function id() {
    return randtoken.generate(10);
}

export function note(title: string, extraParams: Partial<NoteRow> = {}) {
    const row = Object.assign(
        {
            noteId: id(),
            title: title,
            type: "text" as NoteType,
            mime: "text/html"
        },
        extraParams
    );

    const note = new BNote(row);

    return new NoteBuilder(note);
}
