"use strict";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import buildComparator from "../services/build_comparator.js";

/**
 * Search string is lower cased for case-insensitive comparison. But when retrieving properties,
 * we need the case-sensitive form, so we have this translation object.
 */
const PROP_MAPPING: Record<string, string> = {
    noteid: "noteId",
    title: "title",
    type: "type",
    mime: "mime",
    isprotected: "isProtected",
    isarchived: "isArchived",
    datecreated: "dateCreated",
    datemodified: "dateModified",
    utcdatecreated: "utcDateCreated",
    utcdatemodified: "utcDateModified",
    parentcount: "parentCount",
    childrencount: "childrenCount",
    attributecount: "attributeCount",
    labelcount: "labelCount",
    ownedlabelcount: "ownedLabelCount",
    relationcount: "relationCount",
    ownedrelationcount: "ownedRelationCount",
    relationcountincludinglinks: "relationCountIncludingLinks",
    ownedrelationcountincludinglinks: "ownedRelationCountIncludingLinks",
    targetrelationcount: "targetRelationCount",
    targetrelationcountincludinglinks: "targetRelationCountIncludingLinks",
    contentsize: "contentSize",
    contentandattachmentssize: "contentAndAttachmentsSize",
    contentandattachmentsandrevisionssize: "contentAndAttachmentsAndRevisionsSize",
    revisioncount: "revisionCount"
};

interface SearchContext {
    dbLoadNeeded?: boolean;
}

class PropertyComparisonExp extends Expression {
    propertyName: string;
    operator: string;
    comparedValue: string;
    private comparator;

    static isProperty(name: string) {
        return name in PROP_MAPPING;
    }

    constructor(searchContext: SearchContext, propertyName: string, operator: string, comparedValue: string) {
        super();

        this.propertyName = PROP_MAPPING[propertyName];
        this.operator = operator; // for DEBUG mode
        this.comparedValue = comparedValue; // for DEBUG mode
        this.comparator = buildComparator(operator, comparedValue);

        if (["contentsize", "contentandattachmentssize", "contentandattachmentsandrevisionssize", "revisioncount"].includes(this.propertyName)) {
            searchContext.dbLoadNeeded = true;
        }
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        const resNoteSet = new NoteSet();

        for (const note of inputNoteSet.notes) {
            let value = (note as any)[this.propertyName];

            if (value !== undefined && value !== null && typeof value !== "string") {
                value = value.toString();
            }

            if (value) {
                value = value.toLowerCase();
            }

            if (this.comparator && this.comparator(value)) {
                resNoteSet.add(note);
            }
        }

        return resNoteSet;
    }
}

export default PropertyComparisonExp;
