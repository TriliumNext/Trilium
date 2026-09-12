import { useCallback, useMemo } from "preact/hooks";

import appContext from "../../../components/app_context";
import { t } from "../../../services/i18n";
import { isElectron } from "../../../services/utils";
import Button from "../../react/Button";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import CheckboxList from "./components/CheckboxList";
import OptionsPageHeader from "./components/OptionsPageHeader";

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
            {/* The switch governs the whole page rather than anything on it, so it belongs to the
                header — on the row below the title, clear of the dialog's own close button. */}
            <OptionsPageHeader
                below={
                    <OptionCardSection
                        className="options-header-switch"
                        name="spellcheck-enabled"
                        label={t("spellcheck.enable")}
                        description={t("spellcheck.enable_description")}
                    >
                        <FormToggle currentValue={spellCheckEnabled} onChange={onToggle} />
                    </OptionCardSection>
                }
            />

            {spellCheckEnabled && (
                <>
                    <SpellcheckLanguages />
                    <CustomDictionary />
                </>
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
        <Card className="spellcheck-languages" heading={t("spellcheck.language_code_label")}>
            <CardSection>
                <CheckboxList
                    values={availableLanguages}
                    keyProperty="code" titleProperty="name"
                    currentValue={selectedCodes}
                    onChange={setSelectedCodes}
                    columnWidth="200px"
                />
            </CardSection>
        </Card>
    );
}

function CustomDictionary() {
    function openDictionary() {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: "_customDictionary" });
    }

    return (
        <Card
            heading={t("spellcheck.custom_dictionary_title")}
            description={t("spellcheck.custom_dictionary_description")}
        >
            <OptionCardSection
                label={t("spellcheck.custom_dictionary_edit")}
                description={t("spellcheck.custom_dictionary_edit_description")}
            >
                <Button
                    name="open-custom-dictionary"
                    text={t("spellcheck.custom_dictionary_open")}
                    icon="bx-edit"
                    size="micro"
                    onClick={openDictionary}
                />
            </OptionCardSection>
        </Card>
    );
}

function WebSpellcheckSettings() {
    return (
        <NoItems
            text={t("spellcheck.description")}
            icon="bx bx-check-double"
        />
    );
}
