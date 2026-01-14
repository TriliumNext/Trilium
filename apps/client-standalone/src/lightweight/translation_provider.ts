import { LOCALE_IDS } from "@triliumnext/commons";
import i18next from "i18next";
import I18NextHttpBackend from "i18next-http-backend";

export default async function translationProvider(locale: LOCALE_IDS) {
    await i18next.use(I18NextHttpBackend).init({
        lng: locale,
        fallbackLng: "en",
        ns: "server",
        backend: {
            loadPath: "server-assets/translations/{{lng}}/{{ns}}.json"
        },
        returnEmptyString: false,
        debug: true
    });
}
