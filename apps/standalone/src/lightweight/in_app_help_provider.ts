import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";

import helpMeta from "../assets/help_meta.json";

/**
 * Standalone in-app help provider: serves the pre-built help meta (webView-based)
 * generated at build time by edit-docs.
 */
export default class StandaloneInAppHelpProvider extends InAppHelpProvider {

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return helpMeta as HiddenSubtreeItem[];
    }

    getHelpContent(): HelpBundle {
        // Standalone's help pages are web views onto the online documentation, so they hold no
        // content of their own. They move to the bundled content once this build consumes the
        // same artifacts the server does.
        return {};
    }
}
