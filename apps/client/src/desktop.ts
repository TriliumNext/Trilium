import type { LOCALE_IDS } from "@triliumnext/commons";
import { h, render } from "preact";

import appContext from "./components/app_context.js";
import DesktopLayout from "./layouts/DesktopLayout.js";
import { initLocale } from "./services/i18n.js";
import options from "./services/options.js";
import { ParentComponent } from "./widgets/react/react_utils.js";

// Before the render, so the tab bar's leave full screen button is in place on the first paint.
initFullScreenDetection();

// `index.ts` started the download with `/bootstrap`, so this waits only for what is left of it.
// Components call `t()` and read options while rendering, which does not render them again once
// either arrives. `options.ts` requested the options when it loaded.
await Promise.all([
    options.initializedPromise,
    initLocale(window.glob.currentLocale.id as LOCALE_IDS)
]);

// Rendering into `document.body` would remove the elements index.html puts there, so the layout
// is rendered into a fragment and moved. This holds as long as `DesktopLayout` keeps one root
// element: Preact would insert a replacement into the fragment, not into the page.
const container = new DocumentFragment();
// `appContext` is the parent component, so the layout's `useTriliumEvent()` handlers hear its events.
render(h(ParentComponent.Provider, { value: appContext }, h(DesktopLayout, null)), container);
const root = container.firstElementChild as HTMLElement;
document.body.append(container);

// After the first render: the components that execute commands, the tabs, which wait for froca's
// note tree in any case, and the handlers of errors, links, tooltips and context menus.
void import("./desktop_startup.js").then(({ startDesktop }) => startDesktop(root));

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
