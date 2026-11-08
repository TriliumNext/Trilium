import { ExternalTokenizer } from "@lezer/lr";
import { titleTextTerm } from "./parser.terms.js";

// Reads the remainder of a line as a single free-text token, used for the text
// that follows the `title` keyword. Bails out at a line comment so it keeps its
// own token.
export const titleTextToken = new ExternalTokenizer((input) => {
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

    input.acceptToken(titleTextTerm);
});
