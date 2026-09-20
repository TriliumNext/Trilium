import type { TokenData } from "./types.js";

function lex(str: string) {
    str = str.toLowerCase();

    let fulltextQuery = "";
    const fulltextTokens: TokenData[] = [];
    const expressionTokens: TokenData[] = [];

    let quotes: boolean | string = false; // otherwise contains used quote - ', " or `
    let fulltextEnded = false;
    let currentWord = "";
    // Set while the word being built opens with a parenthesis the query escaped.
    let openingParenEscaped = false;
    let leadingOperator = "";

    function isSymbolAnOperator(chr: string) {
        return ["=", "*", ">", "<", "!", "-", "+", "%", ","].includes(chr);
    }
    
    // Check if the string starts with an exact match operator
    // This allows users to use "=searchterm" for exact matching
    if (str.startsWith("=") && str.length > 1 && str[1] !== "=" && str[1] !== " ") {
        leadingOperator = "=";
        str = str.substring(1); // Remove the leading operator from the string
    }

    function isPreviousSymbolAnOperator() {
        if (currentWord.length === 0) {
            return false;
        } else {
            return isSymbolAnOperator(currentWord[currentWord.length - 1]);
        }
    }

    function finishWord(endIndex: number, createAlsoForEmptyWords = false) {
        if (currentWord === "" && !createAlsoForEmptyWords) {
            return;
        }

        const rec: TokenData = {
            token: currentWord,
            inQuotes: !!quotes,
            startIndex: endIndex - currentWord.length + 1,
            endIndex
        };

        if (fulltextEnded) {
            expressionTokens.push(rec);
        } else {
            fulltextTokens.push(rec);

            fulltextQuery = str.substr(0, endIndex + 1);
        }

        currentWord = "";
        openingParenEscaped = false;
    }

    /**
     * Emits the grouping parentheses that open the expression part, in source order, so
     * handleParens can match each one with its closing counterpart.
     */
    function emitOpeningParens(parens: string, start: number) {
        for (let offset = 0; offset < parens.length; offset++) {
            currentWord = "(";
            finishWord(start + offset);
        }
    }

    for (let i = 0; i < str.length; i++) {
        const chr = str[i];

        if (chr === "\\") {
            if (i + 1 < str.length) {
                i++;

                if (str[i] === "(" && /^\(*$/.test(currentWord)) {
                    openingParenEscaped = true;
                }

                currentWord += str[i];
            } else {
                currentWord += chr;
            }

            continue;
        } else if (['"', "'", "`"].includes(chr)) {
            if (!quotes) {
                if (currentWord.length === 0 || isPreviousSymbolAnOperator()) {
                    finishWord(i - 1);

                    quotes = chr;
                } else {
                    // quote inside a word does not have special meening and does not break word
                    // e.g. d'Artagnan is kept as a single token
                    currentWord += chr;
                }
            } else if (quotes === chr) {
                finishWord(i - 1, true);

                quotes = false;
            } else {
                // it's a quote, but within other kind of quotes, so it's valid as a literal character
                currentWord += chr;
            }

            continue;
        } else if (!quotes) {
            // Grouping parentheses can open either kind of expression, so they are read off
            // the pending word before it is matched against what starts one. An escaped one
            // is a character to search for, so it stays part of the word instead.
            const openingParens = openingParenEscaped ? "" : (/^\(+/.exec(currentWord)?.[0] ?? "");
            const pendingWord = currentWord.slice(openingParens.length);

            if (!fulltextEnded && pendingWord === "note" && chr === "." && i + 1 < str.length) {
                fulltextEnded = true;

                emitOpeningParens(openingParens, i - currentWord.length);
                currentWord = pendingWord;
            }

            if (chr === "#" || chr === "~") {
                // A prefix closes the pending word, so "towers#book" keeps
                // "towers" as a full-text token next to the #book filter.
                // A pending word of only parentheses is grouping syntax rather than a
                // term, so it is not emitted as one.
                const parenthesesOnly = /^\(+$/.test(currentWord);

                if (!parenthesesOnly) {
                    finishWord(i - 1);
                }

                fulltextEnded = true;

                // Unescaped parentheses alone open the expression, so "(#a)" emits "("
                // for handleParens rather than searching for "(" or dropping it.
                if (!pendingWord) {
                    emitOpeningParens(openingParens, i - openingParens.length);
                }

                currentWord = chr;
                openingParenEscaped = false;

                continue;
            } else if (["#", "~"].includes(currentWord) && chr === "!") {
                currentWord += chr;
                continue;
            } else if (currentWord === "~" && (chr === "=" || chr === "*")) {
                // ~= and ~* are fuzzy-match operators, not a relation prefix followed by an operator
                currentWord += chr;
                continue;
            } else if (chr === " ") {
                finishWord(i - 1);
                continue;
            } else if (fulltextEnded && ["(", ")", "."].includes(chr)) {
                finishWord(i - 1);
                currentWord += chr;
                finishWord(i);
                continue;
            } else if (fulltextEnded && !["#!", "~!"].includes(currentWord) && isPreviousSymbolAnOperator() !== isSymbolAnOperator(chr)) {
                finishWord(i - 1);

                currentWord += chr;
                continue;
            }
        }

        // Commas are stripped as fulltext noise, but not inside quotes — a quoted operand
        // (e.g. #geolocation="48.8583,2.2945") must keep the exact value the user stored.
        if (chr === "," && !quotes) {
            continue;
        }

        currentWord += chr;
    }

    finishWord(str.length - 1);

    fulltextQuery = fulltextQuery.trim();

    return {
        fulltextQuery,
        fulltextTokens,
        expressionTokens,
        leadingOperator
    };
}

export default lex;
