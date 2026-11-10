"use strict";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import becca from "../../../becca/becca.js";
import type SearchContext from "../search_context.js";

type Comparator = (value: string) => boolean;

class LabelComparisonExp extends Expression {
    attributeType: string;
    attributeName: string;
    comparator: Comparator;

    constructor(attributeType: string, attributeName: string, comparator: Comparator) {
        super();

        this.attributeType = attributeType;
        this.attributeName = attributeName.toLowerCase();
        this.comparator = comparator;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        const attrs = becca.findAttributes(this.attributeType, this.attributeName);
        const resultNoteSet = new NoteSet();

        for (const attr of attrs) {
            const note = attr.note;
            const value = attr.value?.toLowerCase();

            if (inputNoteSet.hasNoteId(note.noteId) && this.comparator(value)) {
                if (attr.isInheritable) {
                    resultNoteSet.addAll(note.getSubtreeNotesIncludingTemplated());
                } else if (note.isInherited()) {
                    resultNoteSet.addAll(note.getInheritingNotes());
                } else {
                    resultNoteSet.add(note);
                }
            }
        }

        return resultNoteSet;
    }
}

export default LabelComparisonExp;
