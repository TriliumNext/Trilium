import { useMemo } from "preact/hooks";

import { t } from "../../../services/i18n";
import utils, { isElectron } from "../../../services/utils";
import { Badge } from "../../react/Badge";
import FormTextBox from "../../react/FormTextBox";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function DesktopSettings() {
    // The page is hidden from the options nav on the server (it's #electronOnly),
    // but can still be reached directly — show a placeholder there, mirroring the
    // spellcheck page.
    if (!isElectron()) {
        return (
            <OptionsSection>
                <NoItems text={t("desktop.web_placeholder")} icon="bx bx-desktop" />
            </OptionsSection>
        );
    }

    return (
        <>
            <TrayOptionsSettings />
            <StartupSettings />
            <SearchEngineSettings />
        </>
    );
}

function TrayOptionsSettings() {
    const [ disableTray, setDisableTray ] = useTriliumOptionBool("disableTray");
    const [ closeToTray, setCloseToTray ] = useTriliumOptionBool("closeToTray");

    return (
        <OptionsSection title={t("tray.title")}>
            <OptionsRowWithToggle
                name="tray-enabled"
                label={t("tray.enable_tray")}
                description={t("tray.enable_tray_description")}
                currentValue={!disableTray}
                onChange={async trayEnabled => {
                    await setDisableTray(!trayEnabled);
                    // Apply the change immediately so the user doesn't have to restart the app.
                    utils.reloadTray();
                }}
            />
            <OptionsRowWithToggle
                name="close-to-tray"
                label={t("tray.close_to_tray")}
                description={t("tray.close_to_tray_description")}
                currentValue={closeToTray}
                // Close-to-tray with no tray icon would hide the app with no way back.
                disabled={disableTray}
                onChange={setCloseToTray}
            />
        </OptionsSection>
    );
}

function StartupSettings() {
    const [ launchOnStartup, setLaunchOnStartup ] = useTriliumOptionBool("launchOnStartup");
    const [ hideOnAutoStart, setHideOnAutoStart ] = useTriliumOptionBool("hideOnAutoStart");
    const [ disableTray ] = useTriliumOptionBool("disableTray");

    return (
        <OptionsSection title={t("startup.title")}>
            <OptionsRowWithToggle
                name="launch-on-startup"
                label={t("startup.launch_on_startup")}
                description={t("startup.launch_on_startup_description")}
                currentValue={launchOnStartup}
                onChange={async enabled => {
                    await setLaunchOnStartup(enabled);
                    // Apply the change immediately so the user doesn't have to restart the app.
                    utils.reapplyLaunchOnStartup();
                }}
            />
            <OptionsRowWithToggle
                name="hide-on-auto-start"
                label={t("startup.hide_on_auto_start")}
                description={t("startup.hide_on_auto_start_description")}
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
        </OptionsSection>
    );
}

function SearchEngineSettings() {
    const [ customSearchEngineName, setCustomSearchEngineName ] = useTriliumOption("customSearchEngineName");
    const [ customSearchEngineUrl, setCustomSearchEngineUrl ] = useTriliumOption("customSearchEngineUrl");

    const searchEngines = useMemo(() => {
        return [
            { url: "https://duckduckgo.com/?q={keyword}", name: t("search_engine.duckduckgo") },
            { url: "https://www.bing.com/search?q={keyword}", name: t("search_engine.bing"), icon: "bx bxl-bing" },
            { url: "https://www.baidu.com/s?wd={keyword}", name: t("search_engine.baidu"), icon: "bx bxl-baidu" },
            { url: "https://www.google.com/search?q={keyword}", name: t("search_engine.google"), icon: "bx bxl-google" }
        ];
    }, []);

    return (
        <OptionsSection title={t("search_engine.title")} description={t("search_engine.custom_search_engine_info")}>
            <OptionsRow name="predefined-templates" label={t("search_engine.predefined_templates_label")}>
                <div className="search-engine-templates">
                    {searchEngines.map(engine => (
                        <Badge
                            key={engine.url}
                            icon={engine.icon}
                            text={engine.name}
                            className={customSearchEngineUrl === engine.url ? "selected" : ""}
                            onClick={() => {
                                setCustomSearchEngineName(engine.name);
                                setCustomSearchEngineUrl(engine.url);
                            }}
                        />
                    ))}
                </div>
            </OptionsRow>

            <OptionsRow name="custom-name" label={t("search_engine.custom_name_label")}>
                <FormTextBox
                    currentValue={customSearchEngineName} onBlur={setCustomSearchEngineName}
                    placeholder={t("search_engine.custom_name_placeholder")}
                />
            </OptionsRow>

            <OptionsRow name="custom-url" label={t("search_engine.custom_url_label")} description={t("search_engine.custom_url_description")} stacked>
                <FormTextBox
                    currentValue={customSearchEngineUrl} onBlur={setCustomSearchEngineUrl}
                    placeholder={t("search_engine.custom_url_placeholder")}
                />
            </OptionsRow>
        </OptionsSection>
    );
}
