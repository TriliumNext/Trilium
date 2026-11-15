import type { LOCALE_IDS } from "@triliumnext/commons";
import { h, render } from "preact";

import appContext from "./components/app_context.js";
import MobileLayout from "./layouts/MobileLayout.js";
import { initLocale } from "./services/i18n.js";
import options from "./services/options.js";
import { ParentComponent } from "./widgets/react/react_utils.js";

// `index.ts` started the download with `/bootstrap`, so this waits only for what is left of it.
// Components call `t()` and read options while rendering, which does not render them again once
// either arrives. `options.ts` requested the options when it loaded.
await Promise.all([
    options.initializedPromise,
    initLocale(window.glob.currentLocale.id as LOCALE_IDS)
]);

// Rendering into `document.body` would remove the elements index.html puts there, so the layout
// is rendered into a fragment and moved. This holds as long as `MobileLayout` keeps one root
// element: Preact would insert a replacement into the fragment, not into the page.
const container = new DocumentFragment();
// `appContext` is the parent component, so the layout's `useTriliumEvent()` handlers hear its events.
render(h(ParentComponent.Provider, { value: appContext }, h(MobileLayout, null)), container);
document.body.append(container);
