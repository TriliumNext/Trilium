import { useState } from "preact/hooks";
import { t } from "../services/i18n";
import ActionButton from "./react/ActionButton";
import { useTriliumEvent } from "./react/hooks";
import "./close_zen_button.css";

export default function CloseZenModeButton() {
    const [ zenModeEnabled, setZenModeEnabled ] = useState(false);

    useTriliumEvent("zenModeChanged", ({ isEnabled }) => {
        setZenModeEnabled(isEnabled);
    });

    return (
        <div class={`close-zen-container ${!zenModeEnabled ? "hidden-ext" : ""}`}>
            {zenModeEnabled && (
                <ActionButton
                    icon="bx bxs-yin-yang"
                    triggerCommand="toggleZenMode"
                    text={t("zen_mode.button_exit")}
                />
            )}
        </div>
    )
}
