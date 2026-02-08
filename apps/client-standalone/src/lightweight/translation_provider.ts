import { LOCALE_IDS } from "@triliumnext/commons";
import type i18next from "i18next";
import I18NextHttpBackend from "i18next-http-backend";

export default async function translationProvider(i18nextInstance: typeof i18next, locale: LOCALE_IDS) {
    await i18nextInstance.use(I18NextHttpBackend).init({
        lng: locale,
        fallbackLng: "en",
        ns: "server",
        backend: {
            loadPath: `${import.meta.resolve("../server-assets/translations")}/{{lng}}/{{ns}}.json`
        },
        returnEmptyString: false,
        debug: true
    });
}
