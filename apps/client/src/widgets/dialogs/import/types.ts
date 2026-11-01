import type { ComponentChildren, ComponentType } from "preact";

export interface ImportProviderPanelProps {
    /** The note the imported tree should be created under. */
    parentNoteId: string;
    /** Closes the surrounding import dialog (e.g. once the import has been kicked off). */
    closeDialog: () => void;
    /** Renders content (e.g. the primary action) into the dialog's pinned modal footer; pass null to clear. */
    setFooter: (footer: ComponentChildren) => void;
}

/**
 * A pluggable source the generic import dialog can import from. Add a new provider by implementing
 * this interface and appending it to the registry in `index.ts`; the dialog wires up the rest.
 */
export interface ImportProvider {
    /** Stable identifier. */
    id: string;
    /** Human-readable name shown in the provider picker. */
    name: string;
    /**
     * The icon class, such as `"bx bx-import"`, or the service's mark,
     * `"tn-brand tn-brand-notion"`.
     */
    icon: string;
    /** One-line description shown under the name. */
    description: string;
    /** Help note ID (without the `_help_` prefix) for this provider's documentation; shown as a help button in the dialog header. */
    helpPage?: string;
    /** Visual grouping in the picker: `"service"` (the default) appears in the card grid; `"local"` (file upload) is shown full-width, grouped beneath the services and selected by default. */
    group?: "service" | "local";
    /** The component rendered once this provider is chosen; it drives its own multi-step flow. */
    Panel: ComponentType<ImportProviderPanelProps>;
}
