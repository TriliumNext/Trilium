import { JSDOM } from "jsdom";
import type paperFull from "paper";
import type * as PaperOffsetModule from "paperjs-offset";

/*
 * Paper.js reads the global `self` once, when it loads. Handed a jsdom window, it asks the window
 * for a canvas that jsdom cannot provide without the native `canvas` package, and fails. A document
 * without a window is enough for `importSVG()` and keeps paper.js off the canvas. `paperjs-offset`
 * loads paper.js itself, so it is loaded here too, after `self` is in place.
 */
const { window } = new JSDOM("<html><body></body></html>");
const globals = globalThis as { self?: unknown };
globals.self = {
    navigator: window.navigator,
    document: window.document,
    DOMParser: window.DOMParser
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const paper: typeof paperFull = require("paper");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PaperOffset }: typeof PaperOffsetModule = require("paperjs-offset");

delete globals.self;

export { paper, PaperOffset };
