import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { Bold, ButtonView, Essentials, Paragraph, SplitButtonView } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../test/editor-kit.js";
import getCkLocale, { registerCkTranslations } from "./i18n.js";
import { MESSAGE_KEY_PREFIX } from "./messages.js";
import Admonition from "./plugins/admonition/admonition.js";
import AdmonitionUI from "./plugins/admonition/admonition_ui.js";

/** The `text-editor.ck` section of the English catalog, as the client reads it back at runtime. */
const ENGLISH_MESSAGES: Record<string, string> = {
    admonition: "Admonition",
    caution: "Caution",
    important: "Important",
    note: "Note",
    tip: "Tip",
    warning: "Warning"
};

/**
 * Messages resolving only the admonition button, with every other key echoed back the way i18next
 * does for a missing entry — so the assertions below pin one dictionary entry rather than tracking
 * the whole catalog.
 */
function admonitionOnly(translation: string) {
    return {
        englishMessages: ENGLISH_MESSAGES,
        translate: (key: string) => (key === "text-editor.ck.admonition" ? translation : key)
    };
}

interface AdmonitionDropdown {
    isOpen: boolean;
    buttonView: SplitButtonView;
    panelView: {
        children: {
            get(index: number): {
                items: { length: number; get(index: number): { children: { get(index: number): { label?: string } } } };
            } | null;
        };
    };
}

/**
 * Open the dropdown — `addListToDropdown` only populates the panel on first open — and read the
 * label of every admonition type entry.
 */
function readTypeLabels(dropdown: AdmonitionDropdown): string[] {
    dropdown.isOpen = true;
    const listView = dropdown.panelView.children.get(0);
    if (!listView) throw new Error("expected the type list to be populated");

    const labels: string[] = [];
    for (let index = 0; index < listView.items.length; index++) {
        labels.push(listView.items.get(index).children.get(0).label ?? "");
    }
    return labels;
}

describe("getCkLocale", () => {
    // "en" needs no translation at all, while "en_rtl" (a dev-only pseudo-locale) and "ga" have no
    // CKEditor translation to load — all three fall back to the editor's built-in English strings.
    it.each<DISPLAYABLE_LOCALE_IDS>([ "en", "en_rtl", "ga" ])("returns an empty config for '%s'", async (locale) => {
        expect(await getCkLocale(locale)).toEqual({});
    });

    // Without a host translator (a test, or a standalone editor) nothing is configured beyond
    // CKEditor's own translations: plugins fall back to the English message ids they pass to `t()`.
    it("adds no dictionary when no translator is given", async () => {
        const { translations } = await getCkLocale("de");

        // The merge seed plus CKEditor's own translations, and nothing of ours.
        expect(translations).toHaveLength(2);
    });

    it("appends the Trilium dictionary after the core translations", async () => {
        const { language, translations } = await getCkLocale("de", admonitionOnly("Ermahnung"));

        expect(language).toBe("de");
        if (!Array.isArray(translations)) throw new Error("expected an array of translations");
        // Seed, core translations, ours — ours last, so it wins for any message id both define.
        expect(translations).toHaveLength(3);
        expect(translations[0]).toEqual({});
        const dictionary = (translations[2] as Record<string, { dictionary: Record<string, string> }>).de.dictionary;
        expect(dictionary.Admonition).toBe("Ermahnung");
    });

    // CKEditor merges the `translations` array in place via `reduce(merge)`, so a missing seed
    // would write our dictionary into the shared `ckeditor5/translations/<lang>.js` module object
    // and leak it into every other editor on the page.
    it("does not mutate the imported core translations", async () => {
        const before = await getCkLocale("de");
        if (!Array.isArray(before.translations)) throw new Error("expected an array of translations");
        const coreEntry = before.translations[1] as Record<string, { dictionary: Record<string, string> }>;

        await getCkLocale("de", admonitionOnly("Ermahnung"));

        expect(coreEntry.de.dictionary).not.toHaveProperty("Admonition");
    });

    // A locale with no CKEditor translation still needs the dictionary, since it also carries the
    // renames of the editor's built-in English strings.
    it("supplies a dictionary keyed 'en' for locales with no core translation", async () => {
        const { language, translations } = await getCkLocale("ga", admonitionOnly("Rabhadh"));

        expect(language).toBeUndefined();
        if (!Array.isArray(translations)) throw new Error("expected an array of translations");
        expect(translations).toHaveLength(2);
        expect((translations[1] as Record<string, { dictionary: Record<string, string> }>).en.dictionary.Admonition)
            .toBe("Rabhadh");
    });

    // Even with nothing to translate, the dictionary still carries the renames of CKEditor's own
    // strings — dropping it would put "Bookmark" back in front of the user.
    it("supplies the renames when the translator resolves nothing", async () => {
        const { translations } = await getCkLocale("ga", { englishMessages: ENGLISH_MESSAGES, translate: (key) => key });

        if (!Array.isArray(translations)) throw new Error("expected an array of translations");
        const dictionary = (translations[1] as Record<string, { dictionary: Record<string, string> }>).en.dictionary;
        expect(dictionary.Bookmark).toBe("Anchor");
        expect(dictionary).not.toHaveProperty("Admonition");
    });

    // End-to-end over a real editor: `AdmonitionUI` localizes with plain `editor.t("Admonition")`,
    // knowing nothing about translation keys or the host, and the only thing that makes it Romanian
    // is the dictionary configured here.
    describe("applied to an editor", () => {
        const RO_MESSAGES: Record<string, string> = {
            admonition: "Casetă de avertizare",
            caution: "Atenție",
            important: "Important",
            note: "Notă",
            tip: "Sfat",
            warning: "Avertisment"
        };
        const translateToRomanian = (key: string) => RO_MESSAGES[key.replace(MESSAGE_KEY_PREFIX, "")] ?? key;

        async function createAdmonitionDropdown(localeConfig: Awaited<ReturnType<typeof getCkLocale>>) {
            const editor = await createTestEditor([ Essentials, Paragraph, Admonition, AdmonitionUI ], localeConfig);
            return editor.ui.componentFactory.create("admonition") as unknown as AdmonitionDropdown;
        }

        it("translates the button and every type entry through the host translator", async () => {
            const dropdown = await createAdmonitionDropdown(await getCkLocale("ro", { englishMessages: ENGLISH_MESSAGES, translate: translateToRomanian }));

            expect(dropdown.buttonView.label).toBe("Casetă de avertizare");
            expect(readTypeLabels(dropdown)).toEqual([ "Notă", "Sfat", "Important", "Atenție", "Avertisment" ]);
        });

        // What makes the mechanism seamless: with no host attached the editor still renders correct
        // English, because the message id passed to `t()` *is* the English text. Same for a
        // configured translator that cannot resolve the key.
        it.each([
            [ "no translator is configured", undefined ],
            [ "the translation is missing", (key: string) => key ]
        ])("falls back to the English message ids when %s", async (_case, translate) => {
            const dropdown = await createAdmonitionDropdown(await getCkLocale("ro", translate && { englishMessages: ENGLISH_MESSAGES, translate }));

            expect(dropdown.buttonView.label).toBe("Admonition");
            expect(readTypeLabels(dropdown)).toEqual([ "Note", "Tip", "Important", "Caution", "Warning" ]);
        });

        /*
         * A catalog does not always arrive under the name we ask CKEditor to answer to: `zh-cn.js`
         * carries `zh-cn` where we say `zh`, `zh.js` carries `zh` where we say `zh-tw`, and
         * `en-gb.js` carries `en-gb` where we say `en-GB`.
         *
         * Filed as it arrives, such a catalog is one CKEditor never looks in — but only once a
         * dictionary of ours is filed beside it. Alone, it is the single entry in `translations`,
         * and CKEditor answers from the only language it was given whatever language was asked for;
         * a second entry ends that, and the lookup goes to the name we asked for and finds our
         * strings alone there. So it is exactly the configuration the text editor is built from —
         * the one that carries a translator — that loses CKEditor's own strings, and only for the
         * locales whose two names part ways.
         */
        it.each([
            [ "cn", "加粗", "Aldin" ],
            [ "tw", "粗體", "Aldin" ]
        ])("translates CKEditor's own strings for '%s', beside a dictionary of ours", async (locale, bold, ourString) => {
            const localeConfig = await getCkLocale(locale as DISPLAYABLE_LOCALE_IDS, {
                englishMessages: ENGLISH_MESSAGES,
                translate: () => ourString
            });
            const editor = await createTestEditor([ Essentials, Paragraph, Bold, Admonition, AdmonitionUI ], localeConfig);

            const boldButton = editor.ui.componentFactory.create("bold");
            if (!(boldButton instanceof ButtonView)) throw new Error("expected the bold component to be a button");
            expect(boldButton.label).toBe(bold);

            // And ours are still read, the two dictionaries answering to the one name between them.
            const dropdown = editor.ui.componentFactory.create("admonition") as unknown as AdmonitionDropdown;
            expect(dropdown.buttonView.label).toBe(ourString);
        });
    });

    // The CKEditor language code often differs from Trilium's locale id, so pin the mapping for
    // every locale rather than only the ones that happen to match.
    it.each<[DISPLAYABLE_LOCALE_IDS, string]>([
        [ "en-GB", "en-GB" ],
        [ "ar", "ar" ],
        [ "cn", "zh" ],
        [ "cs", "cs" ],
        [ "de", "de" ],
        [ "es", "es" ],
        [ "fr", "fr" ],
        [ "id", "id" ],
        [ "it", "it" ],
        [ "hi", "hi" ],
        [ "ja", "ja" ],
        [ "ko", "ko" ],
        [ "pl", "pl" ],
        [ "pt", "pt" ],
        [ "pt_br", "pt-br" ],
        [ "ro", "ro" ],
        [ "tw", "zh-tw" ],
        [ "uk", "uk" ],
        [ "ru", "ru" ]
    ])("maps '%s' to CKEditor language '%s' and loads its translation", async (locale, languageCode) => {
        const result = await getCkLocale(locale);

        expect(result.language).toBe(languageCode);
        // The merge seed and the GPL core translations. The premium bundle used to add another
        // entry, but no premium plugin is loaded any more; this call passes no translator, so the
        // Trilium dictionary is absent too.
        const translations = result.translations;
        if (!Array.isArray(translations)) throw new Error("expected an array of translations");
        expect(translations).toHaveLength(2);
        expect(typeof translations[1]).toBe("object");
    });
});

describe("registerCkTranslations", () => {
    /** What an editor carrying no dictionary of its own reads from (see the function's own note). */
    function globalDictionary(languageCode: string) {
        return window.CKEDITOR_TRANSLATIONS?.[languageCode]?.dictionary;
    }

    it("lays a locale's dictionary where an editor built without one will read it", async () => {
        expect(await registerCkTranslations("de")).toEqual({ language: "de" });

        // The strings the small fields show are CKEditor's own, and this is them arriving.
        expect(globalDictionary("de")?.["Bold"]).toBe("Fett");
        expect(globalDictionary("de")?.["Insert code block"]).toBe("Code-Block einfügen");
    });

    it("files a dictionary under the name the editor will ask for, not the one it arrived under", async () => {
        // Both spellings part ways: what we ask CKEditor to speak is `zh`, while the catalog is
        // `zh-cn.js` and carries `zh-cn`. Filed as it arrived, it would be a dictionary unread.
        expect(await registerCkTranslations("cn")).toEqual({ language: "zh" });
        expect(globalDictionary("zh")?.["Bold"]).toBeTruthy();
    });

    it("says nothing of a locale CKEditor has no catalog for, which is the English it was written in", async () => {
        for (const locale of [ "en", "en_rtl", "ga" ] as DISPLAYABLE_LOCALE_IDS[]) {
            expect(await registerCkTranslations(locale)).toEqual({});
        }
    });

    it("is read by an editor that carries no dictionary of its own, which is the whole point", async () => {
        // What the small fields are: raised from a configuration settled as they mount, with no
        // `translations` in it. CKEditor falls back to the global registry for exactly those, so a
        // button built afterwards wears the language without the field ever having carried it.
        const { language } = await registerCkTranslations("de");
        const editor = await createTestEditor([ Essentials, Paragraph, Bold ], { language });

        const boldButton = editor.ui.componentFactory.create("bold");
        if (!(boldButton instanceof ButtonView)) throw new Error("expected the bold component to be a button");
        expect(boldButton.label).toBe("Fett");
    });

    it("fetches a locale once, however many fields ask for it", async () => {
        // Every field on the page asks as it is built, and a catalog is a chunk to go and get.
        expect(registerCkTranslations("fr")).toBe(registerCkTranslations("fr"));
        await registerCkTranslations("fr");
        expect(globalDictionary("fr")?.["Bold"]).toBeTruthy();
    });
});
