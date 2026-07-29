import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { t } from "i18next";

import { registerVirtualNoteProvider, unregisterVirtualNoteProvider, type VirtualSubtreeItem } from "./virtual_notes.js";

/**
 * Platform-specific source of the in-app help (User Guide) tree definition — the server reads
 * it from `RESOURCE_DIR/doc_notes`, the standalone build from a bundled JSON asset.
 *
 * The help notes themselves are **virtual notes**: they exist only in becca, injected under
 * `_hidden` by the `_help` virtual note provider registered in {@link initInAppHelp}. They are
 * never persisted or synced — their structure is owned by the application, not the user — and
 * their HTML content is fetched by the client directly from the bundled assets (see the
 * client's `doc_renderer`), so the provider supplies no content.
 */
export abstract class InAppHelpProvider {
    abstract getHelpHiddenSubtreeData(): HiddenSubtreeItem[];
}

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
            return [
                {
                    id: HELP_SUBTREE_NAMESPACE,
                    title: t("hidden-subtree.user-guide"),
                    type: "book",
                    icon: "bx-help-circle",
                    isExpanded: true,
                    // HiddenSubtreeItem is structurally a VirtualSubtreeItem (its enforce*
                    // fields are simply ignored here).
                    children: getHelpHiddenSubtreeData()
                }
            ];
        }
    });
}

export function getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
    return provider?.getHelpHiddenSubtreeData() ?? [];
}
