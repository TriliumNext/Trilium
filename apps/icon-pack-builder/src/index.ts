import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

import cls from "@triliumnext/server/src/services/cls.js";

import type { IconPackData } from "./provider";
import boxicons3 from "./providers/boxicons3";
import mdi from "./providers/mdi";
import phosphor from "./providers/phosphor";

process.env.TRILIUM_INTEGRATION_TEST = "memory-no-store";
process.env.TRILIUM_RESOURCE_DIR = "../server/src";
process.env.NODE_ENV = "development";

async function main() {
    const outputDir = join(__dirname, "output");
    mkdirSync(outputDir, { recursive: true });

    const i18n = await import("@triliumnext/server/src/services/i18n.js");
    await i18n.initializeTranslations();

    const sqlInit = (await import("../../server/src/services/sql_init.js")).default;
    await sqlInit.createInitialDatabase(true);

    // Wait for becca to be loaded before importing data
    const beccaLoader = await import("../../server/src/becca/becca_loader.js");
    await beccaLoader.beccaLoaded;

    const notesService = (await import("../../server/src/services/notes.js")).default;

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
        const zipFilePath = join(outputDir, `${iconPack.name}.zip`);
        const fileOutputStream = createWriteStream(zipFilePath);
        const { exportToZip } = (await import("@triliumnext/server/src/services/export/zip.js")).default;
        const taskContext = new (await import("@triliumnext/server/src/services/task_context.js")).default(
            "no-progress-reporting", "export", null
        );
        await exportToZip(taskContext, branch, "html", fileOutputStream, false, { skipExtraFiles: true });
        await new Promise<void>((resolve) => { fileOutputStream.on("finish", resolve); });

        console.log(`Built icon pack: ${iconPack.name} (${zipFilePath})`);
    }

    const builtIconPacks = [
        boxicons3("basic"),
        boxicons3("brands"),
        mdi(),
        phosphor("regular"),
        phosphor("fill")
    ];
    await Promise.all(builtIconPacks.map(buildIconPack));
}

cls.init(() => {
    main();
});
