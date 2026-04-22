import { useCallback, useMemo } from "preact/hooks";

import appContext from "../../../components/app_context";
import { t } from "../../../services/i18n";
import { dynamicRequire, isElectron, restartDesktopApp } from "../../../services/utils";
import Button from "../../react/Button";
import FormText from "../../react/FormText";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import CheckboxList from "./components/CheckboxList";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function SpellcheckSettings() {
    if (isElectron()) {
        return <ElectronSpellcheckSettings />;
    }
    return <WebSpellcheckSettings />;
}

interface SpellcheckLanguage {
    code: string;
    name: string;
}

function ElectronSpellcheckSettings() {
    const [ spellCheckEnabled, setSpellCheckEnabled ] = useTriliumOptionBool("spellCheckEnabled");

    return (
        <>
            <OptionsSection title={t("spellcheck.title")}>
                <FormText>{t("spellcheck.restart-required")}</FormText>

                <OptionsRowWithToggle
                    name="spell-check-enabled"
                    label={t("spellcheck.enable")}
                    currentValue={spellCheckEnabled}
                    onChange={setSpellCheckEnabled}
                />

                <OptionsRow name="restart" centered>
                    <Button
                        name="restart-app-button"
                        text={t("electron_integration.restart-app-button")}
                        size="micro"
                        onClick={restartDesktopApp}
                    />
                </OptionsRow>
            </OptionsSection>

            {spellCheckEnabled && <SpellcheckLanguages />}
            {spellCheckEnabled && <CustomDictionary />}
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
    }, [setSpellCheckLanguageCode]);

    const availableLanguages = useMemo<SpellcheckLanguage[]>(() => {
        if (!isElectron()) {
            return [];
        }

        const { webContents } = dynamicRequire("@electron/remote").getCurrentWindow();
        const codes = webContents.session.availableSpellCheckerLanguages as string[];
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
