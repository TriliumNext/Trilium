import debounce from "@triliumnext/client/src/services/debounce.js";
import { cls } from "@triliumnext/core";

import packageJson from "../package.json" with { type: "json" };
import { type Config, exportMappings, importMappings, loadConfig } from "./docs_pipeline.js";
import { initializeEditDocsCore, startElectron } from "./utils.js";

// Parse command-line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let configPath: string | undefined;
    let showHelp = false;
    let showVersion = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config' || args[i] === '-c') {
            configPath = args[i + 1];
            if (!configPath) {
                console.error("Error: --config/-c requires a path argument");
                process.exit(1);
            }
            i++; // Skip the next argument as it's the value
        } else if (args[i] === '--help' || args[i] === '-h') {
            showHelp = true;
        } else if (args[i] === '--version' || args[i] === '-v') {
            showVersion = true;
        }
    }

    return { configPath, showHelp, showVersion };
}

function getVersion(): string {
    return packageJson.version;
}

function printHelp() {
    const version = getVersion();
    console.log(`
Usage: trilium-edit-docs [options]

Options:
  -c, --config <path>  Path to the configuration file (default: edit-docs-config.yaml in the root)
  -h, --help           Display this help message
  -v, --version        Display version information

Version: ${version}
`);
}

function printVersion() {
    const version = getVersion();
    console.log(version);
}

const { configPath, showHelp, showVersion } = parseArgs();

if (showHelp) {
    printHelp();
    process.exit(0);
} else if (showVersion) {
    printVersion();
    process.exit(0);
}

let config: Config;

async function main() {
    config = await loadConfig(configPath);
    const initializedPromise = startElectron(() => {
        // Wait for the import to be finished and the application to be loaded before we listen to changes.
        setTimeout(() => {
            registerHandlers();
        }, 10_000);
    });

    await initializeEditDocsCore();

    // Create the in-memory database schema and resolve dbReady (requires CLS context)
    const { sql_init, becca_loader: beccaLoader } = await import("@triliumnext/core");
    cls.init(async () => {
        cls.ignoreEntityChangeIds();
        await sql_init.createInitialDatabase(true);
        await beccaLoader.beccaLoaded;

        await importMappings(config.noteMappings);
        setOptions();
        initializedPromise.resolve();
    });
}

async function setOptions() {
    const { options: optionsService } = await import("@triliumnext/core");
    const sql = (await import("@triliumnext/server/src/services/sql.js")).default;

    optionsService.setOption("eraseUnusedAttachmentsAfterSeconds", 10);
    optionsService.setOption("eraseUnusedAttachmentsAfterTimeScale", 60);
    optionsService.setOption("compressImages", "false");

    // Set initial note to the first visible child of root (not _hidden)
    const startNoteId = sql.getValue("SELECT noteId FROM branches WHERE parentNoteId = 'root' AND isDeleted = 0 AND noteId != '_hidden' ORDER BY notePosition") || "root";
    optionsService.setOption("openNoteContexts", JSON.stringify([{ notePath: startNoteId, active: true }]));
}

async function registerHandlers() {
    const { events } = await import("@triliumnext/core");
    const { erase: eraseService } = await import("@triliumnext/core");
    const debouncer = debounce(async () => {
        eraseService.eraseUnusedAttachmentsNow();
        await exportMappings(config.noteMappings, config.baseUrl);
    }, 10_000);
    events.subscribe(events.ENTITY_CHANGED, async (e) => {
        if (e.entityName === "options") {
            return;
        }

        debouncer();
    });
}

main();
