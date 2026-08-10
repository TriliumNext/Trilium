import type { HiddenSubtreeAttribute } from "./hidden_subtree.js";

/**
 * One note of the in-app help (User Guide) tree, as prepared by `edit-docs` from the User
 * Guide's markdown export and consumed by both the server and the standalone build.
 *
 * The shape is deliberately that of a virtual subtree item — the help notes are injected into
 * becca by a virtual note provider and never persisted — plus {@link source}, which tells the
 * build which file backs each note. `source` is a build concern and never becomes a note
 * attribute.
 */
export interface HelpMetaItem {
    /** Note ID, always prefixed with `_help_`. */
    id: string;
    title: string;
    /**
     * `text` and `code` notes carry content built from {@link source}; `book` is a folder with
     * no content of its own; `webView` embeds a remote page given by its `webViewSrc` label.
     */
    type: "text" | "code" | "book" | "webView";
    /** Only meaningful for `code` notes; text pages are `text/html` once rendered. */
    mime?: string;
    /** Labels the note carries in the application, e.g. `iconClass`, `docUrl`, `webViewSrc`. */
    attributes?: HiddenSubtreeAttribute[];
    children?: HelpMetaItem[];
    /**
     * Content source, relative to the markdown export root (e.g. `User Guide/Note Types/Text.md`).
     * Absent for folders and web views, which have no file of their own. Clones point at the
     * primary occurrence's file rather than their own `.clone` copy.
     */
    source?: string;
}

/**
 * The rendered content of every help note that has one, keyed by note ID — the counterpart of
 * the help tree. Notes without an entry (folders, web views) have no content of their own.
 */
export type HelpBundle = Record<string, string>;
