/**
 * How a font option points at one of the user's own fonts — a note labelled `#customFont` — and the
 * CSS family that note's file is registered under.
 *
 * The reference is the note's id, not the font's name. The name a font is offered under is the
 * note's title, which the user is free to change at any time, and an option holding that name would
 * stop resolving the moment they did. The id also keeps user-authored text out of the stylesheet the
 * font options are served as (see `getFontCss`): what reaches a CSS declaration is the family below,
 * built from an id this module has checked.
 */
const OPTION_PREFIX = "customFont:";

/** A note id as Trilium mints them. Checked before an id is built into a CSS family. */
const NOTE_ID_PATTERN = /^[A-Za-z0-9_]+$/;

/** What a font option holds to name the user's own font note. */
export function customFontOption(noteId: string): string {
    return `${OPTION_PREFIX}${noteId}`;
}

/**
 * The note a font option names, or `null` where the option names a family the browser resolves for
 * itself ("Arial", "theme", "system").
 */
export function customFontNoteId(optionValue: string | undefined | null): string | null {
    if (!optionValue?.startsWith(OPTION_PREFIX)) {
        return null;
    }

    const noteId = optionValue.substring(OPTION_PREFIX.length);
    return NOTE_ID_PATTERN.test(noteId) ? noteId : null;
}

/** The CSS family a note's font file is registered under. */
export function customFontFamily(noteId: string): string {
    return `trilium-font-${noteId}`;
}
