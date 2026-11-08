import { ExternalTokenizer } from "@lezer/lr";
import { RelationshipToken, labelTextTerm } from "./parser.terms.js";

// Characters that can appear in an ER relationship, e.g. ||--o{ or }|..|{
// codes: | = 124, o = 111, { = 123, } = 125, . = 46, - = 45
const relChars = [ 124, 111, 123, 125, 46, 45 ];

export const relationshipTokens = new ExternalTokenizer((input) => {
    if (!relChars.includes(input.next)) return;

    let read = "";
    while (relChars.includes(input.next)) {
        read += String.fromCodePoint(input.next);
        input.advance();
    }

    // Only accept a genuine relationship: it must carry the connecting line,
    // `--` (identifying) or `..` (non-identifying). This prevents matching a lone
    // block brace `{`/`}` or a hyphen inside an entity name.
    if (read.includes("--") || read.includes("..")) {
        input.acceptToken(RelationshipToken);
    }
});

// Reads the remainder of a line as the label after a relationship's `:`.
export const labelTokens = new ExternalTokenizer((input) => {
    if (
        input.next === -1 ||
        input.next === 9 ||
        input.next === 10 ||
        input.next === 13 ||
        input.next === 32
    ) {
        return;
    }

    if (input.next === 37 && input.peek(1) === 37) return; // %% comment

    while (input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(labelTextTerm);
});
