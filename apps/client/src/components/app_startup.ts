import bundleService from "../services/bundle.js";
import { setupClipboardImageEmbed } from "../services/clipboard_image_embed.js";
import froca from "../services/froca.js";
import glob from "../services/glob.js";
import { t } from "../services/i18n.js";
import keyboardActionsService from "../services/keyboard_actions.js";
import { setupLinkHandlers } from "../services/link.js";
import toastService from "../services/toast.js";
import utils from "../services/utils.js";
import { preloadCommonNoteTypes } from "../widgets/note_types.js";
import appContext from "./app_context.js";
import Entrypoints from "./entrypoints.js";
import MainTreeExecutors from "./main_tree_executors.js";
import MobileScreenSwitcherExecutor from "./mobile_screen_switcher.js";
import RootCommandExecutor from "./root_command_executor.js";
import ShortcutComponent from "./shortcut_component.js";
import { StartupChecks } from "./startup_checks.js";
import TabManager from "./tab_manager.js";
import zoomComponent from "./zoom.js";

/**
 * Builds the application on top of `appContext` around `root`, a layout that Preact has already
 * rendered: sets up the globals, the components that execute commands and the handlers of links and
 * pasted images, restores the tabs once froca has the note tree, then preloads the common note
 * types. A failure to start shows a critical error. Resolves to whether the app started.
 *
 * `mobile.ts` calls it after the first render, and `desktop_startup.ts`, which adds what only the
 * desktop layout has. Only an entry point imports this module. `app_context.ts` holds the command
 * and event bus that services import, so it must not import the components that are built here.
 */
export async function startAppAroundLayout(root: HTMLElement) {
    glob.setupGlobs();
    initComponents();
    keyboardActionsService.updateDisplayedShortcuts($(root));
    appContext.triggerEvent("initialRenderComplete", {});
    setupClipboardImageEmbed();
    setupLinkHandlers();

    try {
        await froca.initializedPromise;
        await appContext.tabManager.loadTabs();
    } catch (e) {
        toastService.showPersistent({
            id: "critical-error",
            title: t("toast.critical-error.title"),
            icon: "alert",
            message: t("toast.critical-error.message", { message: e instanceof Error ? e.message : String(e) })
        });
        console.error("Critical error occured", e);
        return false;
    }

    setTimeout(() => bundleService.executeStartupBundles(), 2000);
    preloadCommonNoteTypes();
    return true;
}

function initComponents() {
    appContext.tabManager = new TabManager();

    appContext.components = [
        appContext.tabManager,
        new RootCommandExecutor(),
        new Entrypoints(),
        new MainTreeExecutors(),
        new ShortcutComponent(),
        new StartupChecks()
    ];

    if (utils.isMobile()) {
        appContext.components.push(new MobileScreenSwitcherExecutor());
    }

    for (const component of appContext.components) {
        appContext.child(component);
    }

    if (utils.isElectron()) {
        appContext.child(zoomComponent);
    }

    void keyboardActionsService.setupWindowShortcuts();
}
