import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { BackupService, getContext, type ImageProvider, initializeCore } from "@triliumnext/core";

import type { IconPackData } from "./provider";
import boxicons3 from "./providers/boxicons3";
import ckeditor from "./providers/ckeditor";
import mdi from "./providers/mdi";
import phosphor from "./providers/phosphor";

process.env.TRILIUM_INTEGRATION_TEST = "memory-no-store";
process.env.TRILIUM_RESOURCE_DIR = "../server/src";
process.env.NODE_ENV = "development";
process.env.TRILIUM_ENV = "dev";

async function main() {
    const outputDir = join(__dirname, "../../website/public/resources/icon-packs");
    const outputMetaDir = join(__dirname, "../../website/src/resources/icon-packs");
    mkdirSync(outputDir, { recursive: true });

    const {
        becca_loader, note_service: notesService, sql_init, TaskContext, zipExportService
    } = await import("@triliumnext/core");
    await sql_init.createInitialDatabase(true);
    await becca_loader.beccaLoaded;

    async function buildIconPack(iconPack: IconPackData) {
        // Create the icon pack note.
        const { note, branch } = notesService.createNewNote({
            parentNoteId: "root",
            type: "file",
            title: iconPack.name,
            mime: "application/json",
            content: JSON.stringify(iconPack.manifest)
        });
        note.setLabel("iconPack", iconPack.prefix);
        note.setLabel("iconClass", iconPack.icon);

        // Add the attachment.
        note.saveAttachment({
            role: "file",
            title: iconPack.fontFile.name,
            mime: iconPack.fontFile.mime,
            content: iconPack.fontFile.content
        });

        // Export to zip.
        const zipFileName = `${iconPack.name}.zip`;
        const zipFilePath = join(outputDir, zipFileName);
        const fileOutputStream = createWriteStream(zipFilePath);
        const taskContext = new TaskContext("no-progress-reporting", "export", null);
        await zipExportService.exportToZip(taskContext, branch, "html", fileOutputStream, false, {
            skipExtraFiles: true
        });
        await new Promise<void>((resolve) => { fileOutputStream.on("finish", resolve); });

        // Save meta.
        const metaFilePath = join(outputMetaDir, `${iconPack.name}.json`);
        writeFileSync(metaFilePath, JSON.stringify({
            name: iconPack.name,
            file: zipFileName,
            ...iconPack.meta
        }, null, 2));

        console.log(`Built icon pack ${iconPack.name}.`);
    }

    // Keyed by prefix so that a pack is only constructed when it is requested.
    const builtIconPacks: Record<string, () => IconPackData> = {
        bx3: () => boxicons3("basic"),
        bxl3: () => boxicons3("brands"),
        mdi: () => mdi(),
        ph: () => phosphor("regular"),
        "ph-fill": () => phosphor("fill")
    };
    const builtinIconPacks: Record<string, BuiltinIconPack> = {
        cke: { build: ckeditor, manifestFileName: "icon_pack_text_editor.json" }
    };

    // Prefixes given on the command line (`pnpm start cke`) build only those packs.
    const requested = process.argv.slice(2);
    const isRequested = (prefix: string) => !requested.length || requested.includes(prefix);
    await Promise.all(Object.entries(builtIconPacks)
        .filter(([ prefix ]) => isRequested(prefix))
        .map(([ prefix, build ]) => buildIconPack(checkPrefix(build(), prefix))));
    for (const [ prefix, { build, manifestFileName } ] of Object.entries(builtinIconPacks)) {
        if (isRequested(prefix)) {
            writeBuiltinIconPack(checkPrefix(build(), prefix), manifestFileName);
        }
    }

    console.log(`\n✅ Built icon packs are available at ${resolve(outputDir)}.`);
}

interface BuiltinIconPack {
    build: () => IconPackData;
    manifestFileName: string;
}

/** Fails the build when a pack's key in `main()` no longer matches the prefix its provider sets. */
function checkPrefix(iconPack: IconPackData, prefix: string) {
    if (iconPack.prefix !== prefix) {
        throw new Error(
            `Icon pack ${iconPack.name} has prefix "${iconPack.prefix}", expected "${prefix}".`
        );
    }
    return iconPack;
}

/**
 * Writes a pack that Trilium ships itself: the font beside `boxicons.woff2` in the client, where
 * every app serves its built-in fonts from, and the manifest beside the Boxicons one in core, which
 * `getIconPacks()` imports.
 */
function writeBuiltinIconPack(iconPack: IconPackData, manifestFileName: string) {
    const fontPath = join(__dirname, "../../client/src/fonts", iconPack.fontFile.name);
    const coreServicesDir = join(__dirname, "../../../packages/trilium-core/src/services");
    const manifestPath = join(coreServicesDir, manifestFileName);
    writeFileSync(fontPath, iconPack.fontFile.content);
    writeFileSync(manifestPath, `${JSON.stringify(iconPack.manifest, null, 2)}\n`);

    console.log(`Built icon pack ${iconPack.name} into ${fontPath} and ${manifestPath}.`);
}

/**
 * Starts core on an in-memory database, as `build-docs` does, with the services a build never uses
 * stubbed. The server modules load only after the environment above is set.
 */
async function initializeBuilderCore() {
    const server = {
        sql: await import("@triliumnext/server/src/sql_provider.js"),
        crypto: await import("@triliumnext/server/src/crypto_provider.js"),
        zip: await import("@triliumnext/server/src/zip_provider.js"),
        cls: await import("@triliumnext/server/src/cls_provider.js"),
        platform: await import("@triliumnext/server/src/platform_provider.js"),
        zipExport: await import("@triliumnext/server/src/services/export/zip/factory.js"),
        i18n: await import("@triliumnext/server/src/services/i18n.js")
    };

    const dbProvider = new server.sql.default();
    dbProvider.loadFromMemory();

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: false,
            onTransactionCommit: () => {},
            onTransactionRollback: () => {}
        },
        crypto: new server.crypto.default(),
        zip: new server.zip.default(),
        zipExportProviderFactory: server.zipExport.serverZipExportProviderFactory,
        executionContext: new server.cls.default(),
        platform: new server.platform.default(),
        schema: readFileSync(require.resolve("@triliumnext/core/src/assets/schema.sql"), "utf-8"),
        translations: server.i18n.initializeTranslations,
        getDemoArchive: async () => null,
        backup: new StubBackupService(),
        image: stubImageProvider
    });
}

class StubBackupService extends BackupService {

    constructor() {
        super({
            getOption: () => "",
            getOptionOrNull: () => null,
            getOptionBool: () => false,
            setOption: () => {}
        });
    }

    scheduleBackups() {}
    async backupNow(): Promise<string> {
        throw new Error("Backups are not supported while building icon packs.");
    }
    async getExistingBackups() {
        return [];
    }
    async getBackupContent() {
        return null;
    }

}

const stubImageProvider: ImageProvider = {
    getImageType: () => null,
    processImage: async () => {
        throw new Error("Images are not supported while building icon packs.");
    },
    compressImage: async () => ({ compressed: false, reason: "unsupported-platform" }),
    planCompression: async () => ({ skip: "unsupported-platform" as const, decodeCost: null }),
    compressionConcurrency: () => 1,
    resizeForPreview: async () => ({ resized: false, reason: "unsupported-platform" as const })
};

initializeBuilderCore().then(() => {
    getContext().init(async () => {
        await main();
        // Core's scheduled tasks keep the event loop alive after the packs are written.
        process.exit(0);
    });
});
