"use strict";

import type BNote from "../../../becca/entities/bnote.js";
import { compareSortValues, isDate, isNumber } from "../../utils/sort_values.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import Expression from "./expression.js";

interface ValueExtractor {
    extract: (note: BNote) => number | string | null;
}

interface OrderDefinition {
    direction?: string;
    smaller: number;
    larger: number;
    valueExtractor: ValueExtractor;
}

class OrderByAndLimitExp extends Expression {
    private orderDefinitions: OrderDefinition[];
    limit: number;
    subExpression: Expression | null;

    constructor(orderDefinitions: Pick<OrderDefinition, "direction" | "valueExtractor">[], limit?: number) {
        super();

        this.orderDefinitions = orderDefinitions as OrderDefinition[];

        for (const od of this.orderDefinitions) {
            od.smaller = od.direction === "asc" ? -1 : 1;
            od.larger = od.direction === "asc" ? 1 : -1;
        }

        this.limit = limit || 0;

        this.subExpression = null; // it's expected to be set after construction
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        if (!this.subExpression) {
            throw new Error("Missing subexpression");
        }

        let { notes } = this.subExpression.execute(inputNoteSet, executionContext, searchContext);

        notes.sort((a, b) => {
            for (const { valueExtractor, smaller, larger } of this.orderDefinitions) {
                const result = compareSortValues(
                    valueExtractor.extract(a),
                    valueExtractor.extract(b)
                );
                if (result !== 0) {
                    return result < 0 ? smaller : larger;
                }
            }

            return 0;
        });

        if (this.limit > 0) {
            notes = notes.slice(0, this.limit);
        }

        const noteSet = new NoteSet(notes);
        noteSet.sorted = true;

        return noteSet;
    }

    isDate(date: number | string) {
        return isDate(date);
    }

    isNumber(x: number | string) {
        return isNumber(x);
    }
}

export default OrderByAndLimitExp;
