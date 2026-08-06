import type { TextTypingTransformationDescription } from "@triliumnext/ckeditor5";

import { normalizeLocale } from "../../../utils/formatters.js";

/** The opening and closing mark of one quotation level — what a single quote key produces. */
export type QuoteMarks = readonly [open: string, close: string];

/** Both levels a language sets its quotations in. */
export interface QuoteStyle {
    /** The marks a quotation is normally set in — what the double quote key produces. */
    primary: QuoteMarks;
    /** The marks a quotation nested inside another one is set in — the single quote key. */
    secondary: QuoteMarks;
}

/**
 * Which typographic quotes each locale writes, keyed by a lowercased BCP-47 tag. Looked up most
 * specific first, so `en-gb` wins over `en` and `pt-br` over `pt`.
 *
 * CKEditor only ships three of these — US, en-GB and Polish — and applies the US pair to every
 * locale it has no entry for. That is wrong rather than merely unstyled for a German or French
 * writer, which is what this table exists to fix.
 *
 * A locale is deliberately absent where the convention is one we are not confident about; it then
 * falls through to CKEditor's default, which is a better outcome than a confident guess. That
 * currently means the right-to-left content locales (`ar`, `he`, `ku`, `fa`, `ug`), where usage
 * varies by register and interacts with bidirectional text.
 *
 * Every entry here agrees with CLDR's `delimiters` data for the corresponding locale, which is the
 * tie-breaker where a prescriptive rule and common usage disagree — Spanish being the case in point,
 * where the RAE prescribes guillemets but CLDR (and everyday writing) uses the curly pair. The one
 * intentional departure is French, whose narrow no-break spaces CLDR does not model in this field.
 */
const QUOTE_STYLES: Record<string, QuoteStyle> = {
    // “…” / ‘…’ — the same pair CKEditor defaults to, restated so these locales resolve explicitly
    // rather than by omission.
    en: { primary: ["“", "”"], secondary: ["‘", "’"] },
    ga: { primary: ["“", "”"], secondary: ["‘", "’"] },
    hi: { primary: ["“", "”"], secondary: ["‘", "’"] },
    id: { primary: ["“", "”"], secondary: ["‘", "’"] },
    ko: { primary: ["“", "”"], secondary: ["‘", "’"] },
    zh: { primary: ["“", "”"], secondary: ["‘", "’"] },
    "pt-br": { primary: ["“", "”"], secondary: ["‘", "’"] },
    es: { primary: ["“", "”"], secondary: ["‘", "’"] },
    // Listed although it now matches `en`, so that the agreement reads as a decision rather than an
    // omission: British usage traditionally inverts the two levels — which is what CKEditor's own
    // `quotesPrimaryEnGb` still does — but CLDR has en-GB on double quotes, following the publishers
    // that moved. Restoring the inverted pair wants evidence, not just the memory of the old rule.
    "en-gb": { primary: ["“", "”"], secondary: ["‘", "’"] },

    // „…“ — the closing mark is the raised one, not a mirror of the opening.
    de: { primary: ["„", "“"], secondary: ["‚", "‘"] },
    cs: { primary: ["„", "“"], secondary: ["‚", "‘"] },

    // „…” with guillemets for the nested level.
    pl: { primary: ["„", "”"], secondary: ["«", "»"] },
    ro: { primary: ["„", "”"], secondary: ["«", "»"] },

    // Guillemets outermost, low-high pair nested.
    ru: { primary: ["«", "»"], secondary: ["„", "“"] },
    uk: { primary: ["«", "»"], secondary: ["„", "“"] },

    // French sets a narrow no-break space inside the guillemets. Replacements are not
    // length-constrained, so the space rides along with the mark it belongs to.
    fr: { primary: ["« ", " »"], secondary: ["“", "”"] },

    it: { primary: ["«", "»"], secondary: ["“", "”"] },
    // Portugal. Brazilian usage is the curly pair above, under `pt-br` — CLDR models the split the
    // other way round, keeping Brazil in plain `pt` and Portugal in `pt-PT`.
    pt: { primary: ["«", "»"], secondary: ["“", "”"] },

    // Corner brackets, used by Japanese and by traditional (but not simplified) Chinese.
    ja: { primary: ["「", "」"], secondary: ["『", "』"] },
    "zh-tw": { primary: ["「", "」"], secondary: ["『", "』"] }
};

/**
 * The mark pairs offered as an explicit choice, for writers who would rather name their marks than
 * have a language name them — someone writing three languages in a single note, or who simply
 * prefers one pair and does not want the note's metadata deciding. macOS offers exactly this and
 * nothing else; LibreOffice offers it alongside the locale defaults, which is the shape taken here.
 *
 * One flat list, offered for both the double and the single quote: which key a pair belongs on is a
 * convention rather than a property of the marks, and the conventions disagree — British typography
 * puts `‘…’` on the double quote where American puts `“…”`. Choosing for each key separately is what
 * lets both be had.
 *
 * Every pair that a locale already writes points at that row rather than restating it, so the marks
 * live in one place — the French narrow no-break spaces above all, which are invisible in a diff and
 * have been mistyped twice already.
 */
export const QUOTE_MARK_PRESETS = [
    { id: "double-curly", marks: QUOTE_STYLES.en.primary },
    { id: "single-curly", marks: QUOTE_STYLES.en.secondary },
    { id: "low-high", marks: QUOTE_STYLES.de.primary },
    { id: "single-low-high", marks: QUOTE_STYLES.de.secondary },
    { id: "low-right", marks: QUOTE_STYLES.pl.primary },
    { id: "guillemets", marks: QUOTE_STYLES.ru.primary },
    { id: "guillemets-spaced", marks: QUOTE_STYLES.fr.primary },
    // The only pair no locale in the table writes: single guillemets, which several conventions
    // nest inside the double ones.
    { id: "single-guillemets", marks: ["‹", "›"] },
    { id: "corner", marks: QUOTE_STYLES.ja.primary },
    { id: "white-corner", marks: QUOTE_STYLES.ja.secondary }
] as const satisfies readonly { id: string; marks: readonly [open: string, close: string] }[];

/** The marks a preset id names, or `null` for an id we do not know — a hand-edited option, or one
 *  written by a version that offered a preset this one has dropped. */
export function getQuoteMarkPreset(id: string | null | undefined): QuoteMarks | null {
    return QUOTE_MARK_PRESETS.find((preset) => preset.id === id)?.marks ?? null;
}

/** What one of the two quote settings comes to for a given note. */
export interface ResolvedQuoteSetting {
    /** The marks to install, or `null` to install none. */
    marks: QuoteMarks | null;
    /** Whether CKEditor's own transformation for this key has to be taken out of the way. */
    overridesUpstream: boolean;
}

/**
 * Works out what one of the two settings means for a note: an explicit pair wins outright, `off`
 * installs nothing, and anything else follows the note's language.
 *
 * The distinction the `overridesUpstream` flag carries is that a language we have no pair for keeps
 * falling through to CKEditor's own quotes, rather than silently losing quote replacement — while
 * `off` deliberately takes them away.
 */
export function resolveQuoteSetting(setting: string | null | undefined, level: keyof QuoteStyle, contentLanguage: string | null): ResolvedQuoteSetting {
    if (setting === "off") return { marks: null, overridesUpstream: true };

    const preset = getQuoteMarkPreset(setting);
    if (preset) return { marks: preset, overridesUpstream: true };

    const style = resolveQuoteStyle(contentLanguage);
    return style ? { marks: style[level], overridesUpstream: true } : { marks: null, overridesUpstream: false };
}

/**
 * Picks the quote style for the first of `candidates` that maps to one, so callers can express a
 * preference order — the note's own `#language`, then the formatting locale, then the UI language.
 * Returns `null` when nothing matches, meaning CKEditor's own defaults should be left in place.
 */
export function resolveQuoteStyle(...candidates: (string | null | undefined)[]): QuoteStyle | null {
    for (const candidate of candidates) {
        if (!candidate) continue;

        // `normalizeLocale` is what the date and number formatters resolve through, so the ids
        // Trilium stores (`pt_br`, `cn`, `tw`) map the same way in both places.
        const locale = normalizeLocale(candidate).toLowerCase();
        // A region-qualified tag falls back to its base language, so `de-DE` and `de-AT` both find
        // `de` while `en-GB` still keeps its own entry.
        const style = QUOTE_STYLES[locale] ?? QUOTE_STYLES[locale.split("-")[0]];
        if (style) return style;
    }

    return null;
}

/**
 * The transformation that replaces a run typed between `quoteCharacter`s with `marks`, in the shape
 * CKEditor's `typing.transformations.extra` takes. Built one key at a time, since the double and the
 * single quote are configured apart.
 */
export function buildQuoteTransformation(quoteCharacter: "\"" | "'", marks: QuoteMarks): TextTypingTransformationDescription {
    return { from: buildQuotesRegExp(quoteCharacter), to: [null, marks[0], null, marks[1]] };
}

/**
 * Matches a quoted run that ends at the caret: the mark opens at the start of the line or after a
 * space, and nothing between the two marks is another one of them. Groups 2 and 4 are the marks the
 * transformation swaps out.
 *
 * Replicates the regex CKEditor builds for its own quote transformations, which it does not export.
 */
function buildQuotesRegExp(quoteCharacter: string) {
    return new RegExp(`(^|\\s)(${quoteCharacter})([^${quoteCharacter}]*)(${quoteCharacter})$`);
}
