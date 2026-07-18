import { useCallback, useMemo } from "preact/hooks";

import appContext from "../../../components/app_context";
import { t } from "../../../services/i18n";
import { isElectron } from "../../../services/utils";
import Button from "../../react/Button";
import FormText from "../../react/FormText";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import CheckboxList from "./components/CheckboxList";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function SpellcheckSettings() {
    if (isElectron()) {
        return <ElectronSpellcheckSettings />;
    }
    return (
        <>
            <OptionsPageHeader />
            <WebSpellcheckSettings />
        </>
    );
}

interface SpellcheckLanguage {
    code: string;
    name: string;
}

function ElectronSpellcheckSettings() {
    const [ spellCheckEnabled, setSpellCheckEnabled ] = useTriliumOptionBool("spellCheckEnabled");

    const onToggle = useCallback((enabled: boolean) => {
        setSpellCheckEnabled(enabled);
        // Apply immediately to the live Electron sessions so the change takes
        // effect without restarting the app.
        window.electronApi?.spellcheck.setSpellCheckerEnabled(enabled);
    }, [setSpellCheckEnabled]);

    return (
        <>
            <OptionsPageHeader actions={
                <FormToggle
                    switchOnName="" switchOffName=""
                    switchOnTooltip={t("spellcheck.enable")}
                    switchOffTooltip={t("spellcheck.enable")}
                    currentValue={spellCheckEnabled}
                    onChange={onToggle}
                />
            } />

            {spellCheckEnabled ? (
                <>
                    <SpellcheckLanguages />
                    <CustomDictionary />
                </>
            ) : (
                <OptionsSection>
                    <NoItems icon="bx bx-check-double" text={t("spellcheck.disabled_placeholder")} />
                </OptionsSection>
            )}
        </>
    );
}

function SpellcheckLanguages() {
    const [ spellCheckLanguageCode, setSpellCheckLanguageCode ] = useTriliumOption("spellCheckLanguageCode");

    const selectedCodes = useMemo(() =>
        (spellCheckLanguageCode ?? "")
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c.length > 0),
    [spellCheckLanguageCode]
    );

    const setSelectedCodes = useCallback((codes: string[]) => {
        setSpellCheckLanguageCode(codes.join(", "));
        // Apply immediately to the live Electron sessions so the change takes
        // effect without restarting the app.
        window.electronApi?.spellcheck.setSpellCheckerLanguages(codes);
    }, [setSpellCheckLanguageCode]);

    const availableLanguages = useMemo<SpellcheckLanguage[]>(() => {
        const api = window.electronApi?.spellcheck;
        if (!api) {
            return [];
        }

        const codes = api.getAvailableSpellCheckerLanguages();
        const displayNames = new Intl.DisplayNames([navigator.language], { type: "language" });

        return codes.map((code) => ({
            code,
            name: displayNames.of(code) ?? code
        })).sort((a, b) => a.name.localeCompare(b.name));
    }, []);

    return (
        <OptionsSection title={t("spellcheck.language_code_label")}>
            <CheckboxList
                values={availableLanguages}
                keyProperty="code" titleProperty="name"
                currentValue={selectedCodes}
                onChange={setSelectedCodes}
                columnWidth="200px"
            />
        </OptionsSection>
    );
}

function CustomDictionary() {
    function openDictionary() {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: "_customDictionary" });
    }

    return (
        <OptionsSection title={t("spellcheck.custom_dictionary_title")}>
            <FormText>{t("spellcheck.custom_dictionary_description")}</FormText>

            <OptionsRow name="custom-dictionary" label={t("spellcheck.custom_dictionary_edit")} description={t("spellcheck.custom_dictionary_edit_description")}>
                <Button
                    name="open-custom-dictionary"
                    text={t("spellcheck.custom_dictionary_open")}
                    icon="bx bx-edit"
                    onClick={openDictionary}
                />
            </OptionsRow>
        </OptionsSection>
    );
}

function WebSpellcheckSettings() {
    return (
        <OptionsSection>
            <NoItems
                text={t("spellcheck.description")}
                icon="bx bx-check-double"
            />
        </OptionsSection>
    );
}
