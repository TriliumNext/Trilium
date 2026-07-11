#!/usr/bin/env node

import packageJson from "../package.json" with { type: "json" };
import { buildDocsFromConfig } from "./build-docs.js";

// Parse command-line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let configPath: string | undefined;
    let showHelp = false;
    let showVersion = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--config" || args[i] === "-c") {
            configPath = args[i + 1];
            if (!configPath) {
                console.error("Error: --config/-c requires a path argument");
                process.exit(1);
            }
            i++; // Skip the next argument as it's the value
        } else if (args[i] === "--help" || args[i] === "-h") {
            showHelp = true;
        } else if (args[i] === "--version" || args[i] === "-v") {
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
Usage: trilium-build-docs [options]

Options:
  -c, --config <path>  Path to the configuration file
                       (default: edit-docs-config.yaml in current directory)
  -h, --help           Display this help message
  -v, --version        Display version information

Description:
  Builds documentation from Trilium note structure and exports to various formats.
  Configuration file should be in YAML format with the following structure:

  baseUrl: "https://example.com"
  noteMappings:
    - rootNoteId: "noteId123"
      path: "docs"
      format: "markdown"
    - rootNoteId: "noteId456"
      path: "public/docs"
      format: "share"
      exportOnly: true

Version: ${version}
`);
}

function printVersion() {
    const version = getVersion();
    console.log(version);
}

async function main() {
    const { configPath, showHelp, showVersion } = parseArgs();

    if (showHelp) {
        printHelp();
        process.exit(0);
    } else if (showVersion) {
        printVersion();
        process.exit(0);
    }

    try {
        await buildDocsFromConfig(configPath);
        process.exit(0);
    } catch (error) {
        console.error("Error building documentation:", error);
        process.exit(1);
    }
}

main();
