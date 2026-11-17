import type { WebContents } from "electron";

/**
 * The script `index.html` adds in Electron with `blocking="render"`. Chromium does not paint the page
 * until it has loaded, so holding the request back holds the first paint, and `ready-to-show` with it.
 */
export const FIRST_PAINT_GATE_PATH = "/startup-gate.js";

/**
 * How long an armed window's first paint waits at most for {@link releaseFirstPaint}. Shorter than
 * the fallback of `revealOnFirstPaint()` in `window.ts`, so a renderer that never releases it still
 * paints before that fallback shows the window.
 */
const FIRST_PAINT_GATE_TIMEOUT_MS = 2000;

interface Gate {
    /** Lets the held `startup-gate.js` request through, once it has arrived. */
    proceed?: () => void;
    timeout?: ReturnType<typeof setTimeout>;
}

/** The armed gates, by `WebContents` id. */
const gates = new Map<number, Gate>();

/**
 * Holds the first paint of `webContents` until its renderer calls `releaseFirstPaint()`, which it
 * does once the layout and the note tree have rendered, so that the window shows the finished
 * interface from its first frame. Only the next page load is held: a reload paints at once.
 */
export function armFirstPaintGate(webContents: WebContents) {
    gates.set(webContents.id, {});
    webContents.once("destroyed", () => releaseFirstPaint(webContents.id));
}

/**
 * Calls `proceed` once the `startup-gate.js` request of `webContentsId` may go through: when its
 * renderer releases the gate, after {@link FIRST_PAINT_GATE_TIMEOUT_MS}, or at once if the gate is
 * not armed.
 */
export function holdFirstPaint(webContentsId: number | undefined, proceed: () => void) {
    const gate = webContentsId === undefined ? undefined : gates.get(webContentsId);
    if (webContentsId === undefined || !gate || gate.proceed) {
        proceed();
        return;
    }
    gate.proceed = proceed;
    gate.timeout = setTimeout(() => releaseFirstPaint(webContentsId), FIRST_PAINT_GATE_TIMEOUT_MS);
}

/** Opens the gate of `webContentsId`; a request that arrives afterwards goes through at once. */
export function releaseFirstPaint(webContentsId: number) {
    const gate = gates.get(webContentsId);
    if (!gate) {
        return;
    }
    gates.delete(webContentsId);
    clearTimeout(gate.timeout);
    gate.proceed?.();
}

/** Whether `url` is the request {@link holdFirstPaint} may hold. */
export function isFirstPaintGateUrl(url: string) {
    try {
        return new URL(url).pathname === FIRST_PAINT_GATE_PATH;
    } catch {
        return false;
    }
}
