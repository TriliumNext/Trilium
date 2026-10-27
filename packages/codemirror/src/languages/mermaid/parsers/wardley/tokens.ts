import { ExternalTokenizer, type InputStream } from "@lezer/lr";

import { lineText } from "../line_text.js";
import {
    acceleratorKeyword,
    anchorKeyword,
    annotationKeyword,
    annotationsKeyword,
    componentKeyword,
    deacceleratorKeyword,
    evolutionKeyword,
    evolveKeyword,
    inertiaKeyword,
    labelKeyword,
    Name,
    noteKeyword,
    pipelineKeyword,
    sizeKeyword,
    Strategy,
    titleKeyword,
    TitleText
} from "./parser.terms.js";

const keywords: Record<string, number> = {
    accelerator: acceleratorKeyword,
    anchor: anchorKeyword,
    annotation: annotationKeyword,
    annotations: annotationsKeyword,
    build: Strategy,
    buy: Strategy,
    component: componentKeyword,
    deaccelerator: deacceleratorKeyword,
    evolution: evolutionKeyword,
    evolve: evolveKeyword,
    inertia: inertiaKeyword,
    label: labelKeyword,
    market: Strategy,
    note: noteKeyword,
    outsource: Strategy,
    pipeline: pipelineKeyword,
    size: sizeKeyword,
    title: titleKeyword
};

export const titleText = lineText(TitleText);

/**
 * A keyword where the grammar takes it (`(build)` reads `build`, though `)` can be part of a
 * name), or else a name: words of letters, digits, `_`, `(`, `)`,
 * `&` and `-` (not before `>`), joined by spaces or tabs, each after the first starting with a
 * letter or `(`, as Mermaid's `NAME_WITH_SPACES` reads them.
 */
export const words = new ExternalTokenizer((input, stack) => {
    if (!isLetter(input.next)) return;

    let letters = 0;
    let word = "";
    for (; isLetter(input.peek(letters)); letters++) {
        word += String.fromCharCode(input.peek(letters));
    }
    const after = input.peek(letters);
    const keyword = keywords[word];
    if (keyword !== undefined && stack.canShift(keyword) && !isDigit(after) && after !== 95) {
        input.acceptToken(keyword, letters);
        return;
    }

    let end = wordLength(input, 0);
    for (;;) {
        let next = end;
        while (input.peek(next) === 32 || input.peek(next) === 9) next++;
        if (next === end || !(isLetter(input.peek(next)) || input.peek(next) === 40)) break;
        end = next + wordLength(input, next);
    }
    input.acceptToken(Name, end);
});

function wordLength(input: InputStream, offset: number) {
    let length = 1;
    for (let next = input.peek(offset + length); ; next = input.peek(offset + length)) {
        const dash = next === 45 && input.peek(offset + length + 1) !== 62;
        if (!(isLetter(next) || isDigit(next) || [ 95, 40, 41, 38 ].includes(next) || dash)) break;
        length++;
    }
    return length;
}

function isLetter(code: number) {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(code: number) {
    return code >= 48 && code <= 57;
}
