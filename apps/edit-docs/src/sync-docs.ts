/**
 * Regenerates every export target in `edit-docs-config.yaml` from the Markdown trees, with no
 * window: the same import and export that `edit-docs.ts` runs after an edit, so a page edited
 * by hand gets its normalized Markdown, the help HTML under `doc_notes` and the standalone
 * `help_meta.json` without opening Electron.
 *
 *   pnpm edit-docs:sync-docs [-- -c <config>]
 *
 * The import rejects a tree whose `!!!meta.json` and files disagree (a `.md` with no entry, a
 * missing `dataFileName`), and that rejection is the check: an error here means the tree would
 * also crash edit-docs at start-up.
 */
import { cls } from "@triliumnext/core";

import { exportMappings, importMappings, initializeDocsCore, loadConfig } from "./docs_pipeline.js";

function parseArgs() {
    const args = process.argv.slice(2);
    let configPath: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--config" || args[i] === "-c") {
            configPath = args[i + 1];
            if (!configPath) {
                console.error("Error: --config/-c requires a path argument");
                process.exit(1);
            }
            i++;
        } else if (args[i] === "--help" || args[i] === "-h") {
            console.log("Usage: sync-docs [-c <edit-docs-config.yaml>]");
            process.exit(0);
        }
    }

    return { configPath };
}

async function main() {
    const { configPath } = parseArgs();
    const config = await loadConfig(configPath);

    await initializeDocsCore();

    const { sql_init, becca_loader: beccaLoader, erase: eraseService } = await import("@triliumnext/core");
    await new Promise<void>((resolve, reject) => {
        cls.init(async () => {
            try {
                cls.ignoreEntityChangeIds();
                await sql_init.createInitialDatabase(true);
                await beccaLoader.beccaLoaded;

                console.log("Importing", config.noteMappings.filter((m) => !m.exportOnly).map((m) => m.path).join(", "));
                await importMappings(config.noteMappings);

                eraseService.eraseUnusedAttachmentsNow();

                console.log("Exporting", config.noteMappings.map((m) => m.path).join(", "));
                await exportMappings(config.noteMappings, config.baseUrl);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

main().then(
    () => process.exit(0),
    (e) => {
        console.error("Error syncing documentation:", e);
        process.exit(1);
    }
);
