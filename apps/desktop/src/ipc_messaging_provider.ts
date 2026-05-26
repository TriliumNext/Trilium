import type { WebSocketMessage } from "@triliumnext/commons";
import type { ClientMessageHandler, MessagingProvider } from "@triliumnext/core";
import log from "@triliumnext/server/src/services/log.js";
import electron from "electron";

/**
 * Electron-IPC-backed implementation of MessagingProvider — the desktop
 * replacement for the WebSocket-based provider used by the standalone server
 * build.
 *
 * The traditional WebSocket transport opens a TCP socket on the desktop's
 * HTTP listener and used to rely on a process-wide `isElectron` flag to skip
 * the session-cookie check, which made the endpoint accessible to anything
 * that could reach the port (LAN, DNS-rebound browser, co-resident process).
 *
 * This provider replaces that channel with `webContents.send` /
 * `ipcMain.on`, which are inherently scoped to the BrowserWindow's renderer
 * process — no port is bound and no cross-origin reach is possible. Each
 * BrowserWindow is treated as a separate "client" keyed by `webContents.id`,
 * mirroring the WS provider's per-connection identity.
 */
const IPC_FROM_RENDERER = "trilium-ws-from-renderer";
const IPC_TO_RENDERER = "trilium-ws-message";

export default class IpcMessagingProvider implements MessagingProvider {
    private clientMessageHandler?: ClientMessageHandler;

    init(): void {
        electron.ipcMain.on(IPC_FROM_RENDERER, async (event, message: unknown) => {
            // The renderer-side bridge passes structured-clonable objects, but
            // accept JSON strings too so the wire format matches the WS path
            // bit-for-bit (legacy callers in client code still stringify).
            const parsed = typeof message === "string" ? safeParse(message) : message;
            if (parsed === undefined) {
                return;
            }
            if (this.clientMessageHandler) {
                try {
                    await this.clientMessageHandler(String(event.sender.id), parsed);
                } catch (err) {
                    log.error(`IPC messaging: handler threw: ${err}`);
                }
            }
        });
    }

    setClientMessageHandler(handler: ClientMessageHandler): void {
        this.clientMessageHandler = handler;
    }

    sendMessageToAllClients(message: WebSocketMessage, dbId?: string): void {
        // Match the WS provider's log-filtering so noisy sync-failed /
        // api-log-messages traffic doesn't flood the log.
        if (message.type !== "sync-failed" && message.type !== "api-log-messages") {
            log.info(`Sending message to ${dbId ? `db:${dbId}` : "all"} windows: ${JSON.stringify(message)}`);
        }

        for (const win of electron.BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue;
            // Multi-workspace: each renderer is loaded as
            // `trilium-app://app/?dbId=<workspace>`. Scope the broadcast to
            // matching windows so a transaction in workspace A doesn't ping
            // workspace B's UI. Windows without a dbId (the default workspace
            // window) still receive every broadcast — preserves single-DB
            // behaviour exactly.
            if (dbId !== undefined) {
                const windowDbId = getWindowDbId(win);
                if (windowDbId && windowDbId !== dbId) continue;
            }
            win.webContents.send(IPC_TO_RENDERER, message);
        }
    }

    sendMessageToClient(clientId: string, message: WebSocketMessage): boolean {
        const id = Number(clientId);
        if (!Number.isFinite(id)) {
            return false;
        }
        const win = electron.BrowserWindow.getAllWindows()
            .find(w => w.webContents.id === id);
        if (!win || win.isDestroyed()) {
            return false;
        }
        win.webContents.send(IPC_TO_RENDERER, message);
        return true;
    }

    getClientCount(): number {
        return electron.BrowserWindow.getAllWindows()
            .filter(w => !w.isDestroyed())
            .length;
    }

    dispose(): void {
        electron.ipcMain.removeAllListeners(IPC_FROM_RENDERER);
    }
}

function safeParse(message: string): unknown {
    try {
        return JSON.parse(message);
    } catch (err) {
        log.error(`IPC messaging: discarding non-JSON renderer message: ${err}`);
        return undefined;
    }
}

/**
 * Reads the dbId of a workspace window straight from its current URL — the
 * window is loaded as `trilium-app://app/?dbId=<workspace>` by
 * `createWorkspaceWindow`, so the query string is the single source of truth
 * and no extra registry has to stay in sync.
 */
function getWindowDbId(win: electron.BrowserWindow): string | null {
    try {
        const url = win.webContents.getURL();
        if (!url) return null;
        return new URL(url).searchParams.get("dbId");
    } catch {
        return null;
    }
}
