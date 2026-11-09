/*
 * Adapted from striptags 3.2.0 (https://github.com/ericnorris/striptags).
 * Copyright (c) 2017 Eric Norris. Released under the MIT License:
 * https://github.com/ericnorris/striptags/blob/v3.2.0/LICENSE
 */

/**
 * Removes the HTML tags and comments from `html`, keeping the tags named in `allowedTags` and
 * putting `replacement` where each removed tag was.
 *
 * A `>` inside a quoted attribute value or a nested `<…>` does not end a tag. A `<` followed by
 * anything other than a letter, `/`, `!`, `?` or another `<` is text, as in the HTML parser. A tag
 * or comment still open at the end of `html` is dropped.
 */
export function stripTags(html: string, allowedTags: Iterable<string> = [], replacement = ""): string {
    if (typeof html !== "string") {
        throw new TypeError("'html' parameter must be a string");
    }

    const allowed = new Set(allowedTags);
    const length = html.length;
    let output = "";
    let position = 0;

    while (position < length) {
        const open = html.indexOf("<", position);
        if (open === -1) {
            return output + html.slice(position);
        }
        output += html.slice(position, open);

        if (open + 1 < length && !TAG_START.test(html[open + 1])) {
            output += "<";
            position = open + 1;
            continue;
        }

        if (html.startsWith("<!--", open)) {
            const close = html.indexOf("-->", open + 2);
            if (close === -1) {
                return output;
            }
            position = close + 3;
            continue;
        }

        const close = findTagEnd(html, open + 1);
        if (close === -1) {
            return output;
        }

        if (allowed.size > 0 && allowed.has(readTagName(html, open + 1, close))) {
            output += `<${html.slice(open + 1, close).replace(/[<>]/g, "")}>`;
        } else {
            output += replacement;
        }
        position = close + 1;
    }

    return output;
}

const TAG_START = /[A-Za-z/!?<]/;
const WHITESPACE = /\s/;

/**
 * Reads the lowercased name of the tag whose body spans `start` to `end`, skipping the nested and
 * quoted `<` and `>` that a kept tag loses.
 */
function readTagName(html: string, start: number, end: number) {
    let index = start;
    if (html[index] === "/") {
        index++;
    }

    let name = "";
    for (; index < end; index++) {
        const char = html[index];
        if (char === "/" || WHITESPACE.test(char)) {
            break;
        }
        if (char !== "<" && char !== ">") {
            name += char;
        }
    }
    return name.toLowerCase();
}

/** Returns the index of the `>` that closes the tag whose body starts at `start`, or -1. */
function findTagEnd(html: string, start: number) {
    let depth = 0;
    let quote = "";

    for (let index = start; index < html.length; index++) {
        const char = html[index];
        if (quote) {
            if (char === quote) {
                quote = "";
            }
        } else if (char === "\"" || char === "'") {
            quote = char;
        } else if (char === "<") {
            depth++;
        } else if (char === ">") {
            if (depth === 0) {
                return index;
            }
            depth--;
        }
    }

    return -1;
}
