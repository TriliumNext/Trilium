/**
 * Names and title of a reification: a note that stands for one attribute row.
 *
 * The attribute stays in place. The note is a token for that row, so other
 * relations can target the statement itself.
 */

export const REIFICATION_ROOT_ID = "_reifications";

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

/** Label on the note that talks about another note, one Tarski level up. The value is that note's id. */
export const SELF_REIFICATION_OF = "selfReificationOf";
/** Last title generated for a self-reification, so a title the user edited is left alone. */
export const SELF_REIFICATION_GENERATED_TITLE = "selfReificationGeneratedTitle";

/** The formula on the concept of a name, such as `argument(A, B) = R(A, B), A'`. */
export const REIFICATION_PATTERN = "reificationPattern";
/** Label on the note produced by filling a formula. The value is the formula's name. */
export const REIFICATION_INSTANCE = "reificationInstance";
/** Comma-separated note ids of the places that filling used, in order. */
export const REIFICATION_BINDING = "reificationBinding";

export const REIFICATION_STRUCTURAL_NAMES = [
    REIFICATION_OF,
    REIFICATION_KIND,
    REIFICATION_PREDICATE,
    REIFICATION_LITERAL,
    REIFICATION_GENERATED_TITLE,
    REIFICATION_SUBJECT,
    REIFICATION_OBJECT,
    REIFICATION_OF_PREDICATE,
    SELF_REIFICATION_OF,
    SELF_REIFICATION_GENERATED_TITLE,
    REIFICATION_PATTERN,
    REIFICATION_INSTANCE,
    REIFICATION_BINDING
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

/**
 * The title of the note that talks about `title`, one level up.
 * Primes mark the first three levels (`B'`, `B''`, `B'''`); from the fourth
 * the level is a number (`B(4)`, `B(5)`).
 */
export function nextSelfReificationTitle(title: string): string {
    const baseTitle = title.trim() || "note";
    const numbered = /\((\d+)\)$/.exec(baseTitle);
    if (numbered) {
        const level = Number(numbered[1]);
        if (level >= 4) {
            return fitTitle(`${baseTitle.slice(0, numbered.index)}(${level + 1})`);
        }
    }

    const primes = /'+$/.exec(baseTitle)?.[0].length ?? 0;
    const base = baseTitle.replace(/'+$/, "");
    if (primes >= 3) {
        return fitTitle(`${base}(4)`);
    }
    return fitTitle(`${base}${"'".repeat(primes + 1)}`);
}

function fitTitle(title: string): string {
    if (title.length <= REIFICATION_TITLE_MAX_LENGTH) {
        return title;
    }
    const cut = title.slice(0, REIFICATION_TITLE_MAX_LENGTH - 1).trimEnd();
    return `${cut}…`;
}

/** One place in a formula. A call has `args`. `level` is how many times it is self-reified. */
export interface ReificationExpr {
    name: string;
    args?: ReificationExpr[];
    level: number;
}

/**
 * `Hello(A, B) = R(A, B); B'`.
 * The left side names the sugar. Semicolons separate the notes on the right.
 */
export interface ReificationDefinition {
    name: string;
    params: string[];
    terms: ReificationExpr[];
}

const FORMULA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parses a formula. Returns null when the text is not one. */
export function parseReificationDefinition(text: string): ReificationDefinition | null {
    const parts = splitEquation(text.trim());
    if (!parts) {
        return null;
    }
    const head = parseHead(parts[0]);
    const terms = parseTermList(parts[1], termSeparator(parts[1]));
    if (!head || !terms) {
        return null;
    }
    return { name: head.name, params: head.params, terms };
}

/** The formula written again, with one space after each semicolon. */
export function formatReificationDefinition(definition: ReificationDefinition): string {
    const head = `${definition.name}(${definition.params.join(", ")})`;
    const terms = definition.terms.map(formatReificationExpr).join("; ");
    return `${head} = ${terms}`;
}

export function formatReificationExpr(expr: ReificationExpr): string {
    const body = expr.args
        ? `${expr.name}(${expr.args.map(formatReificationExpr).join(", ")})`
        : expr.name;
    return `${body}${formatReificationLevel(expr.level)}`;
}

/** `name(arg, arg)`, cut to the title limit. */
export function formatReificationFormula(predicate: string, args: string[]): string {
    const title = args.length === 0 ? predicate : `${predicate}(${args.join(", ")})`;
    return fitTitle(title);
}

function formatReificationLevel(level: number): string {
    if (level <= 0) {
        return "";
    }
    if (level <= 3) {
        return "'".repeat(level);
    }
    return `(${level})`;
}

function parseHead(text: string): { name: string; params: string[] } | null {
    const open = text.indexOf("(");
    if (open < 1 || !text.endsWith(")")) {
        return null;
    }
    const name = text.slice(0, open).trim();
    if (!FORMULA_NAME.test(name)) {
        return null;
    }
    const params = splitTopLevel(text.slice(open + 1, -1), ",");
    if (!params) {
        return null;
    }
    const seen = new Set<string>();
    for (const param of params) {
        if (!FORMULA_NAME.test(param) || seen.has(param)) {
            return null;
        }
        seen.add(param);
    }
    return { name, params };
}

/** Semicolons separate terms. Commas still do, so an older formula still reads. */
function termSeparator(text: string): string {
    return containsTopLevel(text, ";") ? ";" : ",";
}

function containsTopLevel(text: string, separator: string): boolean {
    let depth = 0;
    for (const ch of text) {
        if (ch === "(") {
            depth++;
        } else if (ch === ")") {
            depth--;
        } else if (ch === separator && depth === 0) {
            return true;
        }
    }
    return false;
}

function parseTermList(text: string, separator: string): ReificationExpr[] | null {
    const parts = splitTopLevel(text, separator);
    if (!parts) {
        return null;
    }
    const terms: ReificationExpr[] = [];
    for (const part of parts) {
        const expr = parseExpr(part);
        if (!expr) {
            return null;
        }
        terms.push(expr);
    }
    return terms;
}

function parseExpr(text: string): ReificationExpr | null {
    const split = splitLevel(text.trim());
    if (!split) {
        return null;
    }
    const body = split.body.trim();
    if (FORMULA_NAME.test(body)) {
        return { name: body, level: split.level };
    }
    const open = body.indexOf("(");
    if (open < 1 || !body.endsWith(")")) {
        return null;
    }
    const name = body.slice(0, open).trim();
    if (!FORMULA_NAME.test(name)) {
        return null;
    }
    const args = parseTermList(body.slice(open + 1, -1), ",");
    if (!args) {
        return null;
    }
    return { name, args, level: split.level };
}

function splitLevel(text: string): { body: string; level: number } | null {
    const numbered = /^(.*)\((\d+)\)$/.exec(text);
    if (numbered) {
        const level = Number(numbered[2]);
        if (numbered[1].length > 0 && level >= 4) {
            return { body: numbered[1], level };
        }
    }
    const primes = /'+$/.exec(text);
    if (!primes) {
        return { body: text, level: 0 };
    }
    if (primes[0].length > 3) {
        return null;
    }
    return { body: text.slice(0, -primes[0].length), level: primes[0].length };
}

function splitEquation(text: string): [string, string] | null {
    let depth = 0;
    let at = -1;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "(") {
            depth++;
        } else if (ch === ")") {
            if (depth === 0) {
                return null;
            }
            depth--;
        } else if (ch === "=" && depth === 0) {
            if (at >= 0) {
                return null;
            }
            at = i;
        }
    }
    if (at < 0 || depth !== 0) {
        return null;
    }
    const left = text.slice(0, at).trim();
    const right = text.slice(at + 1).trim();
    if (!left || !right) {
        return null;
    }
    return [ left, right ];
}

function splitTopLevel(text: string, separator: string): string[] | null {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "(") {
            depth++;
        } else if (ch === ")") {
            if (depth === 0) {
                return null;
            }
            depth--;
        } else if (ch === separator && depth === 0) {
            parts.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    if (depth !== 0) {
        return null;
    }
    const last = text.slice(start).trim();
    parts.push(last);
    if (parts.length === 0 || parts.some((part) => part.length === 0)) {
        return null;
    }
    return parts;
}
