"use strict";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";

class ParentOfExp extends Expression {
    private subExpression: Expression;

    constructor(subExpression: Expression) {
        super();

        this.subExpression = subExpression;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        const subInputNoteSet = new NoteSet();

        for (const note of inputNoteSet.notes) {
            subInputNoteSet.addAll(note.children);
        }

        const subResNoteSet = this.subExpression.execute(subInputNoteSet, executionContext, searchContext);

        const resNoteSet = new NoteSet();

        for (const childNote of subResNoteSet.notes) {
            for (const parentNote of childNote.parents) {
                if (inputNoteSet.hasNote(parentNote)) {
                    resNoteSet.add(parentNote);
                }
            }
        }

        return resNoteSet;
    }
}

export default ParentOfExp;
