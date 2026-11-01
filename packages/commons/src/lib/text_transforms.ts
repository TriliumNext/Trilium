import { autoSort } from "./auto_sort.js";
import { toLanguageTag } from "./i18n.js";

/** A change made to each line of a block of lines. */
export type LineOperation =
    | "sortAscending"
    | "sortDescending"
    | "shuffle"
    | "reverse"
    | "deduplicate"
    | "trimLeading"
    | "trimTrailing"
    | "trimBoth"
    | "removeBlankLines";

/** A change made to the letters of a text. */
export type TextTransform =
    | "upperCase"
    | "lowerCase"
    | "sentenceCase"
    | "titleCase"
    | "removeDiacritics";

export interface LineOperationOptions {
    /** A Trilium locale id or a BCP 47 tag, for sorting. Defaults to the runtime's locale. */
    locale?: string;
    /** More date formats for sorting to recognize, in Day.js syntax. */
    dateFormats?: string[];
    /** Returns a random number from 0 to 1, for shuffling. Defaults to `Math.random`. */
    random?: () => number;
}

export interface TextTransformOptions {
    /** A Trilium locale id or a BCP 47 tag. Defaults to the runtime's locale. */
    locale?: string;
    /** The text before `text` on its line, to tell if `text` starts a word or a sentence. */
    before?: string;
    /** The text after `text` on its line, to tell if `text` ends a sentence. */
    after?: string;
}

/**
 * Applies `operation` to `lines` and returns the new lines. Sorting uses `autoSort`, so numbers,
 * dates and times sort by their value and blank lines go last. Deduplication keeps the first copy.
 */
export function transformLines(
    lines: readonly string[],
    operation: LineOperation,
    options: LineOperationOptions = {}
): string[] {
    switch (operation) {
        case "sortAscending":
        case "sortDescending":
            return autoSort(lines, (line) => line, {
                locale: options.locale,
                dateFormats: options.dateFormats,
                isDescending: operation === "sortDescending"
            });
        case "shuffle":
            return shuffle(lines, options.random ?? Math.random);
        case "reverse":
            return lines.toReversed();
        case "deduplicate":
            return [ ...new Set(lines) ];
        case "trimLeading":
            return lines.map((line) => line.trimStart());
        case "trimTrailing":
            return lines.map((line) => line.trimEnd());
        case "trimBoth":
            return lines.map((line) => line.trim());
        case "removeBlankLines":
            return lines.filter((line) => line.trim() !== "");
    }
}

/**
 * Applies `transform` to `text` and returns the new text. Case changes follow the rules of the
 * locale, such as the dotted capital İ of Turkish. Sentence case and title case lowercase the text,
 * then capitalize the first word of each sentence, or each word except minor words such as "of".
 * A line break ends a sentence.
 */
export function transformText(
    text: string,
    transform: TextTransform,
    options: TextTransformOptions = {}
): string {
    const locale = toLanguageTag(options.locale ?? new Intl.Collator().resolvedOptions().locale);

    switch (transform) {
        case "upperCase":
            return text.toLocaleUpperCase(locale);
        case "lowerCase": {
            const { before = "", after = "" } = options;
            const start = before.length;
            return toLowerCase(before + text + after, start, start + text.length, locale);
        }
        case "sentenceCase":
            return changeWordCase(text, locale, options, (word) => word.isSentenceStart);
        case "titleCase": {
            const minorWords = MINOR_WORDS.get(languageOf(locale));
            const isMinor = (word: Word) => !!minorWords?.has(word.text.toLocaleLowerCase(locale));
            return changeWordCase(text, locale, options, (word, next) =>
                word.isSentenceStart || !next || next.isSentenceStart || !isMinor(word));
        }
        case "removeDiacritics":
            return removeDiacritics(text);
    }
}

interface Word {
    start: number;
    end: number;
    text: string;
    /** Whether the word is the first one of its line or comes after a sentence terminator. */
    isSentenceStart: boolean;
}

// A letter or a digit, then letters, marks and digits, with apostrophes inside: "don't", "l'eau".
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
// A line break, or a sentence terminator with any closing quotes and brackets, then whitespace.
const SENTENCE_BREAK = /[\n\r\u{2028}\u{2029}]|\p{Sentence_Terminal}\S*\s/u;

/** Words that title case keeps in lowercase, except as the first or last word of a sentence. */
const MINOR_WORDS = new Map(Object.entries({
    de: "an am auf aus bei das dem den der des die ein eine einem einen einer eines für im in mit "
        + "nach oder über und unter von vor zu zum zur",
    en: "a an and as at but by for in nor of on or per the to via vs",
    es: "a al con de del e el en la las lo los o para por sin sobre u un una unas unos y",
    fr: "à au aux avec dans de des du en et la le les ou par pour sans sur un une",
    it: "a al alla con da dei del della delle di e fra gli i il in la le lo nel nella o per su tra "
        + "un una uno",
    nl: "aan bij de een en het in met of om op te uit van voor",
    pt: "a as com da das de do dos e em na nas no nos o os ou para por sem um uma",
    ro: "a al ale cu de din în la o ori pe sau și un"
}).map(([ language, words ]) => [ language, new Set(words.split(" ")) ]));

// A capital sigma at the end of a word, by the Final_Sigma condition of Unicode. Sticky, to test
// one position of a line.
const FINAL_SIGMA = /(?<=\p{Cased}\p{Case_Ignorable}*)Σ(?!\p{Case_Ignorable}*\p{Cased})/uy;

/** The lowercase letters whose capital is not their uppercase: Latin digraphs such as "ǆ". */
const TITLE_CASE_LETTERS = new Map([ [ "ǆ", "ǅ" ], [ "ǉ", "ǈ" ], [ "ǌ", "ǋ" ], [ "ǳ", "ǲ" ] ]);
// Georgian Mkhedruli letters, whose uppercase (Mtavruli) is only for text in all caps.
const GEORGIAN = /[\u{10d0}-\u{10fa}\u{10fd}-\u{10ff}]/u;

// A letter with combining marks, or a letter that can be precomposed with a diacritic: not ASCII,
// kana, CJK or Hangul. A mark on a symbol stays, such as the slash of "≠" or a keycap emoji.
const LETTER = /\p{L}\p{M}+|[^\P{L}\0-\x7f\u{3040}-\u{9fff}\u{ac00}-\u{d7af}\u{f900}-\u{faff}]/gu;
// Diacritics, but not the marks that are part of the spelling, such as Devanagari vowel signs,
// Thai vowels and the kana voicing marks.
const DIACRITIC = new RegExp([
    // Combining diacritical marks and the blocks that extend them.
    "[\u{0300}-\u{036f}\u{1ab0}-\u{1aff}\u{1dc0}-\u{1dff}\u{20d0}-\u{20ff}\u{fe20}-\u{fe2f}]",
    // Hebrew points and cantillation marks.
    "[\u{0591}-\u{05bd}\u{05bf}\u{05c1}\u{05c2}\u{05c4}\u{05c5}\u{05c7}]",
    // Arabic vowel marks and Quranic annotation marks.
    "[\u{0610}-\u{061a}\u{064b}-\u{065f}\u{0670}]",
    "[\u{06d6}-\u{06dc}\u{06df}-\u{06e4}\u{06e7}\u{06e8}\u{06ea}-\u{06ed}]"
].join("|"), "gu");
/** Letters with a stroke, a bar or a middle dot, which Unicode does not decompose. */
const PLAIN_LETTERS = new Map([
    [ "Ⱥ", "A" ], [ "ⱥ", "a" ], [ "Ƀ", "B" ], [ "ƀ", "b" ], [ "Ȼ", "C" ], [ "ȼ", "c" ],
    [ "Đ", "D" ], [ "đ", "d" ], [ "Ɇ", "E" ], [ "ɇ", "e" ], [ "Ǥ", "G" ], [ "ǥ", "g" ],
    [ "Ħ", "H" ], [ "ħ", "h" ], [ "Ɨ", "I" ], [ "ɨ", "i" ], [ "Ɉ", "J" ], [ "ɉ", "j" ],
    [ "Ŀ", "L" ], [ "ŀ", "l" ], [ "Ł", "L" ], [ "ł", "l" ], [ "Ø", "O" ], [ "ø", "o" ],
    [ "Ɍ", "R" ], [ "ɍ", "r" ], [ "Ŧ", "T" ], [ "ŧ", "t" ], [ "Ʉ", "U" ], [ "ʉ", "u" ],
    [ "Ɏ", "Y" ], [ "ɏ", "y" ], [ "Ƶ", "Z" ], [ "ƶ", "z" ]
]);

function shuffle(lines: readonly string[], random: () => number) {
    const result = [ ...lines ];
    // Fisher-Yates.
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [ result[i], result[j] ] = [ result[j], result[i] ];
    }
    return result;
}

/**
 * Lowercases the words of `text` and capitalizes those that `isCapital` picks. The words are found
 * in the whole line, so a word or a sentence that starts before `text` is not capitalized again.
 */
function changeWordCase(
    text: string,
    locale: string,
    { before = "", after = "" }: TextTransformOptions,
    isCapital: (word: Word, next: Word | undefined) => boolean
) {
    const line = before + text + after;
    const start = before.length;
    const end = start + text.length;
    const words = findWords(line);

    let result = "";
    let position = start;
    for (const [ index, word ] of words.entries()) {
        if (word.end <= start) continue;
        if (word.start >= end) break;

        const from = Math.max(word.start, start);
        const to = Math.min(word.end, end);
        const part = toLowerCase(line, from, to, locale);
        const isCapitalized = from === word.start && isCapital(word, words[index + 1]);
        result += line.slice(position, from) + (isCapitalized ? capitalize(part, locale) : part);
        position = to;
    }
    return result + line.slice(position, end);
}

function findWords(line: string): Word[] {
    const words: Word[] = [];
    let previousEnd = 0;
    for (const match of line.matchAll(WORD)) {
        const [ text ] = match;
        const start = match.index;
        words.push({
            start,
            end: start + text.length,
            text,
            isSentenceStart: !words.length || SENTENCE_BREAK.test(line.slice(previousEnd, start))
        });
        previousEnd = start + text.length;
    }
    return words;
}

/**
 * Lowercases the text of `line` from `from` to `to`. A capital sigma takes its form from the whole
 * line, so it becomes "ς" only at the end of a word.
 */
function toLowerCase(line: string, from: number, to: number, locale: string) {
    return line.slice(from, to)
        .replace(/Σ/g, (_, offset: number) => isFinalSigma(line, from + offset) ? "ς" : "σ")
        .toLocaleLowerCase(locale);
}

function isFinalSigma(line: string, index: number) {
    FINAL_SIGMA.lastIndex = index;
    return FINAL_SIGMA.test(line);
}

/** Gives the lowercase `word` a capital first letter. */
function capitalize(word: string, locale: string) {
    // Dutch writes the digraph "ij" as one letter: "IJsselmeer".
    if (languageOf(locale) === "nl" && word.startsWith("ij")) {
        return `IJ${word.slice(2)}`;
    }

    const [ first ] = word;
    return toCapitalLetter(first, locale) + word.slice(first.length);
}

function toCapitalLetter(letter: string, locale: string) {
    const titleCase = TITLE_CASE_LETTERS.get(letter);
    if (titleCase) {
        return titleCase;
    }
    if (GEORGIAN.test(letter)) {
        return letter;
    }

    // Greek drops the accents only in text written in all caps.
    const upper = languageOf(locale) === "el"
        ? letter.toUpperCase()
        : letter.toLocaleUpperCase(locale);
    // A letter such as "ß" uppercases to two, "SS", and only the first one is a capital.
    const [ first ] = upper;
    return first + upper.slice(first.length).toLocaleLowerCase(locale);
}

function languageOf(locale: string) {
    return locale.split("-")[0];
}

/**
 * Removes the diacritics from the letters of `text`. A letter without a diacritic is not
 * normalized, because normalization also changes letters such as the Ohm sign.
 */
function removeDiacritics(text: string) {
    return text.replace(LETTER, (original) => {
        const decomposed = original.normalize("NFD");
        const stripped = decomposed.replace(DIACRITIC, "");
        const letter = stripped === decomposed ? original : stripped.normalize("NFC");
        return PLAIN_LETTERS.get(letter) ?? letter;
    });
}
