import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";
import i18next from "i18next";

import helpMeta from "../../../server/src/assets/help/help_meta.json";

/** Where the build copies the guide's content and assets (see vite.config.mts). */
const HELP_ASSETS = "server-assets/help";

/**
 * Standalone in-app help provider, reading the same artifacts the server does: the note tree
 * `edit-docs` builds from the User Guide, and the rendered content of its pages.
 *
 * The default (English) tree is inlined by the bundler, because the subtree is built synchronously
 * on every becca load. Localized trees and all content bundles are fetched by {@link load} during
 * worker startup: they are not needed before then, and `getContent`/`getSubtree` are synchronous
 * by the time anything reads them. Languages without a translation fall back to the English
 * artifacts.
 */
export default class StandaloneInAppHelpProvider extends InAppHelpProvider {

    private defaultMeta = helpMeta as HiddenSubtreeItem[];
    private metaByLocale = new Map<string, HiddenSubtreeItem[]>();
    private contentByLocale = new Map<string, HelpBundle>();
    private availableLocales = new Set<string>([ "en" ]);
    private pendingLoads = new Map<string, Promise<void>>();

    getHelpHiddenSubtreeData(locale?: string): HiddenSubtreeItem[] {
        if (locale) {
            const localized = this.metaByLocale.get(locale);
            if (localized) {
                return localized;
            }
        }
        return this.defaultMeta;
    }

    getHelpContent(locale?: string): HelpBundle {
        if (locale) {
            const localized = this.contentByLocale.get(locale);
            if (localized) {
                return localized;
            }
        }
        return this.contentByLocale.get("en") ?? {};
    }

    getHelpAssetBase(): string {
        return HELP_ASSETS;
    }

    async getHelpAsset(assetPath: string): Promise<Uint8Array | null> {
        const url = `/${HELP_ASSETS}/${assetPath.split("/").map(encodeURIComponent).join("/")}`;
        try {
            const response = await fetch(url);
            return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
        } catch {
            return null;
        }
    }

    /**
     * Loads the English fallback and the active display language; other shipped languages are
     * fetched lazily via {@link ensureLocale} when the user switches language.
     */
    async load(preferredLocale = i18next.language || "en"): Promise<void> {
        try {
            const locales = await this.loadLocales();
            this.availableLocales = new Set(locales.length ? locales : [ "en" ]);
            const toLoad = [ "en" ];
            if (preferredLocale !== "en" && this.availableLocales.has(preferredLocale)) {
                toLoad.push(preferredLocale);
            }
            await Promise.all(toLoad.map((locale) => this.ensureLocale(locale)));
        } catch (e) {
            console.warn("[Worker] In-app help content could not be loaded:", e);
        }
    }

    async ensureLocale(locale: string): Promise<void> {
        if (!this.availableLocales.has(locale) || this.contentByLocale.has(locale)) {
            return;
        }
        const existing = this.pendingLoads.get(locale);
        if (existing) {
            return existing;
        }
        const task = this.loadLocale(locale).finally(() => {
            this.pendingLoads.delete(locale);
        });
        this.pendingLoads.set(locale, task);
        return task;
    }

    /** The languages the shipped assets carry a translation for (`help_locales.json`). */
    private async loadLocales(): Promise<string[]> {
        const response = await fetch(`/${HELP_ASSETS}/help_locales.json`);
        if (!response.ok) {
            // Assets built before localized help existed: English only.
            await this.loadLocale("en");
            return [];
        }
        return await response.json() as string[];
    }

    private async loadLocale(locale: string): Promise<void> {
        const suffix = locale === "en" ? "" : `.${locale}`;
        const [ metaResponse, contentResponse ] = await Promise.all([
            fetch(`/${HELP_ASSETS}/help_meta${suffix}.json`),
            fetch(`/${HELP_ASSETS}/help_content${suffix}.json`)
        ]);

        if (!contentResponse.ok) {
            throw new Error(`HTTP ${contentResponse.status}`);
        }

        if (metaResponse.ok) {
            this.metaByLocale.set(locale, await metaResponse.json() as HiddenSubtreeItem[]);
        }
        this.contentByLocale.set(locale, await contentResponse.json() as HelpBundle);
    }
}
