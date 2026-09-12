import "./i18n.css";

import type { Locale } from "@triliumnext/commons";
import { useMemo } from "preact/hooks";

import { getAvailableLocales, t } from "../../../services/i18n";
import { isElectron } from "../../../services/utils";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import FormSelect from "../../react/FormSelect";
import { useTriliumOption, useTriliumOptionJson } from "../../react/hooks";
import CheckboxList from "./components/CheckboxList";
import { LocaleSelector } from "./components/LocaleSelector";
import OptionsPageHeader from "./components/OptionsPageHeader";
import RelatedSettings from "./components/RelatedSettings";
import RestartAction from "./components/RestartAction";

export default function InternationalizationOptions() {
    return (
        <>
            <OptionsPageHeader />
            <LocalizationOptions />
            <DateSettings />
            <ContentLanguages />
            {/* Both cards above only take effect once the app has started again. */}
            <RestartAction text={t("electron_integration.restart-app-button")} />
            {isElectron() && (
                <RelatedSettings items={[
                    {
                        title: t("spellcheck.title"),
                        description: t("spellcheck.related_description"),
                        targetPage: "_optionsSpellcheck"
                    }
                ]} />
            )}
        </>
    );
}

/** The languages the app is read in, written in, and formats its figures and dates by. */
function LocalizationOptions() {
    const { uiLocales, formattingLocales: contentLocales, writingLocales } = useMemo<{ uiLocales: Locale[], formattingLocales: Locale[], writingLocales: Locale[] }>(() => {
        const allLocales = getAvailableLocales();
        return {
            uiLocales: allLocales.filter(locale => {
                if (locale.contentOnly) return false;
                if (locale.devOnly && !glob.isDev) return false;
                return true;
            }),
            // Anything a note can be written in, so unlike the formatting list this keeps the
            // content-only right-to-left locales.
            writingLocales: allLocales.filter(locale => !locale.devOnly || glob.isDev),
            formattingLocales: [
                ...allLocales.filter(locale => {
                    if (!locale.electronLocale) return false;
                    if (locale.devOnly && !glob.isDev) return false;
                    return true;
                })
            ]
        }
    }, []);

    const [ locale, setLocale ] = useTriliumOption("locale");
    const [ formattingLocale, setFormattingLocale ] = useTriliumOption("formattingLocale");
    const [ defaultContentLanguage, setDefaultContentLanguage ] = useTriliumOption("defaultContentLanguage");

    return (
        <Card heading={t("i18n.title")}>
            <OptionCardSection name="language" label={t("i18n.language")}>
                <LocaleSelector locales={uiLocales} currentValue={locale} onChange={setLocale} />
            </OptionCardSection>

            <OptionCardSection name="formatting-locale" label={t("i18n.formatting-locale")}>
                <LocaleSelector
                    locales={contentLocales}
                    currentValue={formattingLocale}
                    onChange={setFormattingLocale}
                    defaultLocale={{ id: "", name: t("i18n.formatting-locale-auto") }}
                />
            </OptionCardSection>

            <OptionCardSection
                name="default-content-language"
                label={t("i18n.default-content-language")}
                description={t("i18n.default-content-language-description")}
            >
                <LocaleSelector
                    locales={writingLocales}
                    currentValue={defaultContentLanguage}
                    onChange={setDefaultContentLanguage}
                    defaultLocale={{ id: "", name: t("i18n.default-content-language-auto") }}
                />
            </OptionCardSection>
        </Card>
    )
}

/**
 * Where a week starts and which one counts as the first of the year — conventions the calendar and
 * week notes are numbered by, rather than languages, which is why they stand apart from the card
 * above.
 */
function DateSettings() {
    const [ firstDayOfWeek, setFirstDayOfWeek ] = useTriliumOption("firstDayOfWeek");
    const [ firstWeekOfYear, setFirstWeekOfYear ] = useTriliumOption("firstWeekOfYear");
    const [ minDaysInFirstWeek, setMinDaysInFirstWeek ] = useTriliumOption("minDaysInFirstWeek");

    return (
        <Card heading={t("i18n.dates-title")}>
            <OptionCardSection name="first-day-of-week" label={t("i18n.first-day-of-the-week")}>
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
            </OptionCardSection>

            <OptionCardSection
                name="first-week-of-year"
                label={t("i18n.first-week-of-the-year")}
                description={t("i18n.first-week-warning")}
            >
                <FormSelect
                    name="first-week-of-year"
                    currentValue={firstWeekOfYear}
                    onChange={setFirstWeekOfYear}
                    keyProperty="value"
                    titleProperty="label"
                    values={[
                        { value: "0", label: t("i18n.first-week-contains-first-day") },
                        { value: "1", label: t("i18n.first-week-contains-first-thursday") },
                        { value: "2", label: t("i18n.first-week-has-minimum-days") }
                    ]}
                />
            </OptionCardSection>

            {firstWeekOfYear === "2" && (
                <OptionCardSection name="min-days-in-first-week" label={t("i18n.min-days-in-first-week")}>
                    <FormSelect
                        keyProperty="days"
                        currentValue={minDaysInFirstWeek} onChange={setMinDaysInFirstWeek}
                        values={Array.from(
                            { length: 7 },
                            (_, i) => ({ days: String(i + 1) }))} />
                </OptionCardSection>
            )}
        </Card>
    )
}

function ContentLanguages() {
    return (
        <Card
            heading={t("content_language.title")}
            description={t("content_language.description")}
        >
            <CardSection className="i18n-content-languages">
                <ContentLanguagesList />
            </CardSection>
        </Card>
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

