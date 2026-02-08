import { LOCALE_IDS, setDayjsLocale } from "@triliumnext/commons";
import type i18next from "i18next";
import { join } from "path";

import { getResourceDir } from "./utils";

export async function initializeTranslations(i18nextInstance: typeof i18next, locale: LOCALE_IDS) {
    const resourceDir = getResourceDir();
    const Backend = (await import("i18next-fs-backend/cjs")).default;

    // Initialize translations
    await i18nextInstance.use(Backend).init({
        lng: locale,
        fallbackLng: "en",
        ns: "server",
        backend: {
            loadPath: join(resourceDir, "assets/translations/{{lng}}/{{ns}}.json")
        }
    });

    // Initialize dayjs locale.
    await setDayjsLocale(locale);
}
