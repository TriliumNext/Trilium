"use strict";

import type BNote from "../../becca/entities/bnote.js";

/**
 * Search string is lower cased for case-insensitive comparison. But when retrieving properties,
 * we need a case-sensitive form, so we have this translation object.
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
    dbLoadNeeded: boolean;
}

class ValueExtractor {
    private propertyPath: string[];

    constructor(searchContext: SearchContext, propertyPath: string[]) {
        this.propertyPath = propertyPath.map((pathEl) => pathEl.toLowerCase());

        if (this.propertyPath[0].startsWith("#")) {
            this.propertyPath = ["note", "labels", this.propertyPath[0].substr(1), ...this.propertyPath.slice(1, this.propertyPath.length)];
        } else if (this.propertyPath[0].startsWith("~")) {
            this.propertyPath = ["note", "relations", this.propertyPath[0].substr(1), ...this.propertyPath.slice(1, this.propertyPath.length)];
        }

        if (["contentsize", "contentandattachmentssize", "contentandattachmentsandrevisionssize", "revisioncount"].includes(this.propertyPath[this.propertyPath.length - 1])) {
            searchContext.dbLoadNeeded = true;
        }
    }

    validate() {
        if (this.propertyPath[0] !== "note") {
            return `property specifier must start with 'note', but starts with '${this.propertyPath[0]}'`;
        }

        for (let i = 1; i < this.propertyPath.length; i++) {
            const pathEl = this.propertyPath[i];

            if (pathEl === "labels") {
                if (i !== this.propertyPath.length - 2) {
                    return `label is a terminal property specifier and must be at the end`;
                }

                i++;
            } else if (pathEl === "relations") {
                if (i >= this.propertyPath.length - 2) {
                    return `relation name or property name is missing`;
                }

                i++;
            } else if (pathEl in PROP_MAPPING || pathEl === "random") {
                if (i !== this.propertyPath.length - 1) {
                    return `${pathEl} is a terminal property specifier and must be at the end`;
                }
            } else if (!["parents", "children"].includes(pathEl)) {
                return `Unrecognized property specifier ${pathEl}`;
            }
        }
    }

    extract(note: BNote) {
        let cursor: BNote | null = note;

        let i: number = 0;

        const cur = () => this.propertyPath[i];

        for (i = 0; i < this.propertyPath.length; i++) {
            if (!cursor) {
                return cursor;
            }

            if (cur() === "labels") {
                i++;

                const attr = cursor.getAttributeCaseInsensitive("label", cur());

                return attr ? attr.value : null;
            }

            if (cur() === "relations") {
                i++;

                const attr = cursor.getAttributeCaseInsensitive("relation", cur());
                cursor = attr?.targetNote || null;
            } else if (cur() === "parents") {
                cursor = cursor.parents[0];
            } else if (cur() === "children") {
                cursor = cursor.children[0];
            } else if (cur() === "random") {
                return Math.random().toString(); // string is expected for comparison
            } else if (cur() in PROP_MAPPING) {
                return (cursor as any)[PROP_MAPPING[cur()]];
            } else {
                // FIXME
            }
        }
    }
}

export default ValueExtractor;
