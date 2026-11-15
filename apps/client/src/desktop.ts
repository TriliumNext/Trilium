import { h, render } from "preact";

import DesktopLayout from "./layouts/DesktopLayout.js";

// Rendering into `document.body` would remove the elements index.html puts there, so the layout
// is rendered into a fragment and moved. This holds as long as `DesktopLayout` keeps one root
// element: Preact would insert a replacement into the fragment, not into the page.
const container = new DocumentFragment();
render(h(DesktopLayout, null), container);
document.body.append(container);

// After the first render, so `link.ts` and its imports stay off the first paint.
void import("./services/link.js").then(({ setupLinkHandlers }) => setupLinkHandlers());
