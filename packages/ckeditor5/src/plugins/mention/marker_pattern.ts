import { env } from "ckeditor5";

export interface MarkerPatternOptions {
    /**
     * How many characters must follow the marker before the panel may open. `0` means the bare
     * marker is enough.
     */
    minimumCharacters?: number;
    /**
     * Whether the query may contain spaces. Note titles do (`@My meeting notes`), attribute names
     * never do — and allowing them there means `#foo bar baz` keeps matching forever, so the panel
     * can never close on its own.
     */
    allowSpaces?: boolean;
}

/**
 * Builds the regular expression deciding whether the text before the caret should open the
 * autocomplete panel, and what the query is.
 *
 * This replaces upstream's `createRegExp()` (`mentionui.ts`), which hardcodes the query as `.` —
 * matching everything including spaces, so a query never stops matching and the panel only ever
 * closes when the feed returns nothing. `=` is excluded from the query unconditionally: past an
 * assignment we are inside an attribute *value*, not a name.
 *
 * The pattern has three groups:
 * - `0` (non-capturing): the opening sequence — start of block, space, `=` or opening punctuation,
 * - `1`: the marker,
 * - `2`: the query typed so far, up to the caret (`$`).
 */
export function createMarkerPattern(marker: string, { minimumCharacters = 0, allowSpaces = false }: MarkerPatternOptions = {}): RegExp {
    // Upstream allows a space or an opening punctuation character before the marker; Trilium adds
    // `=` so a marker can open right after an attribute assignment (`#foo=~bar`).
    const opening = env.features.isRegExpUnicodePropertySupported ? "=\\p{Ps}\\p{Pi}\"'" : "=\\(\\[{\"'";
    const quantifier = minimumCharacters === 0 ? "*" : `{${minimumCharacters},}`;
    const query = allowSpaces ? "[^=]" : "[^\\s=]";

    // The `u` flag applies strict escaping rules — escaping a character that does not need it
    // throws — so the marker goes into a character class, where only these four need escaping.
    const escapedMarker = marker.replace(/[\]\\^-]/g, "\\$&");

    return new RegExp(`(?:^|[ ${opening}])([${escapedMarker}])(${query}${quantifier})$`, "u");
}

export interface FeedPattern {
    marker: string;
    pattern: RegExp;
}

export interface MarkerMatch<T extends FeedPattern> {
    feed: T;
    /** The text typed after the marker, up to the caret. */
    query: string;
}

/**
 * Finds which feed the text before the caret triggers, if any.
 *
 * When several markers are present the one closest to the caret wins — equivalently, the one with
 * the shortest query, since the marker sits immediately before its query. Mirrors upstream's
 * `getLastValidMarkerInText()` + `requestFeedText()`, both of which are module-private.
 */
export function findMarkerMatch<T extends FeedPattern>(feeds: readonly T[], text: string): MarkerMatch<T> | null {
    let best: MarkerMatch<T> | null = null;

    for (const feed of feeds) {
        const markerOffset = text.lastIndexOf(feed.marker);

        if (markerOffset < 0) {
            continue;
        }

        // Include the character before the marker so the opening group has something to match;
        // at offset 0 the `^` alternative applies instead.
        const tail = markerOffset === 0 ? text : text.substring(markerOffset - 1);
        const query = feed.pattern.exec(tail)?.[2];

        if (query === undefined) {
            continue;
        }

        if (!best || query.length < best.query.length) {
            best = { feed, query };
        }
    }

    return best;
}
