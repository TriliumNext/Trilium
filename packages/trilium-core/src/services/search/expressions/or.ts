"use strict";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import TrueExp from "./true.js";
import type SearchContext from "../search_context.js";

class OrExp extends Expression {
    subExpressions: Expression[];

    static of(subExpressions: Expression[]) {
        subExpressions = subExpressions.filter((exp) => !!exp);

        if (subExpressions.length === 1) {
            return subExpressions[0];
        } else if (subExpressions.length > 0) {
            return new OrExp(subExpressions);
        } else {
            return new TrueExp();
        }
    }

    constructor(subExpressions: Expression[]) {
        super();

        this.subExpressions = subExpressions;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        const resultNoteSet = new NoteSet();

        for (const subExpression of this.subExpressions) {
            resultNoteSet.mergeIn(subExpression.execute(inputNoteSet, executionContext, searchContext));
        }

        return resultNoteSet;
    }
}

export default OrExp;
