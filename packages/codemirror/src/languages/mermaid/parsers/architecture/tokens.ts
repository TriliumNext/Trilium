import { ExternalTokenizer } from "@lezer/lr";
import { DiagramName, Icon, Label } from "./parser.terms.js";

const isLetter = (c: number) =>
    (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
const isDigit = (c: number) => c >= 48 && c <= 57;

// Reads the diagram header keyword, which may contain a hyphen
// (`architecture-beta`). Only invoked where DiagramName is expected.
export const diagramName = new ExternalTokenizer((input) => {
    let tokens = "";

    while (isLetter(input.next) || isDigit(input.next) || input.next === 45) {
        tokens += String.fromCodePoint(input.next);
        input.advance();
    }

    if (tokens === "architecture-beta" || tokens === "architecture") {
        input.acceptToken(DiagramName);
    }
});

// Reads an icon parenthetical `(cloud)` / `(logos:aws-lambda)`.
export const iconToken = new ExternalTokenizer((input) => {
    const open = input.next;
    if (open !== 40) return; // (

    input.advance(); // consume (
    while (input.next !== 41 && input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    if (input.next === 41) {
        input.advance(); // consume closing )
        input.acceptToken(Icon);
    }
});

// Reads a label `[Database]`.
export const labelToken = new ExternalTokenizer((input) => {
    const open = input.next;
    if (open !== 91) return; // [

    input.advance(); // consume [
    while (input.next !== 93 && input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    if (input.next === 93) {
        input.advance(); // consume closing ]
        input.acceptToken(Label);
    }
});
