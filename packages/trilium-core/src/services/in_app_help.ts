import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import { t } from "i18next";

import { registerVirtualNoteProvider, unregisterVirtualNoteProvider, type VirtualSubtreeItem } from "./virtual_notes.js";

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
    abstract getHelpHiddenSubtreeData(): HiddenSubtreeItem[];

    /**
     * Rendered content of the help pages, keyed by note ID. Called on every page read, so
     * implementations that load it from disk should cache it.
     */
    abstract getHelpContent(): HelpBundle;
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
                    // Inherited by every page: the guide is application-owned, so it opens in the
                    // reading view rather than an editor. Writes are refused by the entity layer
                    // anyway; this keeps the application from offering them in the first place.
                    attributes: [
                        { type: "label", name: "readOnly", value: "", isInheritable: true }
                    ],
                    // HiddenSubtreeItem is structurally a VirtualSubtreeItem (its enforce*
                    // fields are simply ignored here).
                    children: getHelpHiddenSubtreeData()
                }
            ];
        },
        getContent(noteId: string) {
            return provider?.getHelpContent()[noteId];
        }
    });
}

export function getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
    return provider?.getHelpHiddenSubtreeData() ?? [];
}
