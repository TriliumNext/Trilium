import { describe, expect, it } from "vitest";

import {
    type LineOperation, type TextTransformOptions, transformLines, transformText
} from "./text_transforms.js";

function lines(operation: LineOperation, input: string[], locale = "en") {
    return transformLines(input, operation, { locale });
}

function sentenceCase(text: string, locale = "en", context: TextTransformOptions = {}) {
    return transformText(text, "sentenceCase", { locale, ...context });
}

function titleCase(text: string, locale = "en", context: TextTransformOptions = {}) {
    return transformText(text, "titleCase", { locale, ...context });
}

function removeDiacritics(text: string) {
    return transformText(text, "removeDiacritics");
}

describe("transformLines", () => {
    it("sorts with auto-sort: by value, ignoring case and indentation, blank lines last", () => {
        const input = [ "item 10", "", "  Banana", "item 9", "apple", "1.5", "10" ];
        expect(lines("sortAscending", input))
            .toEqual([ "1.5", "10", "apple", "  Banana", "item 9", "item 10", "" ]);
        expect(lines("sortDescending", input))
            .toEqual([ "item 10", "item 9", "  Banana", "apple", "10", "1.5", "" ]);
        expect(lines("sortAscending", [ "2026-09-30", "15:02", "3" ]))
            .toEqual([ "15:02", "2026-09-30", "3" ]);
    });

    it("sorts by the collation and the number format of the locale", () => {
        expect(lines("sortAscending", [ "ä", "z", "a" ], "de")).toEqual([ "a", "ä", "z" ]);
        expect(lines("sortAscending", [ "ä", "z", "a" ], "sv")).toEqual([ "a", "z", "ä" ]);
        expect(lines("sortAscending", [ "1.250", "1.3" ], "en")).toEqual([ "1.250", "1.3" ]);
        expect(lines("sortAscending", [ "1.250", "1.3" ], "de")).toEqual([ "1.3", "1.250" ]);
        expect(transformLines([ "01.10.26", "30.09.26" ], "sortAscending", {
            locale: "en",
            dateFormats: [ "DD.MM.YY" ]
        })).toEqual([ "30.09.26", "01.10.26" ]);
    });

    it("shuffles with the given random source, leaving the input alone", () => {
        const input = [ "a", "b", "c", "d" ];
        expect(transformLines(input, "shuffle", { random: () => 0 }))
            .toEqual([ "b", "c", "d", "a" ]);
        expect(input).toEqual([ "a", "b", "c", "d" ]);
        expect(transformLines(input, "shuffle").toSorted()).toEqual(input);
    });

    it("reverses and deduplicates, keeping the first copy of each line", () => {
        expect(lines("reverse", [ "a", "b", "c" ])).toEqual([ "c", "b", "a" ]);
        expect(lines("deduplicate", [ "b", "a", "b", "a ", "", "a", "" ]))
            .toEqual([ "b", "a", "a ", "" ]);
    });

    it("trims and removes blank lines by any Unicode whitespace", () => {
        const input = [ "\u{a0}\u{3000}x\t", " y ", "", " \t\u{3000}" ];
        expect(lines("trimLeading", input)).toEqual([ "x\t", "y ", "", "" ]);
        expect(lines("trimTrailing", input)).toEqual([ "\u{a0}\u{3000}x", " y", "", "" ]);
        expect(lines("trimBoth", input)).toEqual([ "x", "y", "", "" ]);
        expect(lines("removeBlankLines", input)).toEqual([ "\u{a0}\u{3000}x\t", " y " ]);
        expect(lines("removeBlankLines", [ "", " " ])).toEqual([]);
    });
});

describe("transformText", () => {
    it("changes the case by the rules of the locale", () => {
        expect(transformText("straße", "upperCase", { locale: "de" })).toBe("STRASSE");
        expect(transformText("istanbul", "upperCase", { locale: "tr" })).toBe("İSTANBUL");
        expect(transformText("IRMAK", "lowerCase", { locale: "tr" })).toBe("ırmak");
        expect(transformText("IRMAK", "lowerCase", { locale: "en" })).toBe("irmak");
        expect(transformText("άλφα", "upperCase", { locale: "el" })).toBe("ΑΛΦΑ");
        expect(transformText("ΟΔΟΣ ΚΑΙ ΟΣ", "lowerCase", { locale: "el" })).toBe("οδος και ος");
        expect(transformText("abc", "upperCase")).toBe("ABC");
        expect(transformText("abc", "upperCase", { locale: "en_rtl" })).toBe("ABC");
    });

    it("starts each sentence and each line with a capital in sentence case", () => {
        expect(sentenceCase("THE HOBBIT. AND MORE")).toBe("The hobbit. And more");
        expect(sentenceCase("hello world! is it? yes.")).toBe("Hello world! Is it? Yes.");
        expect(sentenceCase("first LINE\nSECOND line\n\n  third"))
            .toBe("First line\nSecond line\n\n  Third");
        expect(sentenceCase("he said \"STOP.\" then LEFT")).toBe("He said \"stop.\" Then left");
        expect(sentenceCase("- BUY MILK (OR TEA.) next")).toBe("- Buy milk (or tea.) Next");
    });

    it("leaves a sentence that starts with a number without a capital", () => {
        expect(sentenceCase("3 APPLES. 2 PEARS")).toBe("3 apples. 2 pears");
        expect(sentenceCase("PI IS 3.14 OR SO")).toBe("Pi is 3.14 or so");
    });

    it("finds sentences in other scripts", () => {
        expect(sentenceCase("¿QUÉ PASA? NADA.", "es")).toBe("¿Qué pasa? Nada.");
        expect(sentenceCase("ԲԱՐԵՒ։ ԻՆՉՊԵՍ ԵՍ", "hy")).toBe("Բարեւ։ Ինչպես ես");
        expect(sentenceCase("Η ΟΔΟΣ ΕΙΝΑΙ ΕΔΩ. ΝΑΙ", "el")).toBe("Η οδος ειναι εδω. Ναι");
        expect(sentenceCase("İSTANBUL IŞIK", "tr")).toBe("İstanbul ışık");
        expect(sentenceCase("ПРИВЕТ, МИР. КАК ДЕЛА", "ru")).toBe("Привет, мир. Как дела");
    });

    it("reads the rest of the line to tell where a sentence or a word starts", () => {
        expect(sentenceCase("FOO bar", "en", { before: "Hello world. " })).toBe("Foo bar");
        expect(sentenceCase("WORLD", "en", { before: "Hello " })).toBe("world");
        expect(sentenceCase("LO WORLD", "en", { before: "hel" })).toBe("lo world");
        expect(sentenceCase("  TODO", "en", { before: "  - " })).toBe("  Todo");
    });

    it("capitalizes every word but the minor ones in title case", () => {
        expect(titleCase("the lord of the rings")).toBe("The Lord of the Rings");
        expect(titleCase("THE HOBBIT")).toBe("The Hobbit");
        expect(titleCase("of mice and men")).toBe("Of Mice and Men");
        expect(titleCase("what are you looking for")).toBe("What Are You Looking For");
        expect(titleCase("don't stop me now")).toBe("Don't Stop Me Now");
        expect(titleCase("a well-known fact")).toBe("A Well-Known Fact");
        expect(titleCase("the first. the second\nthe third"))
            .toBe("The First. The Second\nThe Third");
        expect(titleCase("1st place")).toBe("1st Place");
        expect(titleCase("e\u{301}cole")).toBe("E\u{301}cole");
    });

    it("uses the minor words of the language, and none for a language without a list", () => {
        expect(titleCase("el señor de los anillos", "es")).toBe("El Señor de los Anillos");
        expect(titleCase("le seigneur des anneaux", "fr")).toBe("Le Seigneur des Anneaux");
        expect(titleCase("în căutarea timpului pierdut", "ro"))
            .toBe("În Căutarea Timpului Pierdut");
        expect(titleCase("sagan om ringen", "sv")).toBe("Sagan Om Ringen");
        expect(titleCase("istanbul ve izmir", "tr")).toBe("İstanbul Ve İzmir");
    });

    it("writes the capitals that differ from the uppercase letter", () => {
        expect(titleCase("ijsselmeer en ijmuiden", "nl")).toBe("IJsselmeer en IJmuiden");
        expect(titleCase("ijs", "en")).toBe("Ijs");
        expect(titleCase("ǆep ǉubav ǌiva ǳ", "hr")).toBe("ǅep ǈubav ǋiva ǲ");
        expect(titleCase("საქართველო", "ka")).toBe("საქართველო");
        expect(transformText("საქართველო", "upperCase", { locale: "ka" })).toBe("ᲡᲐᲥᲐᲠᲗᲕᲔᲚᲝ");
        expect(titleCase("άλφα ΟΣ", "el")).toBe("Άλφα Ος");
        expect(titleCase("\u{fb01}sh", "en")).toBe("Fish");
    });

    it("reads the rest of the line to tell the first and the last word", () => {
        const line = { before: "the lord ", after: " rings" };
        expect(titleCase("OF THE", "en", line)).toBe("of the");
        expect(titleCase("rings", "en", { before: "the lord of the " })).toBe("Rings");
        expect(titleCase("lo", "en", { before: "hel" })).toBe("lo");
        expect(titleCase("the lo", "en", { after: "rd of" })).toBe("The Lo");
    });

    it("lowercases a capital sigma by the end of its word in the whole line", () => {
        expect(transformText("Σ", "lowerCase", { locale: "el", before: "Ο" })).toBe("ς");
        expect(transformText("ΟΣ", "lowerCase", { locale: "el", after: "Α" })).toBe("οσ");
        expect(sentenceCase("Σ", "el", { before: "Ο" })).toBe("ς");
        expect(titleCase("ΟΣ", "el", { after: "Α" })).toBe("Οσ");
    });

    it("removes the accents and marks of Latin, Greek and Cyrillic letters", () => {
        expect(removeDiacritics("Ștefan Țară façade Łódź Ærø")).toBe("Stefan Tara facade Lodz Æro");
        expect(removeDiacritics("Tiếng Việt, Đà Nẵng")).toBe("Tieng Viet, Da Nang");
        expect(removeDiacritics("Ħ ħ Ŧ ŧ ƀ ɨ Ǿ ŀ")).toBe("H h T t b i O l");
        expect(removeDiacritics("Καλημέρα ΆΛΦΑ")).toBe("Καλημερα ΑΛΦΑ");
        expect(removeDiacritics("ёлка, йод")).toBe("елка, иод");
        expect(removeDiacritics("cafe\u{301} na\u{308}i\u{308}ve")).toBe("cafe naive");
        // The Angstrom sign, which decomposes to A with a ring.
        expect(removeDiacritics("\u{212b}")).toBe("A");
    });

    it("removes the vowel points of Hebrew and Arabic", () => {
        expect(removeDiacritics("שָׁלוֹם")).toBe("שלום");
        expect(removeDiacritics("مَرْحَبًا")).toBe("مرحبا");
    });

    it("keeps the marks that spell letters, and characters without diacritics", () => {
        // Devanagari vowel signs, Thai, kana voicing marks, Hangul, a CJK compatibility ideograph,
        // letters that are not a base letter with a mark, an astral emoji and letter, the Ohm sign.
        const unchanged = "हिन्दी ไทย がぎ 한국어 \u{f900} ß æ œ \u{fb01} ı 😀 𝒜 \u{2126} plain";
        expect(removeDiacritics(unchanged)).toBe(unchanged);
        // Marks on symbols: decomposed and precomposed "≠", a stray mark, a keycap emoji.
        const symbols = "a =\u{338} \u{2260} \u{2209} \u{301} 1\u{fe0f}\u{20e3}";
        expect(removeDiacritics(symbols)).toBe(symbols);
    });
});
