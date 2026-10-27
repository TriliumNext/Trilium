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

/** Leaves full screen. Shown in the tab bar only while `body.full-screen` is set. */
export function LeaveFullScreenButton() {
    return (
        <ActionButton
            className="toggle-button leave-full-screen-button"
            text={t("tab_row.leave_full_screen")}
            icon="bx bx-exit-fullscreen"
            triggerCommand="toggleFullscreen"
        />
    );
}
