import { useMemo } from "preact/hooks";
import { getAvailableLocales, t } from "../../../services/i18n";
import FormSelect from "../../react/FormSelect";
import OptionsRow from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import { useTriliumOption, useTriliumOptionJson } from "../../react/hooks";
import type { Locale } from "@triliumnext/commons";
import { restartDesktopApp } from "../../../services/utils";
import FormRadioGroup from "../../react/FormRadioGroup";
import FormText from "../../react/FormText";
import RawHtml from "../../react/RawHtml";
import Admonition from "../../react/Admonition";
import Button from "../../react/Button";
import CheckboxList from "./components/CheckboxList";
import { LocaleSelector } from "./components/LocaleSelector";

export default function InternationalizationOptions() {
    return (
        <>
            <LocalizationOptions />
            <ContentLanguages />
        </>
    )
}

function LocalizationOptions() {
    const { uiLocales, formattingLocales: contentLocales } = useMemo<{ uiLocales: Locale[], formattingLocales: Locale[] }>(() => {
        const allLocales = getAvailableLocales();
        return {
            uiLocales: allLocales.filter(locale => {
                if (locale.contentOnly) return false;
                if (locale.devOnly && !glob.isDev) return false;
                return true;
            }),
            formattingLocales: [
                ...allLocales.filter(locale => locale.electronLocale)
            ]
        }
    }, []);

    const [ locale, setLocale ] = useTriliumOption("locale");
    const [ formattingLocale, setFormattingLocale ] = useTriliumOption("formattingLocale");

    return (
        <OptionsSection title={t("i18n.title")}>
            <OptionsRow name="language" label={t("i18n.language")}>
                <LocaleSelector locales={uiLocales} currentValue={locale} onChange={setLocale} />
            </OptionsRow>

            {<OptionsRow name="formatting-locale" label={t("i18n.formatting-locale")}>
                <LocaleSelector locales={contentLocales} currentValue={formattingLocale} onChange={setFormattingLocale} defaultLocale={{ id: "", name: t("i18n.formatting-locale-auto") }} />
            </OptionsRow>}

            <DateSettings />
        </OptionsSection>
    )
}

function DateSettings() {
    const [ firstDayOfWeek, setFirstDayOfWeek ] = useTriliumOption("firstDayOfWeek");
    const [ firstWeekOfYear, setFirstWeekOfYear ] = useTriliumOption("firstWeekOfYear");
    const [ minDaysInFirstWeek, setMinDaysInFirstWeek ] = useTriliumOption("minDaysInFirstWeek");

    return (
        <>
            <OptionsRow name="first-day-of-week" label={t("i18n.first-day-of-the-week")}>
                <FormSelect
                    name="first-day-of-week"
                    currentValue={firstDayOfWeek}
                    onChange={setFirstDayOfWeek}
                    keyProperty="value"
                    titleProperty="label"
                    values={[
                        { value: "1", label: t("i18n.monday") },
                        { value: "2", label: t("i18n.tuesday") },
                        { value: "3", label: t("i18n.wednesday") },
                        { value: "4", label: t("i18n.thursday") },
                        { value: "5", label: t("i18n.friday") },
                        { value: "6", label: t("i18n.saturday") },
                        { value: "7", label: t("i18n.sunday") },
                    ]}
                />
            </OptionsRow>

            <OptionsRow name="first-week-of-year" label={t("i18n.first-week-of-the-year")}>
                <FormRadioGroup
                    name="first-week-of-year"
                    currentValue={firstWeekOfYear} onChange={setFirstWeekOfYear}
                    values={[
                        { value: "0", label: t("i18n.first-week-contains-first-day") },
                        { value: "1", label: t("i18n.first-week-contains-first-thursday") },
                        { value: "2", label: t("i18n.first-week-has-minimum-days") }
                    ]}
                />
            </OptionsRow>

            {firstWeekOfYear === "2" && <OptionsRow name="min-days-in-first-week" label={t("i18n.min-days-in-first-week")}>
                <FormSelect
                    keyProperty="days"
                    currentValue={minDaysInFirstWeek} onChange={setMinDaysInFirstWeek}
                    values={Array.from(
                        { length: 7 },
                        (_, i) => ({ days: String(i + 1) }))} />
            </OptionsRow>}

            <FormText>
                <RawHtml html={t("i18n.first-week-info")} />
            </FormText>

            <Admonition type="warning">
                {t("i18n.first-week-warning")}
            </Admonition>

            <OptionsRow name="restart" centered>
                <Button
                    name="restart-app-button"
                    text={t("electron_integration.restart-app-button")}
                    size="micro"
                    onClick={restartDesktopApp}
                />
            </OptionsRow>
        </>
    )
}

function ContentLanguages() {
    return (
        <OptionsSection title={t("content_language.title")}>
            <FormText>{t("content_language.description")}</FormText>

            <ContentLanguagesList />
        </OptionsSection>
    );
}

export function ContentLanguagesList() {
    const locales = useMemo(() => getAvailableLocales(), []);
    const [ languages, setLanguages ] = useTriliumOptionJson<string[]>("languages");

    return (
        <CheckboxList
            values={locales}
            keyProperty="id" titleProperty="name"
            currentValue={languages} onChange={setLanguages}
            columnWidth="300px"
        />
    );
}
