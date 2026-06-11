import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";

import helpContent from "../assets/help_content.json";
import helpMeta from "../assets/help_meta.json";

/**
 * Standalone in-app help provider. Serves the same doc-note hidden subtree as the server/desktop
 * (so the synced `_help` structure is identical across platforms) and answers help-content search
 * queries from a bundled plain-text index — the web-based client cannot read the doc HTML files
 * from disk, so the index is the only way to make help content natively searchable here.
 */
export default class StandaloneInAppHelpProvider extends InAppHelpProvider {

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return helpMeta as HiddenSubtreeItem[];
    }

    override getDocContent(docName: string): string | null {
        return (helpContent as Record<string, string>)[docName] ?? null;
    }
}
