import "autocomplete.js/index_jquery.js";

import type ElectronRemote from "@electron/remote";
import type Electron from "electron";

import appContext from "./components/app_context.js";
import electronContextMenu from "./menus/electron_context_menu.js";
import bundleService from "./services/bundle.js";
import glob from "./services/glob.js";
import { t } from "./services/i18n.js";
import noteAutocompleteService from "./services/note_autocomplete.js";
import noteTooltipService from "./services/note_tooltip.js";
import options from "./services/options.js";
import toastService from "./services/toast.js";
import utils from "./services/utils.js";

await appContext.earlyInit();

bundleService.getWidgetBundlesByParent().then(async (widgetBundles) => {
    // A dynamic import is required for layouts since they initialize components which require translations.
    const DesktopLayout = (await import("./layouts/desktop_layout.js")).default;

    appContext.setLayout(new DesktopLayout(widgetBundles));
    appContext.start().catch((e) => {
        toastService.showPersistent({
            id: "critical-error",
            title: t("toast.critical-error.title"),
            icon: "alert",
            message: t("toast.critical-error.message", { message: e.message })
        });
        console.error("Critical error occured", e);
    });
});

glob.setupGlobs();

if (utils.isElectron()) {
    initOnElectron();
}

noteTooltipService.setupGlobalTooltip();

noteAutocompleteService.init();

if (utils.isElectron()) {
    electronContextMenu.setupContextMenu();
}

if (utils.isPWA()) {
    initPWATopbarColor();
}

function initOnElectron() {
    const electron: typeof Electron = utils.dynamicRequire("electron");
    electron.ipcRenderer.on("globalShortcut", async (event, actionName) => appContext.triggerCommand(actionName));
    electron.ipcRenderer.on("openInSameTab", async (event, noteId) => appContext.tabManager.openInSameTab(noteId));
    const electronRemote: typeof ElectronRemote = utils.dynamicRequire("@electron/remote");
    const currentWindow = electronRemote.getCurrentWindow();
    const style = window.getComputedStyle(document.body);

    initDarkOrLightMode(style);
    initTransparencyEffects(style, currentWindow);
    initFullScreenDetection(currentWindow);

    if (options.get("nativeTitleBarVisible") !== "true") {
        initTitleBarButtons(style, currentWindow);
    }

    // Clear navigation history on frontend refresh.
    currentWindow.webContents.navigationHistory.clear();
}

function initTitleBarButtons(style: CSSStyleDeclaration, currentWindow: Electron.BrowserWindow) {
    if (window.glob.platform === "win32") {
        const applyWindowsOverlay = () => {
            const color = style.getPropertyValue("--native-titlebar-background");
            const symbolColor = style.getPropertyValue("--native-titlebar-foreground");
            if (color && symbolColor) {
                currentWindow.setTitleBarOverlay({ color, symbolColor });
            }
        };

        applyWindowsOverlay();

        // Register for changes to the native title bar colors.
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyWindowsOverlay);
    }

    if (window.glob.platform === "darwin") {
        const xOffset = parseInt(style.getPropertyValue("--native-titlebar-darwin-x-offset"), 10);
        const yOffset = parseInt(style.getPropertyValue("--native-titlebar-darwin-y-offset"), 10);
        currentWindow.setWindowButtonPosition({ x: xOffset, y: yOffset });
    }
}

function initFullScreenDetection(currentWindow: Electron.BrowserWindow) {
    currentWindow.on("enter-full-screen", () => document.body.classList.add("full-screen"));
    currentWindow.on("leave-full-screen", () => document.body.classList.remove("full-screen"));
}

function initTransparencyEffects(style: CSSStyleDeclaration, currentWindow: Electron.BrowserWindow) {
    if (window.glob.platform === "win32") {
        const material = style.getPropertyValue("--background-material");
        // TriliumNextTODO: find a nicer way to make TypeScript happy – unfortunately TS did not like Array.includes here
        const bgMaterialOptions = ["auto", "none", "mica", "acrylic", "tabbed"] as const;
        const foundBgMaterialOption = bgMaterialOptions.find((bgMaterialOption) => material === bgMaterialOption);
        if (foundBgMaterialOption) {
            currentWindow.setBackgroundMaterial(foundBgMaterialOption);
        }
    }
}

/**
 * Informs Electron that we prefer a dark or light theme. Apart from changing prefers-color-scheme at CSS level which is a side effect,
 * this fixes color issues with background effects or native title bars.
 *
 * @param style the root CSS element to read variables from.
 */
function initDarkOrLightMode(style: CSSStyleDeclaration) {
    let themeSource: typeof nativeTheme.themeSource = "system";

    const themeStyle = style.getPropertyValue("--theme-style");
    if (style.getPropertyValue("--theme-style-auto") !== "true" && (themeStyle === "light" || themeStyle === "dark")) {
        themeSource = themeStyle;
    }

    const { nativeTheme } = utils.dynamicRequire("@electron/remote") as typeof ElectronRemote;
    nativeTheme.themeSource = themeSource;
}

function initPWATopbarColor() {
    const tracker = $("#background-color-tracker");

    if (tracker.length) {
        const applyThemeColor = () => {
            let meta = $("meta[name='theme-color']");
            if (!meta.length) {
                meta = $(`<meta name="theme-color">`).appendTo($("head"));
            }
            meta.attr("content", tracker.css("color"));
        };

        tracker.on("transitionend", applyThemeColor);
        applyThemeColor();
    }
}
