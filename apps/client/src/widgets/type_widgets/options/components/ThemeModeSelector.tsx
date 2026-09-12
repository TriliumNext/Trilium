import { t } from "../../../../services/i18n";
import { OptionCardSection } from "../../../react/Card";
import SegmentedChoice, { SegmentedChoiceOption } from "../../../react/SegmentedChoice";

type ThemeMode = "app" | "fixed";

interface ThemeModeSelectorProps {
    matchesApp: boolean;
    onMatchesAppChange: (value: boolean) => void;
}

export default function ThemeModeSelector({ matchesApp, onMatchesAppChange }: ThemeModeSelectorProps) {
    const modes: SegmentedChoiceOption<ThemeMode>[] = [
        { value: "app", label: t("code_theme.match_app_appearance"), icon: "bx-brightness-half" },
        { value: "fixed", label: t("code_theme.always_use_one_theme"), icon: "bx-pin" }
    ];

    return (
        <OptionCardSection name="theme-mode" label={t("code_theme.theme_mode")}>
            <SegmentedChoice
                options={modes}
                currentValue={matchesApp ? "app" : "fixed"}
                onChange={(mode) => onMatchesAppChange(mode === "app")}
                collapseOnMobile
            />
        </OptionCardSection>
    );
}
