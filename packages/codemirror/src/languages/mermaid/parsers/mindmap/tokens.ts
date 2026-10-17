import { ExternalTokenizer, ContextTracker } from "@lezer/lr";

import { findDirectiveLength, lineLength } from "../mermaid/tokens.js";
import {
    ClassLine,
    Directive,
    IconLine,
    LineComment,
    newline as newlineToken,
    newlineEmpty,
    indent,
    LineText1,
    LineText2,
    LineText3,
    LineText4,
    LineText5
} from "./parser.terms.js";

import type { InputStream } from "@lezer/lr";

type InputStreamWithRead = InputStream & {
    read: (inputPosition: number, stackPosition: number) => string;
};

const LineTextTokens = [ LineText1, LineText2, LineText3, LineText4, LineText5 ];

const newline = 10,
    carriageReturn = 13,
    space = 32,
    tab = 9,
    hash = 35,
    percent = 37,
    colon = 58,
    parenL = 40,
    parenR = 41,
    bracketL = 91,
    bracketR = 93,
    braceL = 123,
    braceR = 125;

export const newlines = new ExternalTokenizer(
    (input, _stack) => {
        if (input.next < 0) return;
        else {
            input.advance();
            let spaces = 0;
            while ((input.next as number) == space || (input.next as number) == tab) {
                input.advance();
                spaces++;
            }
            let empty =
                input.next == newline ||
                input.next == carriageReturn ||
                input.next == hash ||
                startsComment(input);
            input.acceptToken(empty ? newlineEmpty : newlineToken, -spaces);
        }
    },
    { contextual: true, fallback: true }
);

export const lineTextType = new ExternalTokenizer((input, stack) => {
    let chars = 0;

    while (input.next > -1 && input.next !== newline) {
        if (input.next === colon) return;

        if (
            input.next === parenL ||
            input.next === bracketL ||
            input.next === braceL
        ) {
            if (chars > 0) {
                input.acceptToken(lineType(stack.context));
                return;
            } else return;
        }

        if (
            (input.next === parenR ||
                input.next === bracketR ||
                input.next === braceR) &&
            chars > 0
        ) {
            input.acceptToken(lineType(stack.context));
            return;
        }

        input.advance();
        chars++;
    }

    input.acceptToken(lineType(stack.context));
});

const tabDepth = (depth: number) => {
    return 4 - (depth % 4);
};

// The indentation that starts a line; `trackIndent` measures its depth. A line that holds
// nothing else, or starts with `#` or `%%`, gets no `indent` token.
export const indentation = new ExternalTokenizer((input) => {
    const prev = input.peek(-1);
    if (prev !== newline && prev !== carriageReturn) return;

    while (input.next === space || input.next === tab) {
        input.advance();
    }
    const blank = input.next === newline || input.next === carriageReturn || input.next === hash;
    if (!blank && !startsComment(input)) {
        input.acceptToken(indent);
    }
});

// A `%%` comment, on a line of its own or after a shape (`lineTextType` takes the `%%` in
// `root %% text` as text), or a `%%{…}%%` directive, which Mermaid applies only on a line of
// its own.
export const comments = new ExternalTokenizer((input) => {
    if (!startsComment(input)) return;

    const directive = input.peek(2) === braceL && startsLine(input);
    const directiveLength = directive ? findDirectiveLength(input) : -1;
    if (directiveLength > 0) {
        input.acceptToken(Directive, directiveLength);
    } else {
        input.acceptToken(LineComment, lineLength(input));
    }
});

function startsComment(input: InputStream) {
    return input.next === percent && input.peek(1) === percent;
}

function startsLine(input: InputStream) {
    for (let offset = -1; ; offset--) {
        const previous = input.peek(offset);
        if (previous === newline || previous === -1) return true;
        if (previous !== space && previous !== tab) return false;
    }
}

/** A node line: its indentation and its depth in the tree, the root being 0. */
interface Node {
    indent: number;
    level: number;
    parent: Node | null;
    hash: number;
}

/**
 * The nodes a new line can nest under, each indented deeper than the one before, and the current
 * line, which joins them at the next line unless it is a decoration: an icon or class line.
 */
interface Context {
    nodes: Node | null;
    line: Node;
    decoration: boolean;
}

const countIndent = (space: string) => {
    let depth = 0;
    for (let i = 0; i < space.length; i++)
        depth += space.charCodeAt(i) == tab ? tabDepth(depth) : 1;
    return depth;
};

/** The token of the text on a line, one of five that cycle with the line's level. */
function lineType(context: Context) {
    return LineTextTokens[context.line.level % LineTextTokens.length];
}

/**
 * Tracks the level of each line as Mermaid nests nodes: under the last node indented less deeply.
 * `::icon()` and `:::class` lines decorate the node before them, so nothing nests under them.
 */
export const trackIndent = new ContextTracker<Context>({
    // No line has started yet; as a decoration, the placeholder never joins `nodes`.
    start: { nodes: null, line: { indent: -1, level: 0, parent: null, hash: 0 }, decoration: true },
    shift(context, term, stack, input: InputStreamWithRead) {
        if (term !== indent) return context;
        const nodes = context.decoration ? context.nodes : context.line;
        const width = countIndent(input.read(input.pos, stack.pos));
        let parent = nodes;
        while (parent && parent.indent >= width) parent = parent.parent;
        const level = parent ? parent.level + 1 : 0;
        const hash = ((parent?.hash ?? 0) * 31 + width + 1) | 0;
        return { nodes, line: { indent: width, level, parent, hash }, decoration: false };
    },
    reduce(context, term) {
        return term === IconLine || term === ClassLine ? { ...context, decoration: true } : context;
    },
    hash: (context) => (((context.nodes?.hash ?? 0) * 31 + context.line.hash) * 2
        + (context.decoration ? 1 : 0)) | 0
});
