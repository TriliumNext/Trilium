"use strict";

import type NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";

export default abstract class Expression {
    name: string;

    constructor() {
        this.name = this.constructor.name; // for DEBUG mode to have expression name as part of dumped JSON
    }

    abstract execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext): NoteSet;
}
