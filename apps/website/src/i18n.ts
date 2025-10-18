import { default as i18next } from "i18next";
import HttpApi from 'i18next-http-backend';
import { initReactI18next } from "react-i18next";

i18next
    .use(HttpApi)
    .use(initReactI18next);

await i18next.init({
    debug: true,
    lng: "en",
    fallbackLng: "en",
    backend: {
        loadPath: "/translations/{{lng}}/{{ns}}.json",
    },
    returnEmptyString: false
});

export const t = i18next.t;
