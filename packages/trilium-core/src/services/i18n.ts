import { LOCALES } from "@triliumnext/commons";

// TODO: Real impl.
export function changeLanguage(languageCode: string) {
        console.log("Got request to change language", languageCode);
}

export function getLocales() {
        return LOCALES;
}
