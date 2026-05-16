"use strict";

import type NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";

import Expression from "./expression.js";

class TrueExp extends Expression {
    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext): NoteSet {
        return inputNoteSet;
    }
}

export default TrueExp;
