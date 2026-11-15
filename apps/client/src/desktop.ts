import type { LOCALE_IDS } from "@triliumnext/commons";
import { h, render } from "preact";

import appContext from "./components/app_context.js";
import DesktopLayout from "./layouts/DesktopLayout.js";
import froca from "./services/froca.js";
import { initLocale } from "./services/i18n.js";
import { ParentComponent } from "./widgets/react/react_utils.js";

// `index.ts` started the download with `/bootstrap`, so this waits only for what is left of it.
// Components call `t()` while rendering, which does not render them again once strings arrive.
await initLocale(window.glob.currentLocale.id as LOCALE_IDS);

// Rendering into `document.body` would remove the elements index.html puts there, so the layout
// is rendered into a fragment and moved. This holds as long as `DesktopLayout` keeps one root
// element: Preact would insert a replacement into the fragment, not into the page.
const container = new DocumentFragment();
// `appContext` is the parent component, so the layout's `useTriliumEvent()` handlers hear its events.
render(h(ParentComponent.Provider, { value: appContext }, h(DesktopLayout, null)), container);
document.body.append(container);

// After the first render, so `link.ts` and its imports stay off the first paint.
void import("./services/link.js").then(({ setupLinkHandlers }) => setupLinkHandlers());

// After the first render as well: restoring the tabs waits for froca's note tree in any case.
void import("./components/tab_manager.js").then(async ({ default: TabManager }) => {
    const tabManager = new TabManager();
    appContext.tabManager = tabManager;
    appContext.components.push(tabManager);
    appContext.child(tabManager);

    await froca.initializedPromise;
    await tabManager.loadTabs();
});
