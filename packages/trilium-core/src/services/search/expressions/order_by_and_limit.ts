"use strict";

import type BNote from "../../../becca/entities/bnote.js";
import { compareSortValues } from "../../utils/sort_values.js";
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
                    valueExtractor.extract(b),
                    compareValues
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

/**
 * Compares two values an `orderBy` found on both notes: values that both read as dates compare
 * chronologically and values that both read as numbers numerically, anything else as text.
 */
function compareValues(a: string | number, b: string | number) {
    let valA: string | number | Date = a;
    let valB: string | number | Date = b;

    if (typeof valA === "string" && typeof valB === "string") {
        if (isDate(valA) && isDate(valB)) {
            valA = new Date(valA);
            valB = new Date(valB);
        } else if (isNumber(valA) && isNumber(valB)) {
            valA = parseFloat(valA);
            valB = parseFloat(valB);
        }
    }

    if (!valA && !valB) {
        // The value is empty or zero on both notes, so the next order definition decides.
        return 0;
    }

    return valA < valB ? -1 : valA > valB ? 1 : 0;
}

function isDate(date: number | string) {
    return !isNaN(new Date(date).getTime());
}

function isNumber(x: number | string) {
    if (typeof x === "number") {
        return true;
    }
    // isNaN returns false for a blank string.
    return typeof x === "string" && x.trim() !== "" && !isNaN(parseInt(x, 10));
}

export default OrderByAndLimitExp;
