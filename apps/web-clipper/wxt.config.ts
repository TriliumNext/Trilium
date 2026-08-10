import { copyFile, readFile, rm, writeFile } from "fs/promises";
import JSZip from "jszip";
import { defineConfig } from "wxt";

let originalTsConfig: object;

export default defineConfig({
    modules: ['@wxt-dev/auto-icons'],
    manifest: ({ manifestVersion }) => ({
        name: "Trilium Web Clipper",
        description: "Save web clippings to Trilium Notes.",
        homepage_url: "https://docs.triliumnotes.org/user-guide/setup/web-clipper",
        permissions: [
            "activeTab",
            "tabs",
            "storage",
            "contextMenus",
            manifestVersion === 3 && "offscreen"
        ].filter(Boolean),
        host_permissions: [
            "http://*/",
            "https://*/",
            "<all_urls>",
        ],
        browser_specific_settings: {
            gecko: {
                // See https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings#id.
                id: "web-clipper@triliumnotes.org",
                // Firefox built-in data collection consent
                // See https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
                // This extension only communicates with a user-configured Trilium instance
                // and does not collect telemetry or send data to remote servers.
                data_collection_permissions: {
                    required: ["none"]
                }
            }
        },
        commands: {
            saveSelection: {
                description: "Save the selected text into a note",
                suggested_key: {
                    default: "Ctrl+Shift+S"
                }
            },
            saveWholePage: {
                description: "Save the current page",
                suggested_key: {
                    default: "Alt+Shift+S"
                }
            },
            saveCroppedScreenshot: {
                description: "Take a cropped screenshot of the current page",
                suggested_key: {
                    default: "Ctrl+Shift+E"
                }
            }
        }
    }),
    zip: {
        artifactTemplate: "trilium-web-clipper-{{version}}-{{browser}}.zip"
    },
    hooks: {
        'zip:sources:start': async () => {
            // Rewrite tsconfig.base.json into the web-clipper app folder
            await copyFile("../../tsconfig.base.json", "./tsconfig.base.json");

            originalTsConfig = JSON.parse(await readFile("./tsconfig.json", "utf-8"));
            const adjustedTsConfig = {
                ...originalTsConfig,
                extends: ["./tsconfig.base.json", "./.wxt/tsconfig.json"]
            };

            await writeFile("./tsconfig.json", JSON.stringify(adjustedTsConfig, null, 4), 'utf-8');
        },
        "zip:sources:done": async (_wxt, sourcesZipPath) => {
            // Restore original tsconfig.json
            await writeFile("./tsconfig.json", JSON.stringify(originalTsConfig, null, 4), 'utf-8');

            // Remove the copied tsconfig.base.json
            await rm("./tsconfig.base.json");

            // wxt always excludes skipped entrypoints (offscreen is Chrome-only) from the
            // sources zip, but AMO needs complete sources to reproduce the build.
            const archive = await JSZip.loadAsync(await readFile(sourcesZipPath));
            archive.file("entrypoints/offscreen/index.html", await readFile("entrypoints/offscreen/index.html"));
            await writeFile(sourcesZipPath, await archive.generateAsync({
                type: "nodebuffer",
                compression: "DEFLATE"
            }));
        }
    }
});
