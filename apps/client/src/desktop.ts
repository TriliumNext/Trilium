import "autocomplete.js/index_jquery.js";

import type { ElectronWindowApi } from "@triliumnext/commons";

import appContext, { type CommandNames } from "./components/app_context.js";
import electronContextMenu from "./menus/electron_context_menu.js";
import bundleService from "./services/bundle.js";
import glob from "./services/glob.js";
import { t } from "./services/i18n.js";
import { syncNativeWindowWithTheme } from "./services/native_window.js";
import noteAutocompleteService from "./services/note_autocomplete.js";
import noteTooltipService from "./services/note_tooltip.js";
import { setBackgroundEffectsSuspended } from "./services/theme.js";
import toastService from "./services/toast.js";
import utils from "./services/utils.js";

await appContext.earlyInit();

bundleService.getWidgetBundlesByParent().then(async (widgetBundles) => {
    // A dynamic import is required for layouts since they initialize components which require translations.
    const DesktopLayout = (await import("./layouts/desktop_layout.js")).default;

    appContext.setLayout(new DesktopLayout(widgetBundles));
    appContext.start().then(reportFullRenderStartupMetric).catch((e) => {
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

    syncNativeWindowWithTheme();
    initFullScreenDetection(win);
    initDevToolsDockDetection(win);

    // With an "auto" theme the effective colors of background effects and the native title bar
    // follow the OS color scheme.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncNativeWindowWithTheme);

    // Clear navigation history on frontend refresh.
    api.navigation.clearNavigationHistory();
}

/**
 * Tells the Electron main process that the client finished its initial render
 * (layout widgets attached, froca loaded, tab restoration started) so it gets
 * logged against the other startup metrics. The double requestAnimationFrame
 * defers the report until the browser has painted a frame of the rendered
 * layout, rather than measuring DOM construction only. No-op outside Electron.
 */
function reportFullRenderStartupMetric() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            window.electronApi?.window.reportStartupMetric("client-full-render");
        });
    });
}

function initFullScreenDetection(win: ElectronWindowApi) {
    win.onEnterFullScreen(() => document.body.classList.add("full-screen"));
    win.onLeaveFullScreen(() => document.body.classList.remove("full-screen"));
}

/**
 * Chromium disables the native window material (Mica / vibrancy) while DevTools is docked into
 * the window, which would leave the transparent background effects floating over a solid void —
 * suspend them for the duration. DevTools in a separate window does not affect the material.
 */
function initDevToolsDockDetection(win: ElectronWindowApi) {
    setBackgroundEffectsSuspended(win.isDevToolsDocked());
    win.onDevToolsDockChanged(setBackgroundEffectsSuspended);
}
