import { ExternalTokenizer } from "@lezer/lr";
import { DiagramName, Shape } from "./parser.terms.js";

const isLetter = (c: number) =>
    (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
const isDigit = (c: number) => c >= 48 && c <= 57;

// Reads the diagram header keyword, which may contain a hyphen (`block-beta`).
// Only invoked where DiagramName is expected (the very first token), so it will
// not interfere with the `block` group keyword later in the document.
export const diagramName = new ExternalTokenizer((input) => {
    let tokens = "";

    while (isLetter(input.next) || isDigit(input.next) || input.next === 45) {
        tokens += String.fromCodePoint(input.next);
        input.advance();
    }

    if (tokens === "block-beta" || tokens === "block") {
        input.acceptToken(DiagramName);
    }
});

const isOpen = (c: number) =>
    c === 40 || c === 91 || c === 123 || c === 60; // ( [ { <
const isClose = (c: number) =>
    c === 41 || c === 93 || c === 125 || c === 62; // ) ] } >

// Reads a balanced node "shape"/label such as ["text"], ("text"), (("text")),
// {"text"}, or the block-arrow form <["text"]>(right). Consumes consecutive
// bracket groups so multi-part shapes stay a single token.
export const shapeToken = new ExternalTokenizer((input) => {
    const first = input.next;
    if (!isOpen(first)) return;
    // `<` only begins a shape when it is the block-arrow `<[` form; otherwise it
    // is the start of an arrow like `<-->`, which the inline tokenizer handles.
    if (first === 60 && input.peek(1) !== 91) return;

    let depth = 0;
    let inString = false;

    for (;;) {
        const c = input.next;
        if (c === -1 || c === 10) break;

        if (inString) {
            if (c === 34) inString = false;
            input.advance();
            continue;
        }

        if (c === 34) {
            inString = true;
            input.advance();
            continue;
        }

        if (isOpen(c)) {
            depth++;
            input.advance();
            continue;
        }

        if (isClose(c)) {
            depth--;
            input.advance();
            if (depth <= 0) {
                // Keep going if another shape group follows immediately, e.g. `>(right)`.
                if (isOpen(input.next) && !(input.next === 60 && input.peek(1) !== 91)) {
                    depth = 0;
                    continue;
                }
                input.acceptToken(Shape);
                return;
            }
            continue;
        }

        input.advance();
    }

    input.acceptToken(Shape);
});
