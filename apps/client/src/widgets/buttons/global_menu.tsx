import "./global_menu.css";

import { KeyboardActionNames } from "@triliumnext/commons";
import { ComponentChildren, RefObject } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import { CommandNames } from "../../components/app_context";
import Component from "../../components/component";
import { ExperimentalFeature, ExperimentalFeatureId, experimentalFeatures, isExperimentalFeatureEnabled, toggleExperimentalFeature } from "../../services/experimental_features";
import { t } from "../../services/i18n";
import utils, { dynamicRequire, isElectron, isMobile, reloadFrontendApp } from "../../services/utils";
import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem } from "../react/FormList";
import { useStaticTooltip, useStaticTooltipWithKeyboardShortcut, useTriliumOption, useTriliumOptionBool, useTriliumOptionInt } from "../react/hooks";
import KeyboardShortcut from "../react/KeyboardShortcut";
import { ParentComponent } from "../react/react_utils";

interface MenuItemProps<T> {
    icon: string,
    text: ComponentChildren,
    title?: string,
    command: T,
    disabled?: boolean
    active?: boolean;
    outsideChildren?: ComponentChildren;
}

export default function GlobalMenu({ isHorizontalLayout }: { isHorizontalLayout: boolean }) {
    const isVerticalLayout = !isHorizontalLayout;
    const parentComponent = useContext(ParentComponent);
    const { isUpdateAvailable, latestVersion } = useTriliumUpdateStatus();
    const isMobileLocal = isMobile();
    const logoRef = useRef<SVGSVGElement>(null);
    useStaticTooltip(logoRef);

    return (
        <Dropdown
            className="global-menu"
            buttonClassName={`global-menu-button ${isHorizontalLayout ? "bx bx-menu" : ""}`} noSelectButtonStyle iconAction hideToggleArrow
            text={<>
                {isVerticalLayout && <VerticalLayoutIcon logoRef={logoRef} />}
                {isUpdateAvailable && <div class="global-menu-button-update-available">
                    <span className="bx bxs-down-arrow-alt global-menu-button-update-available-button" title={t("update_available.update_available")} />
                </div>}
            </>}
            noDropdownListStyle
            onShown={isMobileLocal ? () => document.getElementById("context-menu-cover")?.classList.add("show", "global-menu-cover") : undefined}
            onHidden={isMobileLocal ? () => document.getElementById("context-menu-cover")?.classList.remove("show", "global-menu-cover") : undefined}
        >

            <MenuItem command="openNewWindow" icon="bx bx-window-open" text={t("global_menu.open_new_window")} />
            <MenuItem command="showShareSubtree" icon="bx bx-share-alt" text={t("global_menu.show_shared_notes_subtree")} />
            <FormDropdownDivider />

            <ZoomControls parentComponent={parentComponent} />
            <ToggleWindowOnTop />
            <KeyboardActionMenuItem command="toggleZenMode" icon="bx bxs-yin-yang" text={t("global_menu.toggle-zen-mode")} />
            <FormDropdownDivider />

            <SwitchToOptions />
            <MenuItem command="showLaunchBarSubtree" icon={`bx ${isMobile() ? "bx-mobile" : "bx-sidebar"}`} text={t("global_menu.configure_launchbar")} />
            <AdvancedMenu dropStart={!isVerticalLayout} />
            <MenuItem command="showOptions" icon="bx bx-cog" text={t("global_menu.options")} />
            <FormDropdownDivider />

            <KeyboardActionMenuItem command="showHelp" icon="bx bx-help-circle" text={t("global_menu.show_help")} />
            <KeyboardActionMenuItem command="showCheatsheet" icon="bx bxs-keyboard" text={t("global_menu.show-cheatsheet")} />
            <MenuItem command="openAboutDialog" icon="bx bx-info-circle" text={t("global_menu.about")} />

            {isUpdateAvailable &&  <>
                <FormListHeader text={t("global_menu.new-version-available")} />
                <MenuItem command={() => window.open("https://github.com/TriliumNext/Trilium/releases/latest")}
                    icon="bx bx-download"
                    text={t("global_menu.download-update", {latestVersion})} />
            </>}

            {!isElectron() && <BrowserOnlyOptions />}
            {glob.isDev && <DevelopmentOptions dropStart={!isVerticalLayout} />}
        </Dropdown>
    );
}

function AdvancedMenu({ dropStart }: { dropStart: boolean }) {
    return (
        <FormDropdownSubmenu icon="bx bx-chip" title={t("global_menu.advanced")} dropStart={dropStart}>
            <MenuItem command="showHiddenSubtree" icon="bx bx-hide" text={t("global_menu.show_hidden_subtree")} />
            <MenuItem command="showSearchHistory" icon="bx bx-search-alt" text={t("global_menu.open_search_history")} />
            <FormDropdownDivider />

            <KeyboardActionMenuItem command="showBackendLog" icon="bx bx-detail" text={t("global_menu.show_backend_log")} />
            <KeyboardActionMenuItem command="showSQLConsole" icon="bx bx-data" text={t("global_menu.open_sql_console")} />
            <MenuItem command="showSQLConsoleHistory" icon="bx bx-data" text={t("global_menu.open_sql_console_history")} />
            <FormDropdownDivider />

            {isElectron() && <MenuItem command="openDevTools" icon="bx bx-bug-alt" text={t("global_menu.open_dev_tools")} />}
            <KeyboardActionMenuItem command="reloadFrontendApp" icon="bx bx-refresh" text={t("global_menu.reload_frontend")} title={t("global_menu.reload_hint")} />
        </FormDropdownSubmenu>
    );
}

function BrowserOnlyOptions() {
    return <>
        <FormDropdownDivider />
        <MenuItem command="logout" icon="bx bx-log-out" text={t("global_menu.logout")} />
    </>;
}

function DevelopmentOptions({ dropStart }: { dropStart: boolean }) {
    return <>
        <FormDropdownDivider />
        <FormListItem disabled>Development Options</FormListItem>
        <FormDropdownSubmenu icon="bx bx-test-tube" title="Experimental features" dropStart={dropStart}>
            {experimentalFeatures.map((feature) => (
                <ExperimentalFeatureToggle key={feature.id} experimentalFeature={feature as ExperimentalFeature} />
            ))}
        </FormDropdownSubmenu>
    </>;
}

function ExperimentalFeatureToggle({ experimentalFeature }: { experimentalFeature: ExperimentalFeature }) {
    const featureEnabled = isExperimentalFeatureEnabled(experimentalFeature.id as ExperimentalFeatureId);

    return (
        <FormListItem
            checked={featureEnabled}
            title={experimentalFeature.description}
            onClick={async () => {
                await toggleExperimentalFeature(experimentalFeature.id as ExperimentalFeatureId, !featureEnabled);
                reloadFrontendApp();
            }}
        >{experimentalFeature.name}</FormListItem>
    );
}

function SwitchToOptions() {
    if (isElectron()) {
        return;
    } else if (!isMobile()) {
        return <MenuItem command="switchToMobileVersion" icon="bx bx-mobile" text={t("global_menu.switch_to_mobile_version")} />;
    }
    return <MenuItem command="switchToDesktopVersion" icon="bx bx-desktop" text={t("global_menu.switch_to_desktop_version")} />;

}

function MenuItem({ icon, text, title, command, disabled, active }: MenuItemProps<KeyboardActionNames | CommandNames | (() => void)>) {
    return <FormListItem
        icon={icon}
        title={title}
        triggerCommand={typeof command === "string" ? command : undefined}
        onClick={typeof command === "function" ? command : undefined}
        disabled={disabled}
        active={active}
    >{text}</FormListItem>;
}

function KeyboardActionMenuItem({ text, command, ...props }: MenuItemProps<KeyboardActionNames>) {
    return <MenuItem
        {...props}
        command={command}
        text={<>{text} <KeyboardShortcut actionName={command as KeyboardActionNames} /></>}
    />;
}

export function VerticalLayoutIcon({ logoRef }: { logoRef?: RefObject<SVGSVGElement> }) {
    return (
        <svg ref={logoRef} viewBox="0 0 256 256" title={t("global_menu.menu")}>
            <g>
                <path className="st0" d="m202.9 112.7c-22.5 16.1-54.5 12.8-74.9 6.3l14.8-11.8 14.1-11.3 49.1-39.3-51.2 35.9-14.3 10-14.9 10.5c0.7-21.2 7-49.9 28.6-65.4 1.8-1.3 3.9-2.6 6.1-3.8 2.7-1.5 5.7-2.9 8.8-4.1 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.9 65.9-2.4 2.8-4.9 5.4-7.4 7.8-3.4 3.5-6.8 6.4-10.1 8.8z"/>
                <path className="st1" d="m213.1 104c-22.2 12.6-51.4 9.3-70.3 3.2l14.1-11.3 49.1-39.3-51.2 35.9-14.3 10c0.5-18.1 4.9-42.1 19.7-58.6 2.7-1.5 5.7-2.9 8.8-4.1 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.9 65.9-2.3 2.8-4.8 5.4-7.2 7.8z"/>
                <path className="st2" d="m220.5 96.2c-21.1 8.6-46.6 5.3-63.7-0.2l49.2-39.4-51.2 35.9c0.3-15.8 3.5-36.6 14.3-52.8 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.8 66z"/>

                <path className="st3" d="m106.7 179c-5.8-21 5.2-43.8 15.5-57.2l4.8 14.2 4.5 13.4 15.9 47-12.8-47.6-3.6-13.2-3.7-13.9c15.5 6.2 35.1 18.6 40.7 38.8 0.5 1.7 0.9 3.6 1.2 5.5 0.4 2.4 0.6 5 0.7 7.7 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8-1.4-2.6-2.7-5.1-3.8-7.6-1.6-3.5-2.9-6.8-3.8-10z"/>
                <path className="st4" d="m110.4 188.9c-3.4-19.8 6.9-40.5 16.6-52.9l4.5 13.4 15.9 47-12.8-47.6-3.6-13.2c13.3 5.2 29.9 15 38.1 30.4 0.4 2.4 0.6 5 0.7 7.7 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8-1.4-2.6-2.7-5.2-3.8-7.7z"/>
                <path className="st5" d="m114.2 196.5c-0.7-18 8.6-35.9 17.3-47.1l15.9 47-12.8-47.6c11.6 4.4 26.1 12.4 35.2 24.8 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8z"/>

                <path className="st6" d="m86.3 59.1c21.7 10.9 32.4 36.6 35.8 54.9l-15.2-6.6-14.5-6.3-50.6-22 48.8 24.9 13.6 6.9 14.3 7.3c-16.6 7.9-41.3 14.5-62.1 4.1-1.8-0.9-3.6-1.9-5.4-3.2-2.3-1.5-4.5-3.2-6.8-5.1-19.9-16.4-40.3-46.4-42.7-61.5 12.4-6.5 41.5-5.8 64.8-0.3 3.2 0.8 6.2 1.6 9.1 2.5 4 1.3 7.6 2.8 10.9 4.4z"/>
                <path className="st7" d="m75.4 54.8c18.9 12 28.4 35.6 31.6 52.6l-14.5-6.3-50.6-22 48.7 24.9 13.6 6.9c-14.1 6.8-34.5 13-53.3 8.2-2.3-1.5-4.5-3.2-6.8-5.1-19.8-16.4-40.2-46.4-42.6-61.5 12.4-6.5 41.5-5.8 64.8-0.3 3.1 0.8 6.2 1.6 9.1 2.6z"/>
                <path className="st8" d="m66.3 52.2c15.3 12.8 23.3 33.6 26.1 48.9l-50.6-22 48.8 24.9c-12.2 6-29.6 11.8-46.5 10-19.8-16.4-40.2-46.4-42.6-61.5 12.4-6.5 41.5-5.8 64.8-0.3z"/>
            </g>
        </svg>
    );
}

function ZoomControls({ parentComponent }: { parentComponent?: Component | null }) {
    const [ zoomLevel ] = useTriliumOption("zoomFactor");

    function ZoomControlButton({ command, title, icon, children, dismiss }: { command: KeyboardActionNames, title: string, icon?: string, children?: ComponentChildren, dismiss?: boolean }) {
        const linkRef = useRef<HTMLAnchorElement>(null);
        useStaticTooltipWithKeyboardShortcut(linkRef, title, command, {
            placement: "bottom",
            fallbackPlacements: [ "bottom" ]
        });
        return (
            <a
                ref={linkRef}
                tabIndex={0}
                onClick={(e) => {
                    parentComponent?.triggerCommand(command);
                    if (!dismiss) {
                        e.stopPropagation();
                    }
                }}
                className={`dropdown-item-button ${icon}`}
            >{children}</a>
        );
    }

    return isElectron() ? (
        <FormListItem
            icon="bx bx-empty"
            container
            className="zoom-container"
            onClick={(e) => e.stopPropagation()}
        >
            {t("global_menu.zoom")}
            <>
                <div className="zoom-buttons">
                    <ZoomControlButton command="toggleFullscreen" title={t("global_menu.toggle_fullscreen")} icon="bx bx-expand-alt" dismiss />
                    &nbsp;
                    <ZoomControlButton command="zoomOut" title={t("global_menu.zoom_out")} icon="bx bx-minus" />
                    <ZoomControlButton command="zoomReset" title={t("global_menu.reset_zoom_level")}>{(parseFloat(zoomLevel) * 100).toFixed(0)}{t("units.percentage")}</ZoomControlButton>
                    <ZoomControlButton command="zoomIn" title={t("global_menu.zoom_in")} icon="bx bx-plus" />
                </div>
            </>
        </FormListItem>
    ) : (
        <MenuItem icon="bx bx-expand-alt" command="toggleFullscreen" text={t("global_menu.toggle_fullscreen")} />
    );
}

function ToggleWindowOnTop() {
    const focusedWindow = isElectron() ? dynamicRequire("@electron/remote").BrowserWindow.getFocusedWindow() : null;
    const [ isAlwaysOnTop, setIsAlwaysOnTop ] = useState(focusedWindow?.isAlwaysOnTop());

    return (isElectron() &&
        <MenuItem
            icon="bx bx-pin"
            text={t("title_bar_buttons.window-on-top")}
            active={isAlwaysOnTop}
            command={() => {
                const newState = !isAlwaysOnTop;
                focusedWindow?.setAlwaysOnTop(newState);
                setIsAlwaysOnTop(newState);
            }}
        />
    );
}

function useTriliumUpdateStatus() {
    const [ latestVersion, setLatestVersion ] = useState<string>();
    const [ checkForUpdates ] = useTriliumOptionBool("checkForUpdates");
    const isUpdateAvailable = utils.isUpdateAvailable(latestVersion, glob.triliumVersion);

    async function updateVersionStatus() {
        const RELEASES_API_URL = "https://api.github.com/repos/TriliumNext/Trilium/releases/latest";

        let latestVersion: string | undefined;
        try {
            const resp = await fetch(RELEASES_API_URL);
            const data = await resp.json();
            latestVersion = data?.tag_name?.substring(1);
        } catch (e) {
            console.warn("Unable to fetch latest version info from GitHub releases API", e);
        }

        setLatestVersion(latestVersion);
    }

    useEffect(() => {
        if (!checkForUpdates) {
            setLatestVersion(undefined);
            return;
        }

        updateVersionStatus();

        const interval = setInterval(() => updateVersionStatus(), 8 * 60 * 60 * 1000);
        return () => clearInterval(interval);
    }, [ checkForUpdates ]);

    return { isUpdateAvailable, latestVersion };
}
