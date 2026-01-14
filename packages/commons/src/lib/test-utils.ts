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

export function sleepFor(duration: number) {
    return new Promise(resolve => setTimeout(resolve, duration));
}
