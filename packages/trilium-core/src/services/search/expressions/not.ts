"use strict";

import type NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import Expression from "./expression.js";

class NotExp extends Expression {
    subExpression: Expression;

    constructor(subExpression: Expression) {
        super();

        this.subExpression = subExpression;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        const subNoteSet = this.subExpression.execute(inputNoteSet, executionContext, searchContext);

        return inputNoteSet.minus(subNoteSet);
    }
}

export default NotExp;
