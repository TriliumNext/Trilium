import { ExternalTokenizer } from "@lezer/lr";
import { TitleText } from "./parser.terms.js";

export const titleText = new ExternalTokenizer((input) => {
    if (input.next === 10 || input.next === -1) return;

    while (input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(TitleText);
});
