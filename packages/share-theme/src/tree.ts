/**
 * The script a shared page runs before it is first drawn, as the render-blocking first entry of
 * `jsToLoad`: it restores the navigation tree, so the page never shows it at another position.
 * The client build bundles it apart from `index.ts`, so it loads as one small file.
 */
import { whenActivated } from "./page/speculation.js";
import setupTreeState from "./page/tree_state.js";

// A prerendered page reads the tree's state once it is shown, not while prerendering.
whenActivated(setupTreeState);
