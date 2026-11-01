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
        while (numSpacesLine < numSpaces && lines[i].charAt(numSpacesLine) === " ") {
            numSpacesLine++;
        }
        output.push(lines[i].substring(numSpacesLine));
    }
    return output.join("\n");
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
/**
 * Scans a parsed translation file for keys that Weblate would read as a plural form but
 * that do not hold a plain string.
 *
 * Weblate parses our translation files as i18next JSON v4, in which a `_zero`, `_one`,
 * `_two`, `_few`, `_many` or `_other` suffix marks a plural form of the key preceding it.
 * All the forms found for a key are then combined into a single multistring, which fails
 * with "multistring can only contain strings or list of strings" as soon as one of them
 * is a nested object rather than a translated string.
 *
 * In practice this bites when a namespace happens to be named after a plural suffix — for
 * example a `settings_other` section sitting next to a `settings` one, which Weblate reads
 * as the plural of `settings` instead of as a section of its own.
 *
 * @param value the parsed translation file (or any subtree of it).
 * @param path the dotted path of `value`, used to build the reported paths.
 * @returns one entry per offending key, with its dotted path and the plural suffix that
 *          made Weblate treat it as a plural form.
 */
export function findPluralKeyConflicts(value: unknown, path = ""): Array<{ path: string; suffix: string }> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [];
    }

    const conflicts: Array<{ path: string; suffix: string }> = [];
    for (const [ key, child ] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        const suffix = PLURAL_SUFFIXES.find((candidate) => key.endsWith(`_${candidate}`));
        if (suffix && !isTranslatableValue(child)) {
            conflicts.push({ path: childPath, suffix });
        }
        conflicts.push(...findPluralKeyConflicts(child, childPath));
    }
    return conflicts;
}

/**
 * Scans a parsed translation file for plural groups whose forms do not match the plural
 * categories of the language the file holds.
 *
 * Both i18next and Weblate read a `_zero`/`_one`/`_two`/`_few`/`_many`/`_other` suffix as a
 * plural form of the key preceding it, and gather all the forms of a key into one unit. A key
 * that merely happens to end that way — `open_all_too_many` for "too many notes to open" — is
 * therefore not a key of its own: it declares the `many` form of `open_all_too`, leaving the
 * forms the language actually uses empty. Weblate then counts the whole unit as untranslated,
 * which in the source language means it can never reach 100%, and it propagates the phantom
 * key with its empty forms to every locale it manages.
 *
 * The reverse — a plural group missing one of the forms its language declines — is worth the
 * same report: the missing form falls back to another one and reads wrong for those counts.
 *
 * @param value the parsed translation file (or any subtree of it).
 * @param categories the plural categories of the file's language, e.g. `["one", "other"]` for
 *                   English — `Intl.PluralRules` is the authority on these.
 * @param path the dotted path of `value`, used to build the reported paths.
 * @returns one entry per offending group, with the forms it declares and how they differ from
 *          the expected ones.
 */
export function findMalformedPluralGroups(
    value: unknown,
    categories: string[],
    path = ""
): Array<{ path: string; present: string[]; missing: string[]; unexpected: string[] }> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [];
    }

    const malformed: Array<{ path: string; present: string[]; missing: string[]; unexpected: string[] }> = [];
    // Insertion-ordered, so groups are reported in the order the file declares them.
    const groups = new Map<string, string[]>();

    for (const [ key, child ] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        const suffix = PLURAL_SUFFIXES.find((candidate) => key.endsWith(`_${candidate}`));
        // A form holding anything but a string is `findPluralKeyConflicts`'s business: it is a
        // section that only looks like a plural, and reporting it as a broken group too would
        // just be the same finding twice.
        if (suffix && typeof child === "string") {
            const base = key.slice(0, -(suffix.length + 1));
            groups.set(base, [ ...groups.get(base) ?? [], suffix ]);
        }
        malformed.push(...findMalformedPluralGroups(child, categories, childPath));
    }

    for (const [ base, present ] of groups) {
        const missing = categories.filter((category) => !present.includes(category));
        const unexpected = present.filter((suffix) => !categories.includes(suffix));
        if (missing.length || unexpected.length) {
            malformed.push({ path: path ? `${path}.${base}` : base, present, missing, unexpected });
        }
    }

    return malformed;
}

/** The CLDR plural categories i18next appends to a key, in the `key_<category>` form. */
const PLURAL_SUFFIXES = [ "zero", "one", "two", "few", "many", "other" ];

/** Whether Weblate can turn the value into a multistring, i.e. a string or a list of strings. */
function isTranslatableValue(value: unknown) {
    return typeof value === "string"
        || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

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
