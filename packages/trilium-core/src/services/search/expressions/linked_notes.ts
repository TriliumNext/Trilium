import { BUILTIN_ATTRIBUTES } from "@triliumnext/commons";

import type BAttribute from "../../../becca/entities/battribute.js";
import type BNote from "../../../becca/entities/bnote.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import Expression from "./expression.js";

/**
 * `note.links` keeps the notes linking to a note that matches the sub-expression; `note.backlinks`
 * keeps the notes linked from one. A link is a relation the note owns, counted by `isLink()`.
 */
export default class LinkedNotesExp extends Expression {
    private direction: "links" | "backlinks";
    private subExpression: Expression;

    constructor(direction: "links" | "backlinks", subExpression: Expression) {
        super();

        this.direction = direction;
        this.subExpression = subExpression;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        const subInputNoteSet = new NoteSet();

        for (const note of inputNoteSet.notes) {
            subInputNoteSet.addAll(this.linkedNotes(note));
        }

        const matched = this.subExpression.execute(subInputNoteSet, executionContext, searchContext);
        const resNoteSet = new NoteSet();

        for (const note of inputNoteSet.notes) {
            if (this.linkedNotes(note).some((linked) => matched.hasNote(linked))) {
                resNoteSet.add(note);
            }
        }

        return resNoteSet;
    }

    private linkedNotes(note: BNote): BNote[] {
        const relations = this.direction === "links" ? note.getOwnedRelations() : note.getTargetRelations();
        const linked: BNote[] = [];

        for (const relation of relations) {
            const other = this.direction === "links" ? relation.targetNote : relation.note;
            if (other && isLink(relation)) {
                linked.push(other);
            }
        }

        return linked;
    }
}

/** The relations content creates, which are built in but count as links. */
const LINK_RELATIONS = new Set([ "internalLink", "imageLink", "includeNoteLink", "relationMapLink" ]);
const BUILTIN_RELATIONS = new Set(BUILTIN_ATTRIBUTES.filter((attr) => attr.type === "relation").map((attr) => attr.name));

/**
 * A relation the user created, or one of `LINK_RELATIONS`; other built-in relations configure the
 * note. A built-in relation disabled by safe import keeps its name behind a `disabled:` prefix.
 */
export function isLink(relation: BAttribute) {
    const name = relation.name.replace(/^disabled:/, "");
    return LINK_RELATIONS.has(name) || !BUILTIN_RELATIONS.has(name);
}
