import "autocomplete.js/index_jquery.js";

import type { ElectronWindowApi } from "@triliumnext/commons";

import appContext, { type CommandNames } from "./components/app_context.js";
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

function initOnElectron() {
    const api = window.electronApi;
    if (!api) return;

    const win = api.window;
    // The action name comes from the keyboard-actions registry in the main
    // process; runtime contract is that it's always a valid CommandNames key.
    win.onGlobalShortcut(async (actionName) => appContext.triggerCommand(actionName as CommandNames));
    win.onOpenInSameTab(async (noteId) => appContext.tabManager.openInSameTab(noteId));

    const style = window.getComputedStyle(document.body);

    initDarkOrLightMode(win);
    initTransparencyEffects(win, style);
    initFullScreenDetection(win);

    if (options.get("nativeTitleBarVisible") !== "true") {
        initTitleBarButtons(win, style);
    }

    // Clear navigation history on frontend refresh.
    api.navigation.clearNavigationHistory();
}

function initTitleBarButtons(win: ElectronWindowApi, style: CSSStyleDeclaration) {
    if (window.glob.platform === "win32") {
        const applyWindowsOverlay = () => {
            const color = style.getPropertyValue("--native-titlebar-background");
            const symbolColor = style.getPropertyValue("--native-titlebar-foreground");
            if (color && symbolColor) {
                win.setTitleBarOverlay({ color, symbolColor });
            }
        };

        applyWindowsOverlay();

        // Register for changes to the native title bar colors.
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyWindowsOverlay);
    }

    if (window.glob.platform === "darwin") {
        const xOffset = parseInt(style.getPropertyValue("--native-titlebar-darwin-x-offset"), 10);
        const yOffset = parseInt(style.getPropertyValue("--native-titlebar-darwin-y-offset"), 10);
        win.setWindowButtonPosition({ x: xOffset, y: yOffset });
    }
}

function initFullScreenDetection(win: ElectronWindowApi) {
    win.onEnterFullScreen(() => document.body.classList.add("full-screen"));
    win.onLeaveFullScreen(() => document.body.classList.remove("full-screen"));
}

function initTransparencyEffects(win: ElectronWindowApi, style: CSSStyleDeclaration) {
    const material = style.getPropertyValue("--background-material").trim();
    if (window.glob.platform === "win32") {
        const bgMaterialOptions = ["auto", "none", "mica", "acrylic", "tabbed"] as const;
        const foundBgMaterialOption = bgMaterialOptions.find((bgMaterialOption) => material === bgMaterialOption);
        if (foundBgMaterialOption) {
            win.setBackgroundMaterial(foundBgMaterialOption);
        }
    }

    if (window.glob.platform === "darwin") {
        const bgMaterialOptions = [ "popover", "tooltip", "titlebar", "selection", "menu", "sidebar", "header", "sheet", "window", "hud", "fullscreen-ui", "content", "under-window", "under-page" ] as const;
        const foundBgMaterialOption = bgMaterialOptions.find((bgMaterialOption) => material === bgMaterialOption);
        if (foundBgMaterialOption) {
            win.setVibrancy(foundBgMaterialOption);
        }
    }
}

/**
 * Informs Electron that we prefer a dark or light theme. Apart from changing prefers-color-scheme at CSS level which is a side effect,
 * this fixes color issues with background effects or native title bars.
 */
function initDarkOrLightMode(win: ElectronWindowApi) {
    let themeSource: "system" | "light" | "dark" = "system";

    const themeStyle = window.glob.getThemeStyle();
    if (themeStyle !== "auto") {
        themeSource = themeStyle;
    }

    win.setNativeThemeSource(themeSource);
}
