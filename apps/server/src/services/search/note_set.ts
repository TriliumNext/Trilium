"use strict";

import type BNote from "../../becca/entities/bnote.js";

class NoteSet {
    private noteIdSet: Set<string>;

    notes: BNote[];
    sorted: boolean;

    constructor(notes: BNote[] = []) {
        this.notes = notes;
        this.noteIdSet = new Set(notes.map((note) => note.noteId));
        this.sorted = false;
    }

    add(note: BNote) {
        if (!this.hasNote(note)) {
            this.notes.push(note);
            this.noteIdSet.add(note.noteId);
        }
    }

    addAll(notes: BNote[]) {
        for (const note of notes) {
            this.add(note);
        }
    }

    hasNote(note: BNote) {
        return this.hasNoteId(note.noteId);
    }

    hasNoteId(noteId: string) {
        return this.noteIdSet.has(noteId);
    }

    mergeIn(anotherNoteSet: NoteSet) {
        this.addAll(anotherNoteSet.notes);
    }

    minus(anotherNoteSet: NoteSet) {
        const newNoteSet = new NoteSet();

        for (const note of this.notes) {
            if (!anotherNoteSet.hasNoteId(note.noteId)) {
                newNoteSet.add(note);
            }
        }

        return newNoteSet;
    }

    intersection(anotherNoteSet: NoteSet) {
        const newNoteSet = new NoteSet();

        for (const note of this.notes) {
            if (anotherNoteSet.hasNote(note)) {
                newNoteSet.add(note);
            }
        }

        return newNoteSet;
    }

    getNoteIds(): Set<string> {
        return new Set(this.noteIdSet);
    }
}

export default NoteSet;
