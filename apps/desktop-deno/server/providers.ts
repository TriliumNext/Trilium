/**
 * Small Deno-native implementations of trilium-core's provider interfaces.
 * Anything platform-neutral (crypto, zip, CLS, image, in-app help, request)
 * is reused from `apps/standalone/src/lightweight/` instead — those are pure
 * JS and run unchanged under Deno.
 */

import type i18next from "i18next";

import type { LOCALE_IDS } from "@triliumnext/commons";
import type { DatabaseBackup } from "@triliumnext/commons";
import { BackupService, type BackupOptionsService, type ClientMessageHandler, type MessageHandler, type MessagingProvider, type PlatformProvider } from "@triliumnext/core";

import type DenoSqlProvider from "./sql_provider.ts";

export class DenoPlatformProvider implements PlatformProvider {
    readonly isElectron = false;
    readonly isMac = Deno.build.os === "darwin";
    readonly isWindows = Deno.build.os === "windows";
    readonly isLinux = Deno.build.os === "linux";

    crash(message: string): void {
        console.error(`FATAL: ${message}`);
        Deno.exit(1);
    }

    getEnv(key: string): string | undefined {
        return Deno.env.get(key);
    }
}

/** WebSocket-backed messaging: the desktop client connects like it would to the Node server. */
export class DenoMessagingProvider implements MessagingProvider {
    private sockets = new Map<string, WebSocket>();
    private messageHandlers: MessageHandler[] = [];
    private clientMessageHandler?: ClientMessageHandler;
    private clientCounter = 0;

    /** Called by the HTTP layer for each upgraded connection. */
    addSocket(socket: WebSocket): void {
        const clientId = `client-${++this.clientCounter}`;
        this.sockets.set(clientId, socket);

        socket.addEventListener("message", (event) => {
            let message: unknown;
            try {
                message = JSON.parse(String(event.data));
            } catch (e) {
                console.error("[Messaging] Ignoring unparseable client message:", e);
                return;
            }
            try {
                this.clientMessageHandler?.(clientId, message);
                for (const handler of this.messageHandlers) {
                    handler(message as never);
                }
            } catch (e) {
                console.error("[Messaging] Client message handler failed:", e);
            }
        });
        socket.addEventListener("close", () => this.sockets.delete(clientId));
        socket.addEventListener("error", () => this.sockets.delete(clientId));
    }

    sendMessageToAllClients(message: unknown): void {
        const data = JSON.stringify(message);
        for (const socket of this.sockets.values()) {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(data);
            }
        }
    }

    sendMessageToClient(clientId: string, message: unknown): boolean {
        const socket = this.sockets.get(clientId);
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return false;
        }
        socket.send(JSON.stringify(message));
        return true;
    }

    setClientMessageHandler(handler: ClientMessageHandler): void {
        this.clientMessageHandler = handler;
    }

    onMessage(handler: MessageHandler): () => void {
        this.messageHandlers.push(handler);
        return () => {
            this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
        };
    }

    getClientCount(): number {
        return this.sockets.size;
    }

    dispose(): void {
        for (const socket of this.sockets.values()) {
            socket.close();
        }
        this.sockets.clear();
    }
}

/** Backups as ordinary files under the data directory, via VACUUM INTO. */
export class DenoBackupService extends BackupService {
    constructor(
        options: BackupOptionsService,
        private sqlProvider: DenoSqlProvider,
        private backupDir: string
    ) {
        super(options);
    }

    override async backupNow(name: string): Promise<string> {
        await Deno.mkdir(this.backupDir, { recursive: true });
        const filePath = `${this.backupDir}/backup-${name}.db`;
        this.sqlProvider.backup(filePath);
        return filePath;
    }

    override scheduleBackups(): void {
        // Prototype: no scheduled backups.
    }

    override async getExistingBackups(): Promise<DatabaseBackup[]> {
        const backups: DatabaseBackup[] = [];
        let entries;
        try {
            entries = Deno.readDir(this.backupDir);
        } catch {
            return backups;
        }
        for await (const entry of entries) {
            if (!entry.isFile || !entry.name.startsWith("backup-") || !entry.name.endsWith(".db")) {
                continue;
            }
            const filePath = `${this.backupDir}/${entry.name}`;
            const stat = await Deno.stat(filePath);
            backups.push({
                fileName: entry.name,
                filePath,
                mtime: stat.mtime ?? new Date(0),
                fileSize: stat.size
            });
        }
        return backups;
    }

    override async getBackupContent(filePath: string): Promise<Uint8Array | null> {
        try {
            return await Deno.readFile(filePath);
        } catch {
            return null;
        }
    }
}

/** i18next backend reading server translations straight from disk. */
export function createTranslationProvider(translationsDir: string) {
    return async function denoTranslationProvider(i18nextInstance: typeof i18next, locale: LOCALE_IDS) {
        const backend = {
            type: "backend" as const,
            init() {},
            read(lng: string, ns: string, callback: (err: unknown, data: unknown) => void) {
                Deno.readTextFile(`${translationsDir}/${lng}/${ns}.json`)
                    .then((text) => callback(null, JSON.parse(text)))
                    .catch((err) => callback(err, null));
            }
        };
        await i18nextInstance.use(backend as never).init({
            lng: locale,
            fallbackLng: "en",
            ns: "server",
            returnEmptyString: false
        });
    };
}
