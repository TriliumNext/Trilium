import DesktopLayout from "./layouts/DesktopLayout.js";
import { renderLayout } from "./layouts/render_layout.js";
import { showStartupFailure } from "./services/splash.js";

// Before the render, so the tab bar's leave full screen button is in place on the first paint.
initFullScreenDetection();

const root = await renderLayout(DesktopLayout);

// After the first render: the components that execute commands, the tabs, which wait for froca's
// note tree in any case, and the handlers of errors, links, tooltips and context menus.
void import("./desktop_startup.js")
    .then(({ startDesktop }) => startDesktop(root))
    .catch(showStartupFailure);

/** Sets `full-screen` on the body while the window, or the page in a browser, is full screen. */
function initFullScreenDetection() {
    const setFullScreen = (isFullScreen: boolean) => {
        document.body.classList.toggle("full-screen", isFullScreen);
    };

    const win = window.electronApi?.window;
    if (win) {
        setFullScreen(win.isFullScreen());
        win.onEnterFullScreen(() => setFullScreen(true));
        win.onLeaveFullScreen(() => setFullScreen(false));
        return;
    }

    document.addEventListener("fullscreenchange", () => {
        setFullScreen(document.fullscreenElement === document.documentElement);
    });
}
