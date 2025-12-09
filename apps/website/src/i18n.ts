import i18next from "i18next";
import { initReactI18next } from "react-i18next";

interface Locale {
    id: string;
    name: string;
    rtl?: boolean;
}

i18next.use(initReactI18next);
const localeFiles = import.meta.glob("./translations/*/translation.json", { eager: true });
const resources: Record<string, Record<string, Record<string, string>>> = {};
for (const [path, module] of Object.entries(localeFiles)) {
    const id = path.split("/").at(-2);
    if (!id) continue;

    const translations = (module as any).default ?? module;
    resources[id] = { translation: translations };
}

export function initTranslations(lng: string) {
    i18next.init({
        fallbackLng: "en",
        lng,
        returnEmptyString: false,
        resources,
        initAsync: false,
        react: {
            useSuspense: false
        }
    });
}

export const LOCALES: Locale[] = [
    { id: "en", name: "English" },
    { id: "ro", name: "Română" },
    { id: "zh-Hans", name: "简体中文" },
    { id: "zh-Hant", name: "繁體中文" },
    { id: "fr", name: "Français" },
    { id: "it", name: "Italiano" },
    { id: "ja", name: "日本語" },
    { id: "pl", name: "Polski" },
    { id: "es", name: "Español" },
    { id: "ar", name: "اَلْعَرَبِيَّةُ", rtl: true },
].toSorted((a, b) => a.name.localeCompare(b.name));

export function mapLocale(locale: string) {
    if (!locale) return 'en';
    const lower = locale.toLowerCase();

    if (lower.startsWith('zh')) {
        if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo') || lower.includes('hant')) {
            return 'zh-Hant';
        }
        return 'zh-Hans';
    }

    // Default for everything else
    return locale.split('-')[0]; // e.g. "en-US" -> "en"
}

export function swapLocaleInUrl(url: string, newLocale: string) {
    const components = url.split("/");
    if (components.length === 2) {
        const potentialLocale = components[1];
        const correspondingLocale = LOCALES.find(l => l.id === potentialLocale);
        if (correspondingLocale) {
            return `/${newLocale}`;
        } else {
            return `/${newLocale}${url}`;
        }
    } else {
        components[1] = newLocale;
        return components.join("/");
    }
}

export function extractLocaleFromUrl(url: string) {
    const localeId = url.split('/')[1];
    const correspondingLocale = LOCALES.find(l => l.id === localeId);
    if (!correspondingLocale) return undefined;
    return localeId;
}
