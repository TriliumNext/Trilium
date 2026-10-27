import { ExternalTokenizer } from "@lezer/lr";
import { memberText } from "./parser.terms.js";

// Reads the remainder of a line as a single free-text token. Used for class
// member declarations and relationship labels. Bails out at the start of a line
// comment, a closing brace, or an annotation so those keep their own tokens.
export const memberTextToken = new ExternalTokenizer((input) => {
    if (
        input.next === -1 ||
        input.next === 9 ||
        input.next === 10 ||
        input.next === 13 ||
        input.next === 32 ||
        input.next === 125 || // }
        input.next === 60 // <
    ) {
        return;
    }

    if (input.next === 37 && input.peek(1) === 37) return; // %% comment

    while (input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(memberText);
});
