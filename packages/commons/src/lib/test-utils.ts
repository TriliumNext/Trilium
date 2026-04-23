/**
 * Reads the level of indentation of the first line and trims the identation for all the text by that amount.
 *
 * For example, for:
 *
 * ```json
 *          {
 *              "hello": "world"
 *          }
 * ```
 *
 * it results in:
 *
 * ```json
 * {
 *     "hello": "world"
 * }
 * ```
 *
 * This is meant to be used as a template string, where it allows the indentation of the template without affecting whitespace changes.
 *
 * @example const html = trimIndentation`\
 *           <h1>Heading 1</h1>
 *           <h2>Heading 2</h2>
 *           <h3>Heading 3</h3>
 *           <h4>Heading 4</h4>
 *           <h5>Heading 5</h5>
 *           <h6>Heading 6</h6>
 *       `;
 * @param strings
 * @returns
 */
export function trimIndentation(strings: TemplateStringsArray, ...values: any[]) {
    // Combine the strings with the values using interpolation
    let str = strings.reduce((acc, curr, index) => {
        return acc + curr + (values[index] !== undefined ? values[index] : '');
    }, '');

    // Count the number of spaces on the first line.
    let numSpaces = 0;
    while (str.charAt(numSpaces) == " " && numSpaces < str.length) {
        numSpaces++;
    }

    // Trim the indentation of the first line in all the lines.
    const lines = str.split("\n");
    const output: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        let numSpacesLine = 0;
        while (str.charAt(numSpacesLine) == " " && numSpacesLine < str.length) {
            numSpacesLine++;
        }
        output.push(lines[i].substring(numSpacesLine));
    }
    return output.join("\n");
}

export function flushPromises() {
    return new Promise(setImmediate);
}

export function sleepFor(duration: number) {
    return new Promise(resolve => setTimeout(resolve, duration));
}

/**
 * Scans raw JSON text for keys that are duplicated within the same object.
 *
 * `JSON.parse` silently collapses duplicate keys (the last one wins), which makes
 * it impossible to detect them from the parsed value. This scanner walks the raw
 * text, pushing/popping a scope for each `{`/`}`, and identifies a string as a
 * key when the next non-whitespace char is `:`.
 *
 * Intended for validating hand-maintained JSON files (e.g. translation files)
 * at test level.
 */
export function findDuplicateJsonKeys(text: string): Array<{ key: string; line: number }> {
    const duplicates: Array<{ key: string; line: number }> = [];
    const stack: Set<string>[] = [];
    let line = 1;
    let i = 0;

    while (i < text.length) {
        const c = text[i];
        if (c === "\n") {
            line++;
            i++;
        } else if (c === "{") {
            stack.push(new Set());
            i++;
        } else if (c === "}") {
            stack.pop();
            i++;
        } else if (c === '"') {
            const start = i;
            const startLine = line;
            i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === "\\") {
                    i += 2;
                } else {
                    if (text[i] === "\n") line++;
                    i++;
                }
            }
            i++;
            // A string is a key iff the next non-whitespace char is ':'.
            let j = i;
            while (j < text.length && /\s/.test(text[j])) j++;
            if (text[j] === ":" && stack.length > 0) {
                const key = JSON.parse(text.substring(start, i)) as string;
                const frame = stack[stack.length - 1];
                if (frame.has(key)) {
                    duplicates.push({ key, line: startLine });
                } else {
                    frame.add(key);
                }
            }
        } else {
            i++;
        }
    }

    return duplicates;
}
