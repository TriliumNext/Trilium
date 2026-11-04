"use strict";

import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";

import becca from "../../../becca/becca.js";
import Expression from "./expression.js";

class AttributeExistsExp extends Expression {
    attributeType: string;
    attributeName: string;
    private isTemplateLabel: boolean;
    private prefixMatch: boolean;

    constructor(attributeType: string, attributeName: string, prefixMatch: boolean) {
        super();

        this.attributeType = attributeType;
        this.attributeName = attributeName;
        // template attr is used as a marker for templates, but it's not meant to be inherited
        this.isTemplateLabel = this.attributeType === "label" && (this.attributeName === "template" || this.attributeName === "workspacetemplate");
        this.prefixMatch = prefixMatch;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        const attrs = this.prefixMatch ? becca.findAttributesWithPrefix(this.attributeType, this.attributeName) : becca.findAttributes(this.attributeType, this.attributeName);

        const resultNoteSet = new NoteSet();

        for (const attr of attrs) {
            const note = attr.note;

            if (attr.isInheritable && !this.isTemplateLabel) {
                resultNoteSet.addAll(note.getSubtreeNotesIncludingTemplated());
            } else if (note.isInherited() && !this.isTemplateLabel) {
                resultNoteSet.addAll(note.getInheritingNotes());
            } else {
                resultNoteSet.add(note);
            }
        }

        return resultNoteSet.intersection(inputNoteSet);
    }
}

export default AttributeExistsExp;
