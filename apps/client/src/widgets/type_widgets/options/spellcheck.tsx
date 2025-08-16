import { useMemo } from "preact/hooks";
import { t } from "../../../services/i18n";
import FormCheckbox from "../../react/FormCheckbox";
import FormGroup from "../../react/FormGroup";
import FormText from "../../react/FormText";
import FormTextBox from "../../react/FormTextBox";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import { dynamicRequire, isElectron } from "../../../services/utils";

export default function SpellcheckSettings() {
    if (isElectron()) {
        return <ElectronSpellcheckSettings />
    } else {
        return <WebSpellcheckSettings />
    }
}

function ElectronSpellcheckSettings() {
    const [ spellCheckEnabled, setSpellCheckEnabled ] = useTriliumOptionBool("spellCheckEnabled");
    const [ spellCheckLanguageCode, setSpellCheckLanguageCode ] = useTriliumOption("spellCheckLanguageCode");

    const availableLanguageCodes = useMemo(() => {
        if (!isElectron()) {
            return [];
        }

        const { webContents } = dynamicRequire("@electron/remote").getCurrentWindow();        
        return webContents.session.availableSpellCheckerLanguages as string[];
    }, [])

    return (
        <OptionsSection title={t("spellcheck.title")}>
            <FormText>{t("spellcheck.restart-required")}</FormText>

            <FormCheckbox
                name="spell-check-enabled"
                label={t("spellcheck.enable")}
                currentValue={spellCheckEnabled} onChange={setSpellCheckEnabled}
            />

            <FormGroup label={t("spellcheck.language_code_label")} description={t("spellcheck.multiple_languages_info")}>
                <FormTextBox                    
                    name="spell-check-languages"
                    placeholder={t("spellcheck.language_code_placeholder")}
                    currentValue={spellCheckLanguageCode} onChange={setSpellCheckLanguageCode}
                />
            </FormGroup>

            <FormText>
                <strong>{t("spellcheck.available_language_codes_label")} </strong>
                {availableLanguageCodes.join(", ")}
            </FormText>
        </OptionsSection>
    )
}

function WebSpellcheckSettings() {
    return (
        <OptionsSection title={t("spellcheck.title")}>
            <p>{t("spellcheck.description")}</p>
        </OptionsSection>
    )
}