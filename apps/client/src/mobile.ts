import { h, render } from "preact";

import MobileLayout from "./layouts/MobileLayout.js";

// Rendering into `document.body` would remove the elements index.html puts there, so the layout
// is rendered into a fragment and moved. This holds as long as `MobileLayout` keeps one root
// element: Preact would insert a replacement into the fragment, not into the page.
const container = new DocumentFragment();
render(h(MobileLayout, null), container);
document.body.append(container);
