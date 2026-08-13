import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";

import helpMeta from "../../../server/src/assets/help/help_meta.json";

/** Where the build copies the guide's content and assets (see vite.config.mts). */
const HELP_ASSETS = "server-assets/help";

/**
 * Standalone in-app help provider, reading the same two artifacts the server does: the note tree
 * `edit-docs` builds from the User Guide, and the rendered content of its pages.
 *
 * The tree is inlined by the bundler, because the subtree is built synchronously on every becca
 * load. The content is not — it is an order of magnitude larger and only needed once a page is
 * opened or searched — so it is fetched by {@link load} during worker startup. That is also the
 * last moment it can be: by the time anything asks for a page, `getContent` is synchronous.
 */
export default class StandaloneInAppHelpProvider extends InAppHelpProvider {

    private content: HelpBundle = {};

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return helpMeta as HiddenSubtreeItem[];
    }

    getHelpContent(): HelpBundle {
        return this.content;
    }

    getHelpAssetBase(): string {
        return HELP_ASSETS;
    }

    /**
     * Loads the page content. Failing costs the pages their bodies while the tree, the titles and
     * the navigation keep working, so it is logged rather than allowed to fail startup.
     */
    async load(): Promise<void> {
        try {
            const response = await fetch(`/${HELP_ASSETS}/help_content.json`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            this.content = await response.json() as HelpBundle;
        } catch (e) {
            console.warn("[Worker] In-app help content could not be loaded:", e);
        }
    }
}
