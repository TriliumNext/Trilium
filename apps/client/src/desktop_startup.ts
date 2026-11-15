import type { ElectronWindowApi } from "@triliumnext/commons";

import appContext, { type CommandNames } from "./components/app_context.js";
import { startAppAroundLayout } from "./components/app_startup.js";
import { setupContextMenu as setupBrowserContextMenu } from "./menus/browser_context_menu.js";
import { setupClipboardImageEmbed } from "./services/clipboard_image_embed.js";
import glob from "./services/glob.js";
import { t } from "./services/i18n.js";
import { setupLinkHandlers } from "./services/link.js";
import noteTooltipService from "./services/note_tooltip.js";
import { onEffectiveThemeStyleChange, setBackgroundEffectsSuspended } from "./services/theme.js";
import toastService from "./services/toast.js";
import utils from "./services/utils.js";
import { preloadCommonNoteTypes } from "./widgets/note_types.js";

/**
 * The part of the desktop startup that `desktop.ts` runs after the first render of the layout:
 * the components that execute commands, the tabs, and the handlers of errors, links, tooltips,
 * context menus and the Electron window.
 */
export async function startDesktop(root: HTMLElement) {
    glob.setupGlobs();
    const started = startAppAroundLayout(root);

    noteTooltipService.setupGlobalTooltip();
    setupClipboardImageEmbed();
    setupLinkHandlers();
    if (utils.isElectron()) {
        void initOnElectron();
    } else {
        setupBrowserContextMenu();
    }

    try {
        await started;
    } catch (e) {
        toastService.showPersistent({
            id: "critical-error",
            title: t("toast.critical-error.title"),
            icon: "alert",
            message: t("toast.critical-error.message", { message: e instanceof Error ? e.message : String(e) })
        });
        console.error("Critical error occured", e);
        return;
    }

    reportFullRenderStartupMetric();
    preloadCommonNoteTypes();
}

/** Connects the Electron window: its shortcuts, theme, DevTools dock and context menu. */
async function initOnElectron() {
    const api = window.electronApi;
    if (!api) return;

    const win = api.window;
    // The action name comes from the keyboard-actions registry in the main
    // process; runtime contract is that it's always a valid CommandNames key.
    win.onGlobalShortcut(async (actionName) => appContext.triggerCommand(actionName as CommandNames));
    win.onOpenInSameTab(async (noteId) => appContext.tabManager.openInSameTab(noteId));
    initDevToolsDockDetection(win);

    // Clear navigation history on frontend refresh.
    api.navigation.clearNavigationHistory();

    const [ { syncNativeWindowWithTheme }, { default: electronContextMenu } ] = await Promise.all([
        import("./services/native_window.js"),
        import("./menus/electron_context_menu.js")
    ]);
    syncNativeWindowWithTheme();
    // With an "auto" theme the effective colors of background effects and the native title bar
    // follow the OS color scheme.
    onEffectiveThemeStyleChange(() => syncNativeWindowWithTheme());
    electronContextMenu.setupContextMenu();
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

/**
 * Chromium disables the native window material (Mica / vibrancy) while DevTools is docked into
 * the window, which would leave the transparent background effects floating over a solid void —
 * suspend them for the duration. DevTools in a separate window does not affect the material.
 */
function initDevToolsDockDetection(win: ElectronWindowApi) {
    setBackgroundEffectsSuspended(win.isDevToolsDocked());
    win.onDevToolsDockChanged(setBackgroundEffectsSuspended);
}
