import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import i18next, { t } from "i18next";
import mimeTypes from "mime-types";

import {
    registerVirtualNoteProvider,
    unregisterVirtualNoteProvider,
    type VirtualNoteAsset,
    type VirtualSubtreeItem
} from "./virtual_notes.js";

/**
 * Platform-specific source of the in-app help (User Guide), both its tree and the rendered content
 * of its pages. Both are produced by `edit-docs` from the markdown under `docs/User Guide`; the
 * server reads them from `RESOURCE_DIR/help`.
 *
 * The help notes themselves are **virtual notes**: they exist only in becca, injected under
 * `_hidden` by the `_help` virtual note provider registered in {@link initInAppHelp}. They are
 * never persisted or synced — their structure and content are owned by the application, not the
 * user.
 */
export abstract class InAppHelpProvider {
    /**
     * The help tree. Implementations that ship localized guides return the tree for the given
     * display language (the `locale` option), falling back to the default language's tree when
     * no translation exists for it.
     */
    abstract getHelpHiddenSubtreeData(locale?: string): HiddenSubtreeItem[];

    /**
     * Rendered content of the help pages, keyed by note ID. Called on every page read, so
     * implementations that load it from disk should cache it. Localized guides keyed by the
     * `locale` option; falls back to the default language's bundle.
     */
    abstract getHelpContent(locale?: string): HelpBundle;

    /**
     * Where this platform serves the guide's images and attachments from, substituted into the
     * pages for {@link HELP_ASSET_TOKEN}. Relative URLs are resolved by the browser against the
     * application root, which keeps them working behind a reverse proxy and under Electron's
     * custom protocol.
     */
    abstract getHelpAssetBase(): string;

    /**
     * Reads one of the guide's images or attachments, by its path from the export root as the
     * pages reference it (percent-decoded). Resolves to `null` when the file cannot be read.
     */
    abstract getHelpAsset(assetPath: string): Promise<Uint8Array | null>;

    /** Ensures localized bundles for `locale` are loaded when fetched lazily (no-op for sync providers). */
    async ensureLocale(_locale: string): Promise<void> {}
}

/**
 * Placeholder the content bundle carries in place of an asset location, so that one bundle can be
 * shipped to platforms that serve those assets from different places. Kept in sync with the
 * bundler in `apps/edit-docs`.
 */
export const HELP_ASSET_TOKEN = "{{helpAssets}}";

let provider: InAppHelpProvider | null = null;

export const HELP_SUBTREE_NAMESPACE = "_help";

export function initInAppHelp(p: InAppHelpProvider) {
    provider = p;

    if (!p) {
        // defensive: callers passing nothing get no help subtree rather than an empty one
        unregisterVirtualNoteProvider(HELP_SUBTREE_NAMESPACE);
        return;
    }

    registerVirtualNoteProvider({
        namespace: HELP_SUBTREE_NAMESPACE,
        parentNoteId: "_hidden",
        getSubtree(): VirtualSubtreeItem[] {
            const locale = currentHelpLocale();
            return [
                {
                    id: HELP_SUBTREE_NAMESPACE,
                    title: t("hidden-subtree.user-guide"),
                    type: "book",
                    icon: "bx-help-circle",
                    isExpanded: true,
                    // HiddenSubtreeItem is structurally a VirtualSubtreeItem (its enforce*
                    // fields are simply ignored here).
                    children: p.getHelpHiddenSubtreeData(locale)
                }
            ];
        },
        getContent(noteId: string) {
            const page = p.getHelpContent(currentHelpLocale())[noteId];
            return page?.replaceAll(HELP_ASSET_TOKEN, p.getHelpAssetBase());
        },
        getAssets: (noteId) => getHelpPageAssets(p, noteId, currentHelpLocale())
    });
}

export async function ensureHelpLocale(locale: string): Promise<void> {
    await provider?.ensureLocale(locale);
}

export function getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
    return provider?.getHelpHiddenSubtreeData(currentHelpLocale()) ?? [];
}

/**
 * The display language the help should be served in: the active i18next language, which the
 * application keeps in sync with the `locale` option (including runtime switches). Read on every
 * access rather than cached, so a provider holding one bundle per language can pick the right one.
 */
function currentHelpLocale(): string {
    return i18next.language || "en";
}

/** The images and attachments one help page references, in the order they first appear. */
function getHelpPageAssets(p: InAppHelpProvider, noteId: string, locale?: string): VirtualNoteAsset[] {
    const page = p.getHelpContent(locale)[noteId] ?? "";
    const prefix = `${HELP_ASSET_TOKEN}/`;
    const encodedPaths = new Set<string>();
    for (const [ , url ] of page.matchAll(/(?:src|href)="([^"]*)"/g)) {
        if (url.startsWith(prefix)) {
            encodedPaths.add(url.slice(prefix.length));
        }
    }

    return [ ...encodedPaths ].map((encodedPath, index) => {
        const assetPath = decodeURIComponent(encodedPath);
        const title = assetPath.slice(assetPath.lastIndexOf("/") + 1);
        return {
            id: `${noteId}_a${index + 1}`,
            url: `${p.getHelpAssetBase()}/${encodedPath}`,
            title,
            mime: mimeTypes.lookup(title) || "application/octet-stream",
            getContent: () => p.getHelpAsset(assetPath)
        };
    });
}
