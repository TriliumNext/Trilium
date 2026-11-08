import { ExternalTokenizer } from "@lezer/lr";
import { stateText } from "./parser.terms.js";

// Reads the remainder of a line as a single free-text token, used for the label
// that follows a `:` on a transition or note. Bails out at a closing brace or a
// line comment so those keep their own tokens.
export const stateTextToken = new ExternalTokenizer((input) => {
    if (
        input.next === -1 ||
        input.next === 9 ||
        input.next === 10 ||
        input.next === 13 ||
        input.next === 32 ||
        input.next === 125 // }
    ) {
        return;
    }

    if (input.next === 37 && input.peek(1) === 37) return; // %% comment

    while (input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(stateText);
});
