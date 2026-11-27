import type { ElectronWindowApi } from "@triliumnext/commons";

import appContext, { type CommandNames } from "./components/app_context.js";
import { startAppAroundLayout } from "./components/app_startup.js";
import { setupContextMenu as setupBrowserContextMenu } from "./menus/browser_context_menu.js";
import noteTooltipService from "./services/note_tooltip.js";
import { onEffectiveThemeStyleChange, setBackgroundEffectsSuspended } from "./services/theme.js";
import utils from "./services/utils.js";
import { noteTreeFirstRender } from "./widgets/containers/LeftPane.js";

/** How long the first paint waits at most for the note tree, once the rest of the startup is done. */
const NOTE_TREE_FIRST_RENDER_WAIT_MS = 500;

/**
 * The part of the desktop startup that `desktop.ts` runs after the first render of the layout:
 * `startAppAroundLayout()`, which both layouts run, then what only the desktop layout has, the
 * handlers of tooltips, context menus and the Electron window.
 */
export async function startDesktop(root: HTMLElement) {
    const started = startAppAroundLayout(root);

    noteTooltipService.setupGlobalTooltip();
    if (utils.isElectron()) {
        void initOnElectron();
    } else {
        setupBrowserContextMenu();
    }

    const succeeded = await started;
    const electronWindow = window.electronApi?.window;
    if (electronWindow) {
        await releaseFirstPaint(electronWindow);
    }
    if (succeeded) {
        reportFullRenderStartupMetric();
    }
}

/**
 * Lets the main window paint once the note tree has rendered too, with the entrance animations
 * finished, so that its first frame shows the settled interface. `index.html` holds that paint
 * until then. It is released on a failed startup as well, which shows its error.
 */
async function releaseFirstPaint(electronWindow: ElectronWindowApi) {
    await Promise.race([
        noteTreeFirstRender,
        new Promise((resolve) => setTimeout(resolve, NOTE_TREE_FIRST_RENDER_WAIT_MS))
    ]);
    for (const animation of document.getAnimations()) {
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
            animation.finish();
        }
    }
    electronWindow.releaseFirstPaint();
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
