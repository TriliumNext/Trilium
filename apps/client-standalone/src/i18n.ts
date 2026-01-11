import i18next from "i18next";
import I18NextHttpBackend from "i18next-http-backend";

export default async function initTranslations() {
    // TODO: Use proper locale.
    const locale = "en";

    // Initialize translations.
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
