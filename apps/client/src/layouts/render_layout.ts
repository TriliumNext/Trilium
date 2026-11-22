import type { LOCALE_IDS } from "@triliumnext/commons";
import { type ComponentType, h, render } from "preact";

import appContext from "../components/app_context.js";
import { initLocale } from "../services/i18n.js";
import options from "../services/options.js";
import { ParentComponent } from "../widgets/react/react_utils.js";

/**
 * Renders `Layout` at the end of the page once the options and the locale have loaded, and returns
 * its root element, for an entry point to start the app around.
 *
 * `index.ts` started the download with `/bootstrap`, so this waits only for what is left of it.
 * Components call `t()` and read options while rendering, which does not render them again once
 * either arrives. `options.ts` requested the options when it loaded.
 */
export async function renderLayout(Layout: ComponentType) {
    await Promise.all([
        options.initializedPromise,
        initLocale(window.glob.currentLocale.id as LOCALE_IDS)
    ]);

    // Rendering into `document.body` would remove the elements index.html puts there, so the layout
    // is rendered into a fragment and moved. This holds as long as the layout keeps one root
    // element: Preact would insert a replacement into the fragment, not into the page.
    const container = new DocumentFragment();
    // `appContext` is the parent component, so the layout's `useTriliumEvent()` handlers hear its events.
    render(h(ParentComponent.Provider, { value: appContext }, h(Layout, null)), container);
    const root = container.firstElementChild as HTMLElement;
    document.body.append(container);
    return root;
}
