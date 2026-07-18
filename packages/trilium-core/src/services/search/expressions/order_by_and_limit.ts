"use strict";

import type BNote from "../../../becca/entities/bnote.js";
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
                let valA: string | number | Date | null = valueExtractor.extract(a);
                let valB: string | number | Date | null = valueExtractor.extract(b);

                if (valA === undefined) {
                    valA = null;
                }

                if (valB === undefined) {
                    valB = null;
                }

                if (valA === null && valB === null) {
                    // neither has attribute at all
                    continue;
                } else if (valB === null) {
                    return smaller;
                } else if (valA === null) {
                    return larger;
                }

                // if both are dates, then parse them for dates comparison
                if (typeof valA === "string" && this.isDate(valA) && typeof valB === "string" && this.isDate(valB)) {
                    valA = new Date(valA);
                    valB = new Date(valB);
                }

                // if both are numbers, then parse them for numerical comparison
                else if (typeof valA === "string" && this.isNumber(valA) && typeof valB === "string" && this.isNumber(valB)) {
                    valA = parseFloat(valA);
                    valB = parseFloat(valB);
                }

                if (!valA && !valB) {
                    // the attribute value is empty/zero in both notes so continue to the next order definition
                    continue;
                } else if (valA < valB) {
                    return smaller;
                } else if (valA > valB) {
                    return larger;
                }
                // else the values are equal and continue to next order definition
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
        return !isNaN(new Date(date).getTime());
    }

    isNumber(x: number | string) {
        if (typeof x === "number") {
            return true;
        } else if (typeof x === "string") {
            // isNaN will return false for blank string
            return x.trim() !== "" && !isNaN(parseInt(x, 10));
        } else {
            return false;
        }
    }
}

export default OrderByAndLimitExp;
