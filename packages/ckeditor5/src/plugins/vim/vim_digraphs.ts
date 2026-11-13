/** The diacritics of Vim's digraphs, by their second character, as combining marks. */
const COMBINING_MARKS: Record<string, string> = {
    "'": "\u{301}",
    "!": "\u{300}",
    ">": "\u{302}",
    "?": "\u{303}",
    "-": "\u{304}",
    "(": "\u{306}",
    ".": "\u{307}",
    ":": "\u{308}",
    "0": "\u{30A}",
    "\"": "\u{30B}",
    "<": "\u{30C}",
    ",": "\u{327}",
    ";": "\u{328}"
};

/** The digraphs that are not a letter with a diacritic. */
const SYMBOLS: Record<string, string> = {
    ss: "\u{DF}", ae: "\u{E6}", AE: "\u{C6}", "o/": "\u{F8}", "O/": "\u{D8}", oe: "\u{153}",
    OE: "\u{152}", "d/": "\u{111}", "D/": "\u{110}", th: "\u{FE}", TH: "\u{DE}", "l/": "\u{142}",
    "L/": "\u{141}", Eu: "\u{20AC}", "=e": "\u{20AC}", Pd: "\u{A3}", Ye: "\u{A5}", Ct: "\u{A2}",
    Co: "\u{A9}", Rg: "\u{AE}", TM: "\u{2122}", SE: "\u{A7}", PI: "\u{B6}", DG: "\u{B0}",
    "+-": "\u{B1}", "*X": "\u{D7}", "-:": "\u{F7}", "<<": "\u{AB}", ">>": "\u{BB}", "!I": "\u{A1}",
    "?I": "\u{BF}", NS: "\u{A0}", "12": "\u{BD}", "14": "\u{BC}", "34": "\u{BE}", "1S": "\u{B9}",
    "2S": "\u{B2}", "3S": "\u{B3}", My: "\u{B5}", ".M": "\u{B7}", "-N": "\u{2013}",
    "-M": "\u{2014}", "'6": "\u{2018}", "'9": "\u{2019}", "\"6": "\u{201C}", "\"9": "\u{201D}",
    ",.": "\u{2026}",
    "->": "\u{2192}", "<-": "\u{2190}", "-!": "\u{2191}", "-v": "\u{2193}", "=>": "\u{21D2}",
    "<=": "\u{21D0}", "!=": "\u{2260}", "=<": "\u{2264}", ">=": "\u{2265}", "?=": "\u{2245}",
    "00": "\u{221E}", OK: "\u{2713}", XX: "\u{2717}", Sb: "\u{2219}", "*-": "\u{2217}"
};

/** The Latin letters of the Greek letters of Vim's digraphs, which end with `*`. */
const GREEK = "abgdezyhiklmncoprstufxqw";
const GREEK_LETTERS = "\u{3B1}\u{3B2}\u{3B3}\u{3B4}\u{3B5}\u{3B6}\u{3B7}\u{3B8}"
    + "\u{3B9}\u{3BA}\u{3BB}\u{3BC}\u{3BD}\u{3BE}\u{3BF}\u{3C0}"
    + "\u{3C1}\u{3C3}\u{3C4}\u{3C5}\u{3C6}\u{3C7}\u{3C8}\u{3C9}";

/**
 * The character of Vim's digraph of `first` and `second`, as `Ctrl+K` inserts it, or `null` when
 * there is none. The characters can come in either order, as in Vim.
 */
export function getDigraph(first: string, second: string): string | null {
    return lookUp(first, second) ?? lookUp(second, first);
}

function lookUp(first: string, second: string): string | null {
    const symbol = SYMBOLS[first + second];
    if (symbol) {
        return symbol;
    }
    if (second === "*") {
        const greekIndex = GREEK.indexOf(first.toLowerCase());
        if (greekIndex >= 0) {
            const letter = [ ...GREEK_LETTERS ][greekIndex];
            return first === first.toUpperCase() ? letter.toUpperCase() : letter;
        }
    }
    const mark = COMBINING_MARKS[second];
    if (mark && /^\p{L}$/u.test(first)) {
        const composed = (first + mark).normalize("NFC");
        return [ ...composed ].length === 1 ? composed : null;
    }
    return null;
}
