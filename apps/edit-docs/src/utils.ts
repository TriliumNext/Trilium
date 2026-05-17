import { BackupService, type ImageProvider,initializeCore } from "@triliumnext/core";
import ClsHookedExecutionContext from "@triliumnext/server/src/cls_provider.js";
import NodejsCryptoProvider from "@triliumnext/server/src/crypto_provider.js";
import ServerPlatformProvider from "@triliumnext/server/src/platform_provider.js";
import windowService from "@triliumnext/server/src/services/window.js";
import WebSocketMessagingProvider from "@triliumnext/server/src/services/ws_messaging_provider.js";
import BetterSqlite3Provider from "@triliumnext/server/src/sql_provider.js";
import NodejsZipProvider from "@triliumnext/server/src/zip_provider.js";
import archiver, { type Archiver } from "archiver";
import electron from "electron";
import { createWriteStream, readFileSync, type WriteStream } from "fs";
import fs from "fs/promises";
import path from "path";

import { deferred, type DeferredPromise } from "../../../packages/commons/src/index.js";

// Stub backup service (not used in edit-docs, but required by initializeCore)
class StubBackupService extends BackupService {
    constructor() {
        super({ getOption: () => "", getOptionBool: () => false, setOption: () => {} });
    }
    scheduleBackups(): void {}
    async backupNow(_name: string): Promise<string> {
        throw new Error("Backup not supported in edit-docs");
    }
    async getExistingBackups() {
        return [];
    }
    async getBackupContent(_filePath: string): Promise<Uint8Array | null> {
        return null;
    }
}

// Stub image provider (not used in edit-docs, but required by initializeCore)
const stubImageProvider: ImageProvider = {
    getImageType: () => null,
    processImage: async () => {
        throw new Error("Image processing not supported in edit-docs");
    }
};

export async function initializeEditDocsCore() {
    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromMemory();

    const { serverZipExportProviderFactory } = await import("@triliumnext/server/src/services/export/zip/factory.js");

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: false,
            async onTransactionCommit() {
                const ws = (await import("@triliumnext/server/src/services/ws.js")).default;
                ws.sendTransactionEntityChangesToAllClients();
            },
            onTransactionRollback: () => {}
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: serverZipExportProviderFactory,
        executionContext: new ClsHookedExecutionContext(),
        platform: new ServerPlatformProvider(),
        schema: readFileSync(require.resolve("@triliumnext/core/src/assets/schema.sql"), "utf-8"),
        translations: (await import("@triliumnext/server/src/services/i18n.js")).initializeTranslationsWithParams,
        messaging: new WebSocketMessagingProvider(),
        getDemoArchive: async () => null,
        backup: new StubBackupService(),
        image: stubImageProvider
    });
}

/**
 * Electron has a behaviour in which the "ready" event must have a listener attached before it gets to initialize.
 * If async tasks are awaited before the "ready" event is bound, then the window will never shown.
 * This method works around by creating a deferred promise. It will immediately bind to the "ready" event and wait for that promise to be resolved externally.
 *
 * @param callback a method to be called after the server and Electron is initialized.
 * @returns the deferred promise that must be resolved externally before the Electron app is started.
 */
export function startElectron(callback: () => void): DeferredPromise<void> {
    const initializedPromise = deferred<void>();

    const readyHandler = async () => {
        await initializedPromise;

        // Start the server.
        const startTriliumServer = (await import("@triliumnext/server/src/www.js")).default;
        await startTriliumServer();

        // Create the main window.
        await windowService.createMainWindow(electron.app);

        callback();
    };

    // Handle race condition: Electron ready event may have already fired
    if (electron.app.isReady()) {
        readyHandler();
    } else {
        electron.app.on("ready", readyHandler);
    }

    return initializedPromise;
}

export async function importData(path: string) {
    const buffer = await createImportZip(path);
    const { zipImportService, TaskContext, becca } = (await import("@triliumnext/core"));
    const context = new TaskContext("no-progress-reporting", "importNotes", null);

    const rootNote = becca.getRoot();
    if (!rootNote) {
        throw new Error("Missing root note for import.");
    }
    await zipImportService.importZip(context, buffer, rootNote, {
        preserveIds: true
    });
}

async function createImportZip(path: string) {
    const inputFile = "input.zip";
    const archive = archiver("zip", {
        zlib: { level: 0 }
    });

    archive.directory(path, "/");

    const outputStream = createWriteStream(inputFile);
    archive.pipe(outputStream);
    await waitForEnd(archive, outputStream);

    try {
        return await fs.readFile(inputFile);
    } finally {
        await fs.rm(inputFile);
    }
}

function waitForEnd(archive: Archiver, stream: WriteStream) {
    return new Promise<void>((res, rej) => {
        stream.on("finish", res);
        stream.on("error", rej);
        archive.on("error", rej);
        archive.finalize().catch(rej);
    });
}

export async function createZipFromDirectory(dirPath: string, zipPath: string) {
    const archive = archiver("zip", { zlib: { level: 5 } });
    const outputStream = createWriteStream(zipPath);
    archive.directory(dirPath, false);
    archive.pipe(outputStream);
    await waitForEnd(archive, outputStream);
}

export async function extractZip(zipFilePath: string, outputPath: string, ignoredFiles?: Set<string>) {
    const promise = deferred<void>();
    setTimeout(async () => {
        const { getZipProvider } = (await import("@triliumnext/core"));
        const zipProvider = getZipProvider();
        const buffer = await fs.readFile(zipFilePath);
        await zipProvider.readZipFile(buffer, async (entry, readContent) => {
            // We ignore directories since they can appear out of order anyway.
            if (!entry.fileName.endsWith("/") && !ignoredFiles?.has(entry.fileName)) {
                const destPath = path.join(outputPath, entry.fileName);
                const fileContent = await readContent();

                await fs.mkdir(path.dirname(destPath), { recursive: true });
                await fs.writeFile(destPath, fileContent);
            }
        });
        promise.resolve();
    }, 1000);
    await promise;
}
