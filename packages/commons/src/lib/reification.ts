/**
 * Names and title of a reification: a note that stands for one attribute row.
 *
 * The attribute stays in place. The note is a token for that row, so other
 * relations can target the statement itself.
 */

export const REIFICATION_OF = "reificationOf";
export const REIFICATION_KIND = "reificationKind";
export const REIFICATION_PREDICATE = "reificationPredicate";
export const REIFICATION_LITERAL = "reificationLiteral";
export const REIFICATION_GENERATED_TITLE = "reificationGeneratedTitle";
export const REIFICATION_SUBJECT = "reificationSubject";
export const REIFICATION_OBJECT = "reificationObject";

/**
 * Label on the note that is the relation itself, not one instance of it.
 * The value is the relation name (`loves`), and the note is that concept.
 */
export const REIFICATION_OF_PREDICATE = "reificationOfPredicate";

export const REIFICATION_STRUCTURAL_NAMES = [
    REIFICATION_OF,
    REIFICATION_KIND,
    REIFICATION_PREDICATE,
    REIFICATION_LITERAL,
    REIFICATION_GENERATED_TITLE,
    REIFICATION_SUBJECT,
    REIFICATION_OBJECT,
    REIFICATION_OF_PREDICATE
] as const;

/** How long a generated title may be, including the trailing ellipsis. */
export const REIFICATION_TITLE_MAX_LENGTH = 120;

export function isReificationStructuralName(name: string): boolean {
    return (REIFICATION_STRUCTURAL_NAMES as readonly string[]).includes(name);
}

/**
 * The relation's stored name as it reads in a sentence.
 * `supports` stays `supports`; `isChildOf` becomes `is child of`.
 */
export function predicateForTitle(name: string): string {
    return name
        .replace(/_/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

export interface ReificationTitleInput {
    /** Title of the note that owns the attribute. */
    subjectTitle: string;
    /** Attribute name, as stored (`isChildOf`, `supports`). */
    predicate: string;
    /**
     * The other end of the statement: the target note's title for a relation,
     * or the label's text. Omitted when a label has no value.
     */
    objectTitle?: string;
}

/**
 * Default title of the note created for one attribute row.
 *
 * The relation's own name is the function, and the two ends are its arguments:
 * `isChildOf(Prince Charles, Queen Elizabeth II)`. A label with a value takes
 * the same shape (`confidence(Climate paper, 0.8)`); a label with no value
 * has one argument (`reviewed(Climate paper)`).
 */
export function buildReificationTitle(input: ReificationTitleInput): string {
    const predicate = input.predicate.trim();
    const subject = input.subjectTitle.trim();
    const object = input.objectTitle?.trim() ?? "";
    let title: string;
    if (!predicate && !subject) {
        title = "note";
    } else if (!predicate) {
        title = subject;
    } else if (!object) {
        title = subject ? `${predicate}(${subject})` : predicate;
    } else if (!subject) {
        title = `${predicate}(${object})`;
    } else {
        title = `${predicate}(${subject}, ${object})`;
    }
    if (title.length <= REIFICATION_TITLE_MAX_LENGTH) {
        return title;
    }

    const cut = title.slice(0, REIFICATION_TITLE_MAX_LENGTH - 1).trimEnd();
    return `${cut}…`;
}
