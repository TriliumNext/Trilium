import type { HiddenSubtreeAttribute } from "./hidden_subtree.js";

/**
 * One note of the in-app help (User Guide) tree, as prepared by `edit-docs` from the User
 * Guide's markdown export and consumed by both the server and the standalone build.
 *
 * The shape is deliberately that of a virtual subtree item: the help notes are injected into becca
 * by a virtual note provider and never persisted. Which markdown file backs each note is a build
 * concern that stays in `edit-docs`, so it is not part of this — the tree carries only what an
 * application needs to show the pages.
 */
export interface HelpMetaItem {
    /** Note ID, always prefixed with `_help_`. */
    id: string;
    title: string;
    /**
     * `text` and `code` notes carry content of their own, found in the bundle under this note's
     * ID; `book` is a folder with none; `webView` embeds a remote page given by its `webViewSrc`
     * label.
     */
    type: "text" | "code" | "book" | "webView";
    /** Only meaningful for `code` notes; text pages are `text/html` once rendered. */
    mime?: string;
    /** Labels the note carries in the application, e.g. `iconClass`, `docUrl`, `webViewSrc`. */
    attributes?: HiddenSubtreeAttribute[];
    children?: HelpMetaItem[];
}

/**
 * The rendered content of every help note that has one, keyed by note ID — the counterpart of
 * the help tree. Notes without an entry (folders, web views) have no content of their own.
 */
export type HelpBundle = Record<string, string>;
