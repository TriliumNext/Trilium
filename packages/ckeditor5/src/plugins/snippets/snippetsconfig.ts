/**
 * The shape of a single text-snippet ("template") entry shown in the `insertTemplate` dropdown.
 *
 * `data` may be a plain HTML string or a getter, which lets the content stay live (the getter reads
 * a mutable cache) without recreating the editor.
 */
export interface SnippetDefinition {
    /** The title of the snippet, shown as the primary label and used for search matching. */
    title: string;

    /**
     * The HTML inserted at the caret, or a callback returning it. A callback is evaluated on every
     * insertion, so snippet content can change at runtime without rebuilding the definition list.
     */
    data: (() => string) | string;

    /**
     * The note's icon as a Boxicon/`tn-icon` class list (e.g. `"tn-icon bx bx-note"`). Rendered
     * directly as a font-icon `<span>` — since Trilium owns this plugin, there is no need to wrap the
     * icon in an SVG `<foreignObject>` to satisfy CKEditor's generic `IconView`.
     */
    iconClass?: string;

    /** Optional colour class applied alongside {@link iconClass} (from the note's `#color` label). */
    iconColorClass?: string;

    /** Optional longer description shown under the title and also matched during search. */
    description?: string;
}

export interface SnippetsConfig {
    /** The list of snippet definitions displayed in the `insertTemplate` dropdown. */
    definitions?: Array<SnippetDefinition>;
}
