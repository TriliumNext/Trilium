/**
 * Per-request marker for the Electron `trilium-app://` custom-protocol path.
 *
 * The desktop build runs the full Express stack inside the Electron main
 * process. The renderer makes API calls via the custom protocol (see
 * `apps/server/src/routes/electron.ts`), which dispatches a synthesised
 * request through the same Express app instance as the public HTTP listener.
 *
 * Auth and CSRF middleware historically bypassed on the process-wide
 * `isElectron` flag, which meant any TCP request to the desktop's listener
 * (LAN, DNS-rebound browser, co-resident process) shared the bypass.
 * Instead, the dispatcher tags only its own requests with this marker, and
 * middleware checks the marker — so TCP traffic is treated like any other
 * external request.
 *
 * Symbol-keyed so attacker-supplied JSON / headers cannot collide.
 */
const ELECTRON_INTERNAL_REQUEST = Symbol("trilium-electron-internal-request");

export function markAsInternalElectronRequest(req: object): void {
    (req as Record<symbol, unknown>)[ELECTRON_INTERNAL_REQUEST] = true;
}

export function isInternalElectronRequest(req: object): boolean {
    return (req as Record<symbol, unknown>)[ELECTRON_INTERNAL_REQUEST] === true;
}
