import { mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import JSZip from "jszip";
import { resolve } from "path";
import { defineConfig } from "wxt";

export default defineConfig({
    webExt: {
        // A persistent profile keeps the toolbar pin and the extension's settings across dev runs.
        // The Firefox one is not in /tmp, where web-ext puts it by default and the Firefox snap cannot read it.
        chromiumProfile: profileDir("chrome-data"),
        firefoxProfile: profileDir("firefox-data"),
        keepProfileChanges: true
    },
    vite: () => ({
        oxc: {
            jsx: {
                runtime: "automatic",
                importSource: "preact"
            }
        }
    }),
    manifest: ({ manifestVersion }) => ({
        name: "Trilium Web Clipper",
        description: "Save web clippings to Trilium Notes.",
        homepage_url: "https://docs.triliumnotes.org/user-guide/setup/web-clipper",
        permissions: [
            "activeTab",
            "tabs",
            "storage",
            "contextMenus",
            "scripting",
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
                description: "Take a screenshot of an area of the current page",
                suggested_key: {
                    default: "Ctrl+Shift+E"
                }
            },
            saveTabs: {
                description: "Save all tabs of the current window into a note"
            },
            saveFullPageScreenshot: {
                description: "Take a screenshot of the whole page"
            }
        }
    }),
    zip: {
        artifactTemplate: "trilium-web-clipper-{{version}}-{{browser}}.zip",
        sourcesTemplate: "trilium-web-clipper-{{version}}-sources.zip",
        // AMO rebuilds the extension from the sources zip, so it holds the monorepo files the
        // build reads: the workspace and lockfile, the clipper, and the client styles and fonts.
        sourcesRoot: resolve("../.."),
        includeSources: [
            "package.json",
            "pnpm-workspace.yaml",
            "pnpm-lock.yaml",
            "tsconfig.base.json",
            "patches/**",
            "apps/web-clipper/**",
            "apps/client/package.json",
            "apps/client/src/stylesheets/buttons.css",
            "apps/client/src/stylesheets/theme-next/buttons.css",
            "apps/client/src/stylesheets/theme-next/forms.css",
            "apps/client/src/fonts/Inter/**",
            "apps/client/src/fonts/JetBrainsMono-Light.woff2"
        ],
        excludeSources: [
            "apps/web-clipper/test-output/**",
            "apps/web-clipper/*.tsbuildinfo"
        ]
    },
    hooks: {
        "build:manifestGenerated": (wxt, manifest) => {
            // Firefox places a new extension's button in the extensions panel unless asked otherwise.
            const action = manifest.browser_action ?? manifest.action;
            if (wxt.config.command === "serve" && wxt.config.browser === "firefox" && action) {
                Object.assign(action, { default_area: "navbar" });
            }
        },
        "zip:sources:done": async (_wxt, sourcesZipPath) => {
            // wxt always excludes skipped entrypoints (offscreen is Chrome-only) from the
            // sources zip, but AMO needs complete sources to reproduce the build.
            const archive = await JSZip.loadAsync(await readFile(sourcesZipPath));
            archive.file("apps/web-clipper/entrypoints/offscreen/index.html",
                await readFile("entrypoints/offscreen/index.html"));
            // The reviewer's build instructions, where the archive opens.
            archive.file("README.md", await readFile("README.md"));
            await writeFile(sourcesZipPath, await archive.generateAsync({
                type: "nodebuffer",
                compression: "DEFLATE"
            }));
        }
    }
});

/** A dev browser profile in `.wxt`, created if missing: neither browser's launcher creates it. */
function profileDir(name: string) {
    const dir = resolve(".wxt", name);
    mkdirSync(dir, { recursive: true });
    return dir;
}
