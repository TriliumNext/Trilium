import { t } from "../../../services/i18n";
import utils, { isElectron } from "../../../services/utils";
import { Card, OptionCardSection } from "../../react/Card";
import FormToggle from "../../react/FormToggle";
import { useTriliumOptionBool } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";

export default function DesktopSettings() {
    // The page is hidden from the options nav on the server (it's #electronOnly),
    // but can still be reached directly — show a placeholder there, mirroring the
    // spellcheck page.
    if (!isElectron()) {
        return (
            <>
                <OptionsPageHeader />
                <NoItems text={t("desktop.web_placeholder")} icon="bx bx-desktop" />
            </>
        );
    }

    return (
        <>
            <OptionsPageHeader />
            <TrayOptionsSettings />
            <StartupSettings />
        </>
    );
}

function TrayOptionsSettings() {
    const [ disableTray, setDisableTray ] = useTriliumOptionBool("disableTray");
    const [ closeToTray, setCloseToTray ] = useTriliumOptionBool("closeToTray");

    return (
        <Card heading={t("tray.title")}>
            <OptionCardSection
                name="tray-enabled"
                label={t("tray.enable_tray")}
                description={t("tray.enable_tray_description")}
            >
                <FormToggle
                    currentValue={!disableTray}
                    onChange={async trayEnabled => {
                        await setDisableTray(!trayEnabled);
                        // Apply the change immediately so the user doesn't have to restart the app.
                        utils.reloadTray();
                    }}
                />
            </OptionCardSection>

            <OptionCardSection
                name="close-to-tray"
                label={t("tray.close_to_tray")}
                description={t("tray.close_to_tray_description")}
            >
                <FormToggle
                    currentValue={closeToTray}
                    // Close-to-tray with no tray icon would hide the app with no way back.
                    disabled={disableTray}
                    onChange={setCloseToTray}
                />
            </OptionCardSection>
        </Card>
    );
}

function StartupSettings() {
    const [ launchOnStartup, setLaunchOnStartup ] = useTriliumOptionBool("launchOnStartup");
    const [ hideOnAutoStart, setHideOnAutoStart ] = useTriliumOptionBool("hideOnAutoStart");
    const [ disableTray ] = useTriliumOptionBool("disableTray");

    return (
        <Card heading={t("startup.title")}>
            <OptionCardSection
                name="launch-on-startup"
                label={t("startup.launch_on_startup")}
                description={t("startup.launch_on_startup_description")}
            >
                <FormToggle
                    currentValue={launchOnStartup}
                    onChange={async enabled => {
                        await setLaunchOnStartup(enabled);
                        // Apply the change immediately so the user doesn't have to restart the app.
                        utils.reapplyLaunchOnStartup();
                    }}
                />
            </OptionCardSection>

            <OptionCardSection
                name="hide-on-auto-start"
                label={t("startup.hide_on_auto_start")}
                description={t("startup.hide_on_auto_start_description")}
            >
                <FormToggle
                    currentValue={hideOnAutoStart}
                    // Only meaningful when launched at login, and the tray must exist to
                    // bring the hidden window back.
                    disabled={!launchOnStartup || disableTray}
                    onChange={async enabled => {
                        await setHideOnAutoStart(enabled);
                        // Re-tag the autostart entry so it launches hidden (or not).
                        utils.reapplyLaunchOnStartup();
                    }}
                />
            </OptionCardSection>
        </Card>
    );
}
