import type { HiddenSubtreeItem } from "@triliumnext/commons";
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
}
