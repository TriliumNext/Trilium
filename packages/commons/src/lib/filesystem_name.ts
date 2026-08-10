/**
 * Turning something a user typed into something a file can be called.
 *
 * Shared rather than kept beside the field that asks for the name, because the name is asked for in
 * one place and written in another: the setup screen types it, and the backend writes the file. A
 * name arriving over a request is not a name the field has vetted, so the side that opens the file
 * applies these rules again rather than trusting that it did.
 *
 * @module
 */

/**
 * Characters no file name may contain.
 *
 * Only what no major filesystem accepts belongs in this list: Windows refuses these outright and
 * `/` is the separator everywhere else. Everything left out of it, accented letters and other
 * scripts included, makes a perfectly good file name. Control characters are refused as well,
 * below, since they cannot be written down here.
 */
export const FORBIDDEN_FILE_NAME_CHARACTERS = '<>:"/\\|?*';

/** Reserved device names on Windows, which cannot be a file name there whatever the extension. */
const RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Drops every character a file name may not contain, and nothing else.
 *
 * Applied to each keystroke where a name is being typed, so it must leave a half-typed name alone:
 * anything that trimmed or rearranged here would fight the person typing.
 */
export function toFilesystemFriendlyName(value: string): string {
    return [ ...value ].filter((character) => !isForbidden(character)).join("");
}

/**
 * The same, plus what can only be settled once the name is finished: surrounding whitespace and a
 * trailing dot, which are legal mid-edit and refused at save time.
 *
 * The trailing run is walked off by hand rather than matched. The obvious `/[. ]+$/` is quadratic
 * on a name that is one long run of dots and does not end in one, and this runs on a name arriving
 * over a request, where the length is the caller's to choose.
 */
export function tidyFilesystemFriendlyName(value: string): string {
    const name = toFilesystemFriendlyName(value).trim();

    let end = name.length;
    while (end > 0 && isForbiddenAtTheEnd(name[end - 1])) {
        end--;
    }

    return name.slice(0, end);
}

/**
 * What the file ends up called, or `null` where nothing usable is left of what was given.
 *
 * The two cases a caller has to have an answer for are a name that empties itself out and one of
 * the device names Windows reserves; both leave the caller to fall back on a name of its own rather
 * than on a file that cannot be created.
 *
 * Separators are among the characters dropped, so what comes back is a single name and never a
 * path: a caller may resolve it against a directory of its choosing without it reaching outside.
 */
export function asFileName(value: string): string | null {
    const tidied = tidyFilesystemFriendlyName(value);

    return tidied && !RESERVED_FILE_NAMES.test(tidied) ? tidied : null;
}

/** Whether a single character is one no file name may contain. */
function isForbidden(character: string): boolean {
    return FORBIDDEN_FILE_NAME_CHARACTERS.includes(character)
        // `charCodeAt` rather than `codePointAt`, which is typed as possibly absent and would
        // leave a "no character there" case that this cannot reach and so cannot be tested. A
        // character outside the basic plane reports the first half of its pair, far above the
        // control characters this is looking for, which is the same answer either way.
        || character.charCodeAt(0) < 0x20;
}

/** Whether a character is one no name may end on: legal to type, impossible to save on Windows. */
function isForbiddenAtTheEnd(character: string): boolean {
    return character === "." || character === " ";
}
