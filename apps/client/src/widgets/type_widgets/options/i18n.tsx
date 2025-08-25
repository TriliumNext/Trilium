import { useMemo } from "preact/hooks";
import { getAvailableLocales, t } from "../../../services/i18n";
import FormSelect from "../../react/FormSelect";
import OptionsRow from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import { useTriliumOption, useTriliumOptionJson } from "../../react/hooks";
import type { Locale } from "@triliumnext/commons";
import { isElectron, restartDesktopApp } from "../../../services/utils";
import FormRadioGroup, { FormInlineRadioGroup } from "../../react/FormRadioGroup";
import FormText from "../../react/FormText";
import RawHtml from "../../react/RawHtml";
import Admonition from "../../react/Admonition";
import Button from "../../react/Button";
import CheckboxList from "./components/CheckboxList";

export default function InternationalizationOptions() {
    return (
        <>
            <LocalizationOptions />
            <ContentLanguages />
        </>
    )
}

function LocalizationOptions() {
    const { uiLocales, formattingLocales: contentLocales } = useMemo(() => {
        const allLocales = getAvailableLocales();        
        return {
            uiLocales: allLocales.filter(locale => !locale.contentOnly),
            formattingLocales: allLocales.filter(locale => locale.electronLocale),
        }
    }, []);

    const [ locale, setLocale ] = useTriliumOption("locale");
    const [ formattingLocale, setFormattingLocale ] = useTriliumOption("formattingLocale");

    return (
        <OptionsSection title={t("i18n.title")}>
            <OptionsRow name="language" label={t("i18n.language")}>
                <LocaleSelector locales={uiLocales} currentValue={locale} onChange={setLocale} />
            </OptionsRow>

            {isElectron() && <OptionsRow name="formatting-locale" label={t("i18n.formatting-locale")}>
                <LocaleSelector locales={contentLocales} currentValue={formattingLocale} onChange={setFormattingLocale} />
            </OptionsRow>}

            <DateSettings />
        </OptionsSection>
    )
}

function LocaleSelector({ id, locales, currentValue, onChange }: { id?: string; locales: Locale[], currentValue: string, onChange: (newLocale: string) => void }) {
    return <FormSelect
        id={id}
        values={locales}
        keyProperty="id" titleProperty="name"                
        currentValue={currentValue} onChange={onChange}
    />;
}

function DateSettings() {
    const [ firstDayOfWeek, setFirstDayOfWeek ] = useTriliumOption("firstDayOfWeek");
    const [ firstWeekOfYear, setFirstWeekOfYear ] = useTriliumOption("firstWeekOfYear");
    const [ minDaysInFirstWeek, setMinDaysInFirstWeek ] = useTriliumOption("minDaysInFirstWeek");

    return (
        <>
            <OptionsRow name="first-day-of-week" label={t("i18n.first-day-of-the-week")}>
                <FormInlineRadioGroup
                    name="first-day-of-week"
                    values={[
                        { value: "0", label: t("i18n.sunday") },
                        { value: "1", label: t("i18n.monday") }
                    ]}
                    currentValue={firstDayOfWeek} onChange={setFirstDayOfWeek}
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
    const locales = useMemo(() => getAvailableLocales(), []);
    const [ languages, setLanguages ] = useTriliumOptionJson<string[]>("languages");

    return (
        <OptionsSection title={t("content_language.title")}>
            <FormText>{t("content_language.description")}</FormText>

            <CheckboxList
                values={locales}
                keyProperty="id" titleProperty="name"
                currentValue={languages} onChange={setLanguages}
            />
        </OptionsSection>
    );
}