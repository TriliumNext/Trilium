/**
 * The Electron API is the bridge between the renderer process and Electron's
 * main process, exposed at runtime as the global `window.electronApi`.
 *
 * Unlike the Frontend and Backend Script APIs, this is **not** part of the
 * `api` global available inside script notes. Instead, frontend script notes
 * running in the Electron desktop app can reach it via `window.electronApi`
 * directly. The API is only present in desktop builds — frontend scripts that
 * use it will not work in the browser/server build or in the standalone
 * (WASM) build.
 *
 * The runtime value is wired up by the preload script in
 * `apps/desktop/src/preload.ts` via `contextBridge.exposeInMainWorld`. The
 * interface below is the contract both the preload script
 * (`satisfies ElectronApi`) and the client (`window.electronApi`) share.
 *
 * The entire API is exposed as a single global: {@link electronApi}
 *
 * @module Electron API
 */

import type {
    ElectronApi
} from "../../../packages/commons/src/lib/electron_api_interface.js";

export type {
    ElectronApi,
    ElectronClipboardApi,
    ElectronContextMenuApi,
    ElectronContextMenuParams,
    ElectronNavigationApi,
    ElectronPrintingApi,
    ElectronShellApi,
    ElectronSpellcheckApi,
    ElectronSystemIntegrationApi,
    ElectronWindowApi
} from "../../../packages/commons/src/lib/electron_api_interface.js";

/**
 * The `window.electronApi` global gives the renderer access to Electron-only
 * functionality through the preload bridge. See {@link ElectronApi} for the
 * full surface.
 *
 * Only available in the Electron desktop build — `window.electronApi` is
 * `undefined` in the browser/server build and in the standalone (WASM) build,
 * so always guard calls with `if (window.electronApi)` from frontend scripts.
 */
// @ts-expect-error - ElectronApi is exposed at runtime by the preload script;
// no constructable class exists here, so we simulate the value for TypeDoc.
export const electronApi: ElectronApi = {};
