import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { assetUrlFragment } from "./services/asset_path.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";
import { isDev } from "./services/utils.js";

/**
 * Serves the in-app help from the two artifacts `edit-docs` builds out of `docs/User Guide`:
 * the note tree and the rendered content of its pages.
 */
export default class NodejsInAppHelpProvider extends InAppHelpProvider {

    // Cached per locale; localized help_<meta|content>.<locale>.json falls back to English.
    private helpMeta = new Map<string, HiddenSubtreeItem[]>();
    private helpContent = new Map<string, HelpBundle>();

    getHelpHiddenSubtreeData(locale?: string): HiddenSubtreeItem[] {
        const fileName = localizedHelpFile("help_meta", locale ?? "en");
        const cached = this.helpMeta.get(fileName);
        if (cached) {
            return cached;
        }
        const loaded = readHelpFile<HiddenSubtreeItem[]>(fileName) ?? [];
        this.helpMeta.set(fileName, loaded);
        return loaded;
    }

    getHelpContent(locale?: string): HelpBundle {
        const fileName = localizedHelpFile("help_content", locale ?? "en");
        const cached = this.helpContent.get(fileName);
        if (cached) {
            return cached;
        }
        const loaded = readHelpFile<HelpBundle>(fileName) ?? {};
        this.helpContent.set(fileName, loaded);
        return loaded;
    }

    getHelpAssetBase(): string {
        return `${assetUrlFragment}/help`;
    }

    async getHelpAsset(assetPath: string): Promise<Uint8Array | null> {
        const root = path.resolve(getHelpAssetDir());
        const filePath = path.resolve(root, assetPath);
        if (!filePath.startsWith(root + path.sep)) {
            return null;
        }

        try {
            return await fs.promises.readFile(filePath);
        } catch {
            return null;
        }
    }
}

/**
 * Where the in-app help's images and attachments live: the Markdown export in a source checkout,
 * the copy the build makes (see `copyServerAssets()`) in a packaged one.
 */
export function getHelpAssetDir() {
    if (isDev) {
        return path.join(RESOURCE_DIR, "..", "..", "..", "..", "docs", "User Guide");
    }
    return path.join(RESOURCE_DIR, "help");
}

/**
 * The per-language variant of a help artifact: `help_meta.<locale>.json` when a translation exists
 * for the locale, else the default English `help_meta.json`. Existence is checked on disk because
 * the set of translated languages only grows with the shipped assets.
 */
function localizedHelpFile(baseName: string, locale: string): string {
    const localized = `${baseName}.${locale}.json`;
    if (locale !== "en" && fs.existsSync(path.join(RESOURCE_DIR, "help", localized))) {
        return localized;
    }
    return `${baseName}.json`;
}

function readHelpFile<T>(fileName: string): T | null {
    const filePath = path.join(RESOURCE_DIR, "help", fileName);

    try {
        return JSON.parse(fs.readFileSync(filePath).toString("utf-8")) as T;
    } catch (e) {
        console.warn(e);
        return null;
    }
}
