"use strict";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";

/**
 * Note is hidden when all its note paths start in hidden subtree (i.e., the note is not cloned into visible tree)
 */
class IsHiddenExp extends Expression {
    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        const resultNoteSet = new NoteSet();

        for (const note of inputNoteSet.notes) {
            if (note.isHiddenCompletely()) {
                resultNoteSet.add(note);
            }
        }

        return resultNoteSet;
    }
}

export default IsHiddenExp;
