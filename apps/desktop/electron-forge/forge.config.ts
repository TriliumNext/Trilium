import path, { join } from "path";
import fs from "fs-extra";
import { LOCALES } from "@triliumnext/commons";
import { PRODUCT_NAME } from "../src/app-info.js";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { existsSync } from "fs";

const ELECTRON_FORGE_DIR = __dirname;

const EXECUTABLE_NAME = "trilium"; // keep in sync with server's package.json -> packagerConfig.executableName
const APP_ICON_PATH = path.join(ELECTRON_FORGE_DIR, "app-icon");

const extraResourcesForPlatform = getExtraResourcesForPlatform();
const baseLinuxMakerConfigOptions = {
  name: EXECUTABLE_NAME,
  bin: EXECUTABLE_NAME,
  productName: PRODUCT_NAME,
  icon: path.join(APP_ICON_PATH, "png/128x128.png"),
  desktopTemplate: path.resolve(path.join(ELECTRON_FORGE_DIR, "desktop.ejs")),
  categories: ["Office", "Utility"]
};
const windowsSignConfiguration = process.env.WINDOWS_SIGN_EXECUTABLE ? {
    hookModulePath: path.join(ELECTRON_FORGE_DIR, "sign-windows.cjs")
} : undefined;
const macosSignConfiguration = process.env.APPLE_ID ? {
    osxSign: {},
    osxNotarize: {
        appleId: process.env.APPLE_ID!,
        appleIdPassword: process.env.APPLE_ID_PASSWORD!,
        teamId: process.env.APPLE_TEAM_ID!
    }
} : undefined;

const config: ForgeConfig = {
    outDir: "out",
    // Documentation of `packagerConfig` options: https://electron.github.io/packager/main/interfaces/Options.html
    packagerConfig: {
        executableName: EXECUTABLE_NAME,
        name: PRODUCT_NAME,
        overwrite: true,
        asar: true,
        icon: path.join(APP_ICON_PATH, "icon"),
        ...macosSignConfiguration,
        windowsSign: windowsSignConfiguration,
        extraResource: [
            // All resources should stay in Resources directory for macOS
            ...(process.platform === "darwin" ? [] : extraResourcesForPlatform)
        ],
        prune: false,
        afterComplete: [
            (buildPath, _electronVersion, platform, _arch, callback) => {
                // Only move resources on non-macOS platforms
                if (platform !== "darwin") {
                    for (const resource of extraResourcesForPlatform) {
                        const baseName = path.basename(resource);
                        const sourcePath = path.join(buildPath, "resources", baseName);

                        // prettier-ignore
                        const destPath = (baseName !== "256x256.png")
                            ? path.join(buildPath, baseName)
                            : path.join(buildPath, "icon.png");

                        fs.move(sourcePath, destPath)
                            .then(() => callback())
                            .catch((err) => callback(err));
                    }
                } else {
                    callback();
                }
            }
        ]
    },
    rebuildConfig: {
        extraModules: [ "better-sqlite3" ]
    },
    makers: [
        {
            name: "@electron-forge/maker-deb",
            config: {
                options: baseLinuxMakerConfigOptions
            }
        },
        {
            name: "@electron-forge/maker-flatpak",
            config: {
                options: {
                    ...baseLinuxMakerConfigOptions,
                    desktopTemplate: undefined, // otherwise it would put in the wrong exec
                    icon: {
                        "128x128": path.join(APP_ICON_PATH, "png/128x128.png"),
                    },
                    id: "com.triliumnext.notes",
                    runtimeVersion: "24.08",
                    base: "org.electronjs.Electron2.BaseApp",
                    baseVersion: "24.08",
                    baseFlatpakref: "https://flathub.org/repo/flathub.flatpakrepo",
                    finishArgs: [
                        // Wayland/X11 Rendering
                        "--socket=fallback-x11",
                        "--socket=wayland",
                        "--share=ipc",
                        // Open GL
                        "--device=dri",
                        // Audio output
                        "--socket=pulseaudio",
                        // Read/write home directory access
                        "--filesystem=home",
                        // Allow communication with network
                        "--share=network",
                        // System notifications with libnotify
                        "--talk-name=org.freedesktop.Notifications",
                        // System tray
                        "--talk-name=org.kde.StatusNotifierWatcher"
                    ],
                    modules: [
                        {
                            name: "zypak",
                            sources: {
                                type: "git",
                                url: "https://github.com/refi64/zypak",
                                tag: "v2024.01.17"
                            }
                        }
                    ]
                },
            }
        },
        {
            name: "@electron-forge/maker-rpm",
            config: {
                options: baseLinuxMakerConfigOptions
            }
        },
        {
            name: "@electron-forge/maker-squirrel",
            config: {
                name: EXECUTABLE_NAME,
                productName: PRODUCT_NAME,
                iconUrl: "https://raw.githubusercontent.com/TriliumNext/Trilium/refs/heads/main/apps/desktop/electron-forge/app-icon/icon.ico",
                setupIcon: path.join(ELECTRON_FORGE_DIR, "setup-icon/setup.ico"),
                loadingGif: path.join(ELECTRON_FORGE_DIR, "setup-icon/setup-banner.gif"),
                windowsSign: windowsSignConfiguration
            }
        },
        {
            name: "@electron-forge/maker-dmg",
            config: {
                icon: path.join(APP_ICON_PATH, "icon.icns")
            }
        },
        {
            name: "@electron-forge/maker-zip",
            config: {
                options: {
                    iconUrl: "https://raw.githubusercontent.com/TriliumNext/Trilium/refs/heads/main/apps/desktop/electron-forge/app-icon/icon.ico",
                    icon: path.join(APP_ICON_PATH, "icon.ico")
                }
            }
        }
    ],
    plugins: [
        {
            name: "@electron-forge/plugin-auto-unpack-natives",
            config: {}
        }
    ],
    hooks: {
        // Remove unused locales from the packaged app to save some space.
        async postPackage(_, packageResult) {
            const isMac = (process.platform === "darwin");
            let localesToKeep = LOCALES
                .filter(locale => !locale.contentOnly)
                .map(locale => locale.electronLocale) as string[];
            if (!isMac) {
                localesToKeep = localesToKeep.map(locale => locale.replace("_", "-"))
            }

            const keptLocales = new Set();
            const removedLocales: string[] =  [];
            const extension = (isMac ? ".lproj" : ".pak");

            for (const outputPath of packageResult.outputPaths) {
                const localeDirs = isMac
                    ? [
                        path.join(outputPath, `${PRODUCT_NAME}.app/Contents/Resources`),
                        path.join(outputPath, `${PRODUCT_NAME}.app/Contents/Frameworks/Electron Framework.framework/Resources`)
                    ]
                    : [ path.join(outputPath, 'locales') ];

                for (const localeDir of localeDirs) {
                    if (!fs.existsSync(localeDir)) {
                        console.log(`No locales directory found in '${localeDir}'.`);
                        process.exit(2);
                    }

                    const files = fs.readdirSync(localeDir);

                    for (const file of files) {
                        if (!file.endsWith(extension)) {
                            continue;
                        }

                        let localeName = path.basename(file, extension);
                        if (localeName === "en-US" && !isMac) {
                            // If the locale is "en-US" on Windows, we treat it as "en".
                            // This is because the Windows version of Electron uses "en-US.pak" instead of "en.pak".
                            localeName = "en";
                        }

                        if (localesToKeep.includes(localeName)) {
                            keptLocales.add(localeName);
                            continue;
                        }

                        const filePath = path.join(localeDir, file);
                        if (isMac) {
                            fs.rm(filePath, { recursive: true });
                        } else {
                            fs.unlinkSync(filePath);
                        }

                        removedLocales.push(file);
                    }
                }
            }

            console.log(`Removed unused locale files: ${removedLocales.join(", ")}`);

            // Ensure all locales that should be kept are actually present.
            for (const locale of localesToKeep) {
                if (!keptLocales.has(locale)) {
                    throw new Error(`Locale ${locale} was not found in the packaged app.`);
                }
            }

            // Check that the bettersqlite3 binary has the right architecture.
            if (packageResult.platform === "linux" && packageResult.arch === "arm64") {
                for (const outputPath of packageResult.outputPaths) {
                    const binaryPath = join(outputPath, "resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node");
                    if (!existsSync(binaryPath)) {
                        throw new Error(`[better-sqlite3] Unable to find .node file at ${binaryPath}`);
                    }

                    const actualArch = getELFArch(binaryPath);
                    if (actualArch !== "ARM64") {
                        throw new Error(`[better-sqlite3] Expected ARM64 architecture but got ${actualArch} at: ${binaryPath}`);
                    }
                }
            }
        },
        // Gather all the artifacts produced by the makers and copy them to a common upload directory.
        async postMake(_, makeResults) {
            const outputDir = path.join(__dirname, "..", "upload");
            fs.mkdirpSync(outputDir);
            for (const makeResult of makeResults) {
                for (const artifactPath of makeResult.artifacts) {
                    // Ignore certain artifacts.
                    let fileName = path.basename(artifactPath);
                    const extension = path.extname(fileName);
                    if (fileName === "RELEASES" || extension === ".nupkg") {
                        continue;
                    }

                    // Override the extension for the CI.
                    const { TRILIUM_ARTIFACT_NAME_HINT } = process.env;
                    if (TRILIUM_ARTIFACT_NAME_HINT) {
                        fileName = TRILIUM_ARTIFACT_NAME_HINT.replaceAll("/", "-") + extension;
                    }

                    const outputPath = path.join(outputDir, fileName);
                    console.log(`[Artifact] ${artifactPath} -> ${outputPath}`);
                    fs.copyFileSync(artifactPath, outputPath);
                }
            }
        }
    }
};

function getExtraResourcesForPlatform() {
    const resources: string[] = [];

    const getScriptResources = () => {
        const scripts = ["trilium-portable", "trilium-safe-mode", "trilium-no-cert-check"];
        const scriptExt = (process.platform === "win32") ? "bat" : "sh";
        return scripts.map(script => `electron-forge/${script}.${scriptExt}`);
    }

    switch (process.platform) {
        case "win32":
            resources.push(...getScriptResources())
            break;
        case "linux":
            resources.push(...getScriptResources(), path.join(APP_ICON_PATH, "png/256x256.png"));
            break;
        default:
            break;
    }

    return resources;
}

function getELFArch(file: string) {
  const buf = fs.readFileSync(file);

  if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
    throw new Error("Not an ELF file");
  }

  const eiClass = buf[4];      // 1=32-bit, 2=64-bit
  const eiMachine = buf[18];   // architecture code

  if (eiMachine === 0x3E) return 'x86-64';
  if (eiMachine === 0xB7) return 'ARM64';
  return 'other';
}


export default config;
