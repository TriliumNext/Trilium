import type { TokenData, TokenStructure } from "./types.js";

/**
 * This will create a recursive object from a list of tokens - tokens between parenthesis are grouped in a single array
 */
function handleParens(tokens: TokenStructure) {
    if (tokens.length === 0) {
        return [];
    }

    while (true) {
        const leftIdx = tokens.findIndex((token) => "token" in token && token.token === "(");

        if (leftIdx === -1) {
            return tokens;
        }

        let rightIdx;
        let parensLevel = 0;

        for (rightIdx = leftIdx; rightIdx < tokens.length; rightIdx++) {
            const token = tokens[rightIdx];
            if (!("token" in token)) {
                continue;
            }

            if (token.token === ")") {
                parensLevel--;

                if (parensLevel === 0) {
                    break;
                }
            } else if (token.token === "(") {
                parensLevel++;
            }
        }

        if (rightIdx >= tokens.length) {
            throw new Error("Did not find matching right parenthesis.");
        }

        tokens = [...tokens.slice(0, leftIdx), handleParens(tokens.slice(leftIdx + 1, rightIdx)), ...tokens.slice(rightIdx + 1)] as (TokenData | TokenData[])[];
    }
}

export default handleParens;
