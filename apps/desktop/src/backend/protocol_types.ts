import type { OptionNames, WebSocketMessage } from "@triliumnext/commons";

/**
 * The options the main process reads synchronously, and therefore mirrors rather
 * than asks for. `win.on("close")` decides whether to `preventDefault()` without
 * being able to await, and the Chromium switches are read before `app.ready`.
 */
export const MAIN_PROCESS_OPTIONS: OptionNames[] = [
    "disableTray",
    "closeToTray",
    "spellCheckEnabled",
    "nativeTitleBarVisible",
    "backgroundEffects",
    "launchOnStartup",
    "hideOnAutoStart",
    "spellCheckLanguageCode"
];

/**
 * The wire contract between the three parties of the out-of-process backend:
 * the Electron main process, the backend `utilityProcess`, and the renderer.
 *
 * Shared by all three, so it must stay free of `electron` and of any Node
 * built-in — the renderer half is bundled into the client.
 */

/** Sent over the `MessagePort` the renderer holds directly to the backend process. */
export interface PortRequest {
    id: number;
    method: string;
    url: string;
    headers: [string, string][];
    body?: Uint8Array;
}

export interface PortResponse {
    id: number;
    status: number;
    statusText: string;
    headers: [string, string][];
    body: Uint8Array;
}

/** Sent over `process.parentPort`, backend process to main. */
export type BackendToMain =
    | { type: "ready"; optionSnapshot: Record<string, string> }
    | { type: "crash"; message: string }
    | { type: "ws"; target: "all" | string; message: WebSocketMessage }
    | { type: "option-changed"; name: string; value: string };

/** Sent over `process.parentPort`, main to the backend process. */
export type MainToBackend =
    | { type: "client-message"; clientId: string; message: unknown };
