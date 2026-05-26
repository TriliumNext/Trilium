import { protocol } from "electron";

/**
 * Registers the `trilium-app://` custom scheme as privileged so the renderer
 * can load the UI from `trilium-app://app/` with a proper origin & cookie jar,
 * fetch support, and CORS. The actual request handler is installed elsewhere
 * (apps/server/src/routes/electron.ts), once `app.ready` has fired.
 *
 * **Must be called before `app.ready`.** Electron only honours
 * `registerSchemesAsPrivileged` if it runs synchronously during startup;
 * otherwise Chromium treats the scheme as non-standard with an opaque origin
 * and aborts navigation with `(blocked:origin)`.
 *
 * Shared between `apps/desktop` (main entry) and `apps/edit-docs`
 * (edit-docs / edit-demo entry).
 */
export function registerTriliumAppScheme() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: "trilium-app",
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                corsEnabled: true
            }
        }
    ]);
}
