import { Language } from "@excalidraw/excalidraw/i18n";
import type { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";

export const LANGUAGE_MAPPINGS: Record<DISPLAYABLE_LOCALE_IDS, Language["code"] | null> = {
    ar: "ar-SA",
    cn: "zh-CN",
    de: "de-DE",
    en: "en",
    "en-GB": "en",
    en_rtl: "en",
    es: "es-ES",
    fr: "fr-FR",
    it: "it-IT",
    ja: "ja-JP",
    pt: "pt-PT",
    pl: "pl-PL",
    pt_br: "pt-BR",
    ro: "ro-RO",
    ru: "ru-RU",
    tw: "zh-TW",
    uk: "uk-UA"
};
