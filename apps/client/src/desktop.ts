import type { LOCALE_IDS } from "@triliumnext/commons";
import { h, render } from "preact";

import DesktopLayout from "./layouts/DesktopLayout.js";
import { initLocale } from "./services/i18n.js";

// `index.ts` started the download with `/bootstrap`, so this waits only for what is left of it.
// Components call `t()` while rendering, which does not render them again once strings arrive.
await initLocale(window.glob.currentLocale.id as LOCALE_IDS);

// Rendering into `document.body` would remove the elements index.html puts there, so the layout
// is rendered into a fragment and moved. This holds as long as `DesktopLayout` keeps one root
// element: Preact would insert a replacement into the fragment, not into the page.
const container = new DocumentFragment();
render(h(DesktopLayout, null), container);
document.body.append(container);

// After the first render, so `link.ts` and its imports stay off the first paint.
void import("./services/link.js").then(({ setupLinkHandlers }) => setupLinkHandlers());
