import bundleService from "../services/bundle.js";
import froca from "../services/froca.js";
import keyboardActionsService from "../services/keyboard_actions.js";
import utils from "../services/utils.js";
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
 * rendered: creates the components that execute commands, then restores the tabs once froca has the
 * note tree. `desktop_startup.ts` and `mobile_startup.ts` call it after the first render.
 *
 * Only an entry point imports this module. `app_context.ts` holds the command and event bus that
 * services import, so it must not import the components that are built here.
 */
export async function startAppAroundLayout(root: HTMLElement) {
    initComponents();
    keyboardActionsService.updateDisplayedShortcuts($(root));
    appContext.triggerEvent("initialRenderComplete", {});

    await froca.initializedPromise;
    await appContext.tabManager.loadTabs();

    setTimeout(() => bundleService.executeStartupBundles(), 2000);
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
