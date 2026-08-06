import { describe, expect, it } from "vitest";

import { buildQuoteTransformation, getQuoteMarkPreset, QUOTE_MARK_PRESETS, type QuoteStyle, resolveQuoteSetting, resolveQuoteStyle } from "./quotes.js";

/**
 * Applies a transformation the way CKEditor's `TextTransformation` does: match the text before the
 * caret, then swap in every group the `to` array names, leaving the `null` ones alone. Lets the
 * regex and the replacement array be asserted together, which is where a quote pair actually breaks.
 */
function transform(transformation: ReturnType<typeof buildQuoteTransformation>, text: string) {
    const from = transformation.from;
    if (!(from instanceof RegExp) || !Array.isArray(transformation.to)) {
        throw new Error("the quote transformations are built as a RegExp plus a replacement array");
    }

    const matches = from.exec(text);
    if (!matches) return null;

    let result = text.slice(0, matches.index);
    for (let i = 1; i < matches.length; i++) {
        result += transformation.to[i - 1] ?? matches[i];
    }
    return result + text.slice(matches.index + matches[0].length);
}

/** The primary (double-quote) and secondary (single-quote) transformation for a locale. */
function transformationsFor(locale: string) {
    const style = resolveQuoteStyle(locale);
    if (!style) throw new Error(`expected ${locale} to resolve to a quote style`);
    return {
        primary: buildQuoteTransformation("\"", style.primary),
        secondary: buildQuoteTransformation("'", style.secondary)
    };
}

describe("resolveQuoteStyle", () => {
    it("takes the first candidate that maps, skipping empty ones", () => {
        const de: QuoteStyle = { primary: ["„", "“"], secondary: ["‚", "‘"] };

        expect(resolveQuoteStyle("de", "fr", "en")).toEqual(de);
        // The note has no `#language`, so the formatting locale decides.
        expect(resolveQuoteStyle(null, "de", "en")).toEqual(de);
        expect(resolveQuoteStyle(undefined, "", "de")).toEqual(de);
        // An unmapped candidate does not stop the search.
        expect(resolveQuoteStyle("ar", "de")).toEqual(de);
    });

    it("returns null when nothing maps, leaving CKEditor's defaults in place", () => {
        expect(resolveQuoteStyle()).toBeNull();
        expect(resolveQuoteStyle(null, undefined, "")).toBeNull();
        // The right-to-left content locales are deliberately unmapped.
        for (const locale of ["ar", "he", "ku", "fa", "ug"]) {
            expect(resolveQuoteStyle(locale)).toBeNull();
        }
    });

    it("falls back from a region to its base language, but not past a mapped region", () => {
        expect(resolveQuoteStyle("de-DE")).toEqual(resolveQuoteStyle("de"));
        expect(resolveQuoteStyle("de-AT")).toEqual(resolveQuoteStyle("de"));
        expect(resolveQuoteStyle("fr-CA")).toEqual(resolveQuoteStyle("fr"));

        expect(resolveQuoteStyle("en-US")).toEqual({ primary: ["“", "”"], secondary: ["‘", "’"] });

        // A region that has an entry of its own keeps it instead of collapsing into the base
        // language. Brazilian vs European Portuguese is the pair that still differs.
        expect(resolveQuoteStyle("pt-BR")).toEqual({ primary: ["“", "”"], secondary: ["‘", "’"] });
        expect(resolveQuoteStyle("pt-BR")).not.toEqual(resolveQuoteStyle("pt"));
    });

    it("follows CLDR where a prescriptive rule and common usage disagree", () => {
        // Spanish: the RAE prescribes guillemets, CLDR and everyday writing use the curly pair.
        expect(resolveQuoteStyle("es")).toEqual({ primary: ["“", "”"], secondary: ["‘", "’"] });

        // en-GB: traditional British style inverts the two levels, and CKEditor's own
        // `quotesPrimaryEnGb` still does, but CLDR has en-GB on doubles — so it matches `en`. The
        // entry is kept rather than deleted so that agreeing reads as a decision, not an omission.
        expect(resolveQuoteStyle("en-GB")).toEqual({ primary: ["“", "”"], secondary: ["‘", "’"] });
        expect(resolveQuoteStyle("en-GB")).toEqual(resolveQuoteStyle("en"));
    });

    it("normalizes the locale ids Trilium stores, matching the date and number formatters", () => {
        // Underscored and case-varied forms reach the same entry.
        expect(resolveQuoteStyle("pt_br")).toEqual(resolveQuoteStyle("pt-BR"));
        // Brazilian usage differs from European Portuguese, so it must not collapse into `pt`.
        expect(resolveQuoteStyle("pt_br")).not.toEqual(resolveQuoteStyle("pt"));
        expect(resolveQuoteStyle("pt")).toEqual({ primary: ["«", "»"], secondary: ["“", "”"] });

        // `cn`/`tw` are Trilium ids that normalize to zh-CN/zh-TW; only traditional uses brackets.
        expect(resolveQuoteStyle("cn")).toEqual({ primary: ["“", "”"], secondary: ["‘", "’"] });
        expect(resolveQuoteStyle("tw")).toEqual({ primary: ["「", "」"], secondary: ["『", "』"] });
    });
});

/** U+202F, the narrow no-break space French sets inside its guillemets. Named so the assertions
 * below do not carry an invisible character that reads as stray whitespace. */
const NNBSP = "\u202F";

describe("QUOTE_MARK_PRESETS", () => {
    it("offers each pair once, under an id naming the marks rather than a language", () => {
        const ids = QUOTE_MARK_PRESETS.map((preset) => preset.id);

        expect(new Set(ids).size).toBe(ids.length);
        // Named for their shape: the same pair serves several languages, and a writer picking one is
        // choosing marks, not declaring what they write in.
        expect(ids).toContain("guillemets-spaced");
        expect(ids).not.toContain("fr");
    });

    it("takes its marks from the locale table, so a pair is written in one place", () => {
        // French above all: its narrow no-break spaces are invisible in a diff and have been
        // mistyped before.
        expect(getQuoteMarkPreset("guillemets-spaced")).toEqual(resolveQuoteStyle("fr")?.primary);
        expect(getQuoteMarkPreset("low-high")).toEqual(resolveQuoteStyle("de")?.primary);
        expect(getQuoteMarkPreset("single-low-high")).toEqual(resolveQuoteStyle("de")?.secondary);
        expect(getQuoteMarkPreset("white-corner")).toEqual(resolveQuoteStyle("ja")?.secondary);
    });

    it("offers both curly pairs, so either can go on either key", () => {
        // The conventions disagree about which belongs on which — British typography sets on the
        // single marks where American sets on the double — so neither is tied to a key here.
        expect(getQuoteMarkPreset("double-curly")).toEqual(resolveQuoteStyle("en")?.primary);
        expect(getQuoteMarkPreset("single-curly")).toEqual(resolveQuoteStyle("en")?.secondary);
    });

    it("returns null for an id it does not know", () => {
        expect(getQuoteMarkPreset("no-such-style")).toBeNull();
        expect(getQuoteMarkPreset("")).toBeNull();
        expect(getQuoteMarkPreset(null)).toBeNull();
    });
});

describe("resolveQuoteSetting", () => {
    it("lets a chosen pair outrank the note's language", () => {
        expect(resolveQuoteSetting("corner", "primary", "de")).toEqual({
            marks: resolveQuoteStyle("ja")?.primary,
            overridesUpstream: true
        });
    });

    it("takes the level asked for when following the language", () => {
        const german = resolveQuoteStyle("de");

        expect(resolveQuoteSetting("auto", "primary", "de")).toEqual({ marks: german?.primary, overridesUpstream: true });
        expect(resolveQuoteSetting("auto", "secondary", "de")).toEqual({ marks: german?.secondary, overridesUpstream: true });
    });

    it("installs nothing but still takes over when switched off", () => {
        expect(resolveQuoteSetting("off", "primary", "de")).toEqual({ marks: null, overridesUpstream: true });
    });

    it("leaves upstream in place for a language with no pair of ours", () => {
        // The distinction that keeps an unmapped locale on CKEditor's own quotes rather than losing
        // them: nothing to install, and nothing to remove either.
        expect(resolveQuoteSetting("auto", "primary", "ku")).toEqual({ marks: null, overridesUpstream: false });
        // An id we do not know is read as "auto" rather than as "off".
        expect(resolveQuoteSetting("no-such-style", "primary", "ku")).toEqual({ marks: null, overridesUpstream: false });
    });
});

describe("buildQuoteTransformations", () => {
    it("replaces both marks of a quoted run, leaving the text between them alone", () => {
        const { primary, secondary } = transformationsFor("en");

        expect(transform(primary, `he said "hello there"`)).toBe(`he said “hello there”`);
        expect(transform(secondary, `he said 'hello there'`)).toBe(`he said ‘hello there’`);
        // Opening at the very start of the line is matched too.
        expect(transform(primary, `"hello"`)).toBe(`“hello”`);
    });

    it("only fires once the run is closed, and not on a quote mid-word", () => {
        const { primary, secondary } = transformationsFor("en");

        // Still typing inside the quotes.
        expect(transform(primary, `he said "hello`)).toBeNull();
        // The opening mark has to start the line or follow a space, so an apostrophe is safe.
        expect(transform(secondary, `it's fine`)).toBeNull();
        expect(transform(secondary, `don't say it's fine`)).toBeNull();
    });

    it("uses the asymmetric marks of locales that do not mirror them", () => {
        // German closes with the raised mark rather than a mirror of the opening one.
        expect(transform(transformationsFor("de").primary, `er sagte "hallo"`)).toBe(`er sagte „hallo“`);
        expect(transform(transformationsFor("de").secondary, `er sagte 'hallo'`)).toBe(`er sagte ‚hallo‘`);
        // Polish opens low and closes high.
        expect(transform(transformationsFor("pl").primary, `on rzekł "cześć"`)).toBe(`on rzekł „cześć”`);
        // Russian sets guillemets outermost.
        expect(transform(transformationsFor("ru").primary, `он сказал "привет"`)).toBe(`он сказал «привет»`);
    });

    it("keeps the narrow no-break spaces French sets inside its guillemets", () => {
        expect(transform(transformationsFor("fr").primary, `il a dit "bonjour"`)).toBe(`il a dit «${NNBSP}bonjour${NNBSP}»`);
        // The nested level takes plain double quotes, without the spacing.
        expect(transform(transformationsFor("fr").secondary, `il a dit 'bonjour'`)).toBe(`il a dit “bonjour”`);
    });

    it("uses corner brackets for Japanese", () => {
        expect(transform(transformationsFor("ja").primary, `彼は "こんにちは"`)).toBe(`彼は 「こんにちは」`);
    });
});
