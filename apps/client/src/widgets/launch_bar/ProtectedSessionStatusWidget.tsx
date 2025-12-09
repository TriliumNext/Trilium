import { useState } from "preact/hooks";
import protected_session_holder from "../../services/protected_session_holder";
import { LaunchBarActionButton } from "./launch_bar_widgets";
import { useTriliumEvent } from "../react/hooks";
import { t } from "../../services/i18n";

export default function ProtectedSessionStatusWidget() {
    const protectedSessionAvailable = useProtectedSessionAvailable();

    return (
        protectedSessionAvailable ? (
            <LaunchBarActionButton
                icon="bx bx-check-shield"
                text={t("protected_session_status.active")}
                triggerCommand="leaveProtectedSession"
            />
        ) : (
            <LaunchBarActionButton
                icon="bx bx-shield-quarter"
                text={t("protected_session_status.inactive")}
                triggerCommand="enterProtectedSession"
            />
        )
    )
}

function useProtectedSessionAvailable() {
    const [ protectedSessionAvailable, setProtectedSessionAvailable ] = useState(protected_session_holder.isProtectedSessionAvailable());
    useTriliumEvent("protectedSessionStarted", () => {
        setProtectedSessionAvailable(protected_session_holder.isProtectedSessionAvailable());
    });
    return protectedSessionAvailable;
}
