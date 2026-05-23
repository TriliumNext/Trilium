import { t } from "../../../../services/i18n";
import { ButtonGroup } from "../../../react/Button";
import Icon from "../../../react/Icon";
import OptionsRow from "./OptionsRow";

interface ThemeModeSelectorProps {
    matchesApp: boolean;
    onMatchesAppChange: (value: boolean) => void;
}

export default function ThemeModeSelector({ matchesApp, onMatchesAppChange }: ThemeModeSelectorProps) {
    return (
        <OptionsRow name="theme-mode" label={t("code_theme.theme_mode")}>
            <ButtonGroup>
                <button
                    type="button"
                    className={`btn btn-sm btn-secondary ${matchesApp ? "active" : ""}`}
                    onClick={() => onMatchesAppChange(true)}
                >
                    <Icon icon="bx bx-brightness-half" />{" "}{t("code_theme.match_app_appearance")}
                </button>
                <button
                    type="button"
                    className={`btn btn-sm btn-secondary ${!matchesApp ? "active" : ""}`}
                    onClick={() => onMatchesAppChange(false)}
                >
                    <Icon icon="bx bx-pin" />{" "}{t("code_theme.always_use_one_theme")}
                </button>
            </ButtonGroup>
        </OptionsRow>
    );
}
