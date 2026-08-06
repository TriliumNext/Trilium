import type { TextTypingTransformationDescription } from "@triliumnext/ckeditor5";

import { escapeRegExp } from "../../../services/utils.js";

/** One replacement the user wrote: the text they type, and what it becomes. */
export interface CustomReplacement {
    from: string;
    to: string;
}

/**
 * Reads the stored replacements, tolerating anything the option is not.
 *
 * It is user-entered content that syncs between devices, so a value that is malformed — hand-edited,
 * written by an older version, corrupted in transit — must degrade to "no custom replacements"
 * rather than break the editor it is read by.
 */
export function parseCustomReplacements(json: string | null | undefined): CustomReplacement[] {
    if (!json) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }

    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter((entry): entry is CustomReplacement =>
            !!entry && typeof entry === "object"
            && typeof (entry as CustomReplacement).from === "string"
            && typeof (entry as CustomReplacement).to === "string");
}

/**
 * Compiles the replacements into the transformations CKEditor's `typing.transformations.extra` takes.
 *
 * Two things are decided here rather than left to the user:
 *
 * The pattern is built from the typed text as a literal — never taken as a regular expression. It is
 * `.test()`-ed against the text before the caret on every keystroke and syncs to every device, so one
 * catastrophically backtracking pattern would hang the editor everywhere. There is no user demand
 * this would serve that plain text does not.
 *
 * And it matches a whole word: the text has to start the line or follow a space, and be followed by
 * one. Passing a bare string to CKEditor compiles to `/(text)$/`, which fires mid-word — a `TN`
 * replacement would rewrite the tail of `BTN` — and firing on the closing space rather than on the
 * last letter is what lets `TNT` still be typed. It is the same shape upstream gives its en dash,
 * and the behaviour every office suite's autocorrect has taught people to expect.
 *
 * Matching ignores case, and the replacement's own case decides what comes back — see
 * {@link adaptCase}.
 *
 * A half-written row (either side still blank) compiles to nothing, so a replacement being typed in
 * the settings does not act until it is finished.
 */
export function buildCustomTransformations(replacements: CustomReplacement[]): TextTypingTransformationDescription[] {
    return replacements
        .filter(({ from, to }) => from.trim().length > 0 && to.trim().length > 0)
        .map(({ from, to }) => ({
            from: new RegExp(`(^|\\s)(${escapeRegExp(from)})(\\s)$`, "i"),
            // A function rather than a fixed array: what comes back depends on how the text was
            // actually typed. CKEditor hands it the captured groups, of which the second is the
            // matched text.
            to: (matches: string[]) => [null, adaptCase(matches[1], to), null]
        }));
}

/**
 * Fits the replacement to the case of the text that triggered it, the way every office suite's
 * autocorrect has done for decades:
 *
 * - A replacement carrying capitals of its own is left exactly as written, so `TN` → `Trilium Notes`
 *   and `iphone` → `iPhone` keep the capitals that are the whole point of them.
 * - An all-lowercase replacement follows what was typed: `teh` → `the`, `Teh` → `The`,
 *   `TEH` → `THE`. Typos happen at the start of sentences, which is precisely where a verbatim
 *   lowercase replacement would be wrong.
 *
 * Deciding from the replacement rather than from the shortcut is what keeps this to one rule. Apple's
 * text replacement instead matches case-insensitively and then lets a separate auto-capitaliser run
 * over the result, which is why the same shortcut can produce different text on macOS and on iOS.
 */
function adaptCase(typed: string, replacement: string): string {
    // Anything with a capital in it was written that way deliberately. Scripts without case are
    // unchanged by `toLowerCase`, so they take this branch too and are returned untouched.
    if (replacement !== replacement.toLowerCase()) return replacement;

    // Only letters that actually have a case get a say. Reading the first *character* instead would
    // take an uncased one for a capital — `"(" === "(".toUpperCase()` is true — so a shortcut like
    // `(c)` would capitalize its replacement.
    const cased = typed.match(/\p{Lu}|\p{Ll}/gu);
    if (!cased) return replacement;

    // A single typed capital is ambiguous between "capitalised" and "all caps"; read it as the
    // gentler of the two.
    if (cased.length > 1 && cased.every((letter) => UPPERCASE.test(letter))) return replacement.toUpperCase();
    if (UPPERCASE.test(cased[0])) return replacement.replace(/\p{L}/u, (letter) => letter.toUpperCase());

    return replacement;
}

/** Matches a single uppercase letter. Kept unanchored and stateless — no `g`, which would carry a
 *  `lastIndex` between the calls above. */
const UPPERCASE = /\p{Lu}/u;
