import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { add, EditorConfig, Translations } from "ckeditor5";

import { buildMessageDictionary } from "./messages.js";

interface LocaleMapping {
    languageCode: string;
    coreTranslation: () => Promise<{ default: Translations }>;
}

const LOCALE_MAPPINGS: Record<DISPLAYABLE_LOCALE_IDS, LocaleMapping | null> = {
    en: null,
    en_rtl: null,
    "en-GB": {
        languageCode: "en-GB",
        coreTranslation: () => import("ckeditor5/translations/en-gb.js"),
    },
    ar: {
        languageCode: "ar",
        coreTranslation: () => import("ckeditor5/translations/ar.js"),
    },
    cn: {
        languageCode: "zh",
        coreTranslation: () => import("ckeditor5/translations/zh-cn.js"),
    },
    cs: {
        languageCode: "cs",
        coreTranslation: () => import("ckeditor5/translations/cs.js"),
    },
    de: {
        languageCode: "de",
        coreTranslation: () => import("ckeditor5/translations/de.js"),
    },
    es: {
        languageCode: "es",
        coreTranslation: () => import("ckeditor5/translations/es.js"),
    },
    fr: {
        languageCode: "fr",
        coreTranslation: () => import("ckeditor5/translations/fr.js"),
    },
    ga: null,
    id: {
        languageCode: "id",
        coreTranslation: () => import("ckeditor5/translations/id.js"),
    },
    it: {
        languageCode: "it",
        coreTranslation: () => import("ckeditor5/translations/it.js"),
    },
    hi: {
        languageCode: "hi",
        coreTranslation: () => import("ckeditor5/translations/hi.js"),
    },
    ja: {
        languageCode: "ja",
        coreTranslation: () => import("ckeditor5/translations/ja.js"),
    },
    ko: {
        languageCode: "ko",
        coreTranslation: () => import("ckeditor5/translations/ko.js"),
    },
    pl: {
        languageCode: "pl",
        coreTranslation: () => import("ckeditor5/translations/pl.js"),
    },
    pt: {
        languageCode: "pt",
        coreTranslation: () => import("ckeditor5/translations/pt.js"),
    },
    pt_br: {
        languageCode: "pt-br",
        coreTranslation: () => import("ckeditor5/translations/pt-br.js"),
    },
    ro: {
        languageCode: "ro",
        coreTranslation: () => import("ckeditor5/translations/ro.js"),
    },
    tw: {
        languageCode: "zh-tw",
        coreTranslation: () => import("ckeditor5/translations/zh.js"),
    },
    uk: {
        languageCode: "uk",
        coreTranslation: () => import("ckeditor5/translations/uk.js"),
    },
    ru: {
        languageCode: "ru",
        coreTranslation: () => import("ckeditor5/translations/ru.js"),
    },
};

/**
 * Build the editor's language configuration: CKEditor's own translations for the locale, plus the
 * dictionary of Trilium-authored strings (see `messages.ts`).
 *
 * The two are separate entries in the `translations` array, and CKEditor merges them in order, so
 * ours wins where both define a message id — which is how an upstream string can be reworded per
 * locale.
 *
 * @param locale the Trilium locale to configure the editor for.
 * @param messages the host's English message catalog (the `text-editor.ck` section) paired with its
 *                 translator. Omit it — a test, a standalone editor — and every Trilium string
 *                 falls back to the English message id passed to `editor.t()`.
 */
export default async function getCkLocale(
    locale: DISPLAYABLE_LOCALE_IDS,
    messages?: { englishMessages: Record<string, string>; translate: (key: string) => string }
): Promise<Pick<EditorConfig, "language" | "translations">> {
    const mapping = LOCALE_MAPPINGS[locale];
    const translations: Translations[] = [];

    // `en`, the `en_rtl` pseudo-locale and `ga` have no CKEditor translation to load; they still get
    // our dictionary, since it also carries any rewording of CKEditor's built-in English strings.
    if (mapping) {
        // Filed under the code the editor will be answering to rather than the one the catalog
        // arrives under. The two part ways for three locales — `zh-cn.js` carries `zh-cn` where we
        // say `zh`, `zh.js` carries `zh` where we say `zh-tw`, `en-gb.js` carries `en-gb` where we
        // say `en-GB` — and filed as it arrives, such a catalog is one CKEditor never looks in.
        //
        // It went unseen for as long as it did because a lone catalog is rescued: CKEditor answers
        // from the only language it was given whatever language was asked for. The dictionary below
        // is a second, which ends the rescue and sends the lookup to the name we asked for, where
        // our strings sit alone. So it fails only where a translator is attached — which is every
        // text editor, and no test.
        const [ catalog ] = Object.values((await mapping.coreTranslation()).default);
        translations.push({ [mapping.languageCode]: catalog });
    }

    if (messages) {
        // Always configured once a host is attached, even for a catalog that resolves nothing: the
        // dictionary still carries the renames of CKEditor's own strings, which apply regardless.
        // Keyed by the language CKEditor will resolve messages under, which is the editor's default
        // (`en`) whenever we pass no `language` below.
        const dictionary = buildMessageDictionary(messages.englishMessages, messages.translate);
        translations.push({ [mapping?.languageCode ?? "en"]: { dictionary } });
    }

    return {
        ...(mapping ? { language: mapping.languageCode } : {}),
        // The empty leading entry is load-bearing. CKEditor merges `translations` with
        // `array.reduce(merge)` and no initial value, so the *first* entry is mutated in place —
        // without the seed our dictionary would be written into the imported
        // `ckeditor5/translations/<lang>.js` module object, which is shared by every editor on the
        // page and would keep applying to editors built with no dictionary at all.
        ...(translations.length > 0 ? { translations: [ {}, ...translations ] } : {})
    };
}

/**
 * Puts the locale's CKEditor dictionary where an editor carrying none of its own will find it, and
 * hands back the language such an editor is then to be told to speak.
 *
 * The small fields — a mind map node's memo, the chat box — are raised from a configuration settled
 * as they mount, which cannot wait on a dictionary that has to be fetched. CKEditor resolves a
 * message against `window.CKEDITOR_TRANSLATIONS` whenever an editor was given no `translations` of
 * its own, so the catalog is laid there once, ahead of them, and each of those fields speaks the
 * language without having to carry it.
 *
 * A locale is fetched once however many fields ask for it: what the first asked for is what the
 * rest are handed. The full text editor is untouched by any of this — it hands its own
 * `translations` over (see {@link getCkLocale}), and what an editor carries is what it reads from.
 */
export function registerCkTranslations(locale: DISPLAYABLE_LOCALE_IDS) {
    let registration = registeredTranslations.get(locale);

    if (!registration) {
        registration = putTranslationsWithinReach(locale);
        registeredTranslations.set(locale, registration);
    }

    return registration;
}

/** The locales already laid within reach, by the one that was asked for. */
const registeredTranslations = new Map<DISPLAYABLE_LOCALE_IDS, Promise<Pick<EditorConfig, "language">>>();

async function putTranslationsWithinReach(locale: DISPLAYABLE_LOCALE_IDS): Promise<Pick<EditorConfig, "language">> {
    const mapping = LOCALE_MAPPINGS[locale];

    // `en`, the `en_rtl` pseudo-locale and `ga` have no CKEditor translation to load, and no
    // language to name either: an editor told none of its own speaks the English it was written in.
    if (!mapping) return {};

    // Filed under the code the editor will be answering to rather than the one the catalog arrives
    // under: a locale is not always spelled the same on both sides (`zh-cn.js` carries what we ask
    // for as `zh`), and a dictionary filed under a name nothing asks for is a dictionary unread.
    const catalog = (await mapping.coreTranslation()).default;
    const [ arrived ] = Object.values(catalog);
    // A catalog may answer which plural form to take with a boolean where two forms are all there
    // are, which is the same answer CKEditor reads through `Number()` when it takes one itself.
    const pluralForm = arrived.getPluralForm;
    add(mapping.languageCode, arrived.dictionary, pluralForm ? (count) => Number(pluralForm(count)) : undefined);

    return { language: mapping.languageCode };
}
