import "ckeditor5";

declare global {
    interface Component {
        triggerCommand(command: string): void;
    }

    interface LinkEmbedMetadata {
        url: string;
        embedType: string;
        title?: string;
        description?: string;
        favicon?: string;
        siteName?: string;
        image?: string;
        /**
         * True when the host could not read the page (network error, bot challenge, non-HTML
         * response, or a page with no title of its own) and the fields above hold nothing but a
         * hostname-derived placeholder. Mirrors `LinkEmbedMetadata.unresolved` in
         * `@triliumnext/commons`, which is what the host actually returns.
         */
        unresolved?: boolean;
    }

    interface IconPickerRequest {
        /** The element to paint the picker into, which the editor owns and places. */
        container: HTMLElement;
        /** Receives the class of the icon picked, e.g. `bx bx-star`. */
        onSelect(iconClass: string): void;
    }

    interface EditorComponent extends Component {
        /**
         * Paints the host's icon picker into `container`, and answers with the way to take it down
         * again. A host that shows the picker somewhere of its own — a phone, which has no room for
         * a balloon — leaves `container` alone and answers `null`.
         */
        showIconPicker(request: IconPickerRequest): (() => void) | null;
        /**
         * Formats `date` for insertion in the Day.js `format`, or in the user's
         * `customDateTimeFormat` when none is given.
         */
        formatDateTime(date: Date, format?: string): string;
        loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string): Promise<void>;
        createNoteForReferenceLink(title: string, intoInbox: boolean): Promise<string | undefined>;
        loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>, boxSize?: string): void;
        /**
         * Reads a page's preview metadata through the host. Never rejects: any failure — network
         * error, HTTP error, unparseable page — resolves as `{ unresolved: true }` with
         * hostname-derived placeholders, so callers branch on `unresolved` instead of catching.
         */
        fetchLinkMetadata(url: string): Promise<LinkEmbedMetadata>;
        detectEmbedType(url: string): string;
        renderLinkEmbed(container: HTMLElement, metadata: LinkEmbedMetadata, editable?: boolean): void;
        renderLinkMention(container: HTMLElement, metadata: Pick<LinkEmbedMetadata, "url" | "title" | "favicon">, editable?: boolean): void;
    }

    var glob: {
        getComponentByEl<T extends Component>(el: unknown): T;
        getActiveContextNote(): {
            noteId: string;
        };
        getHeaders(): Promise<Record<string, string>>;
        getReferenceLinkTitle(href: string): Promise<string>;
        getReferenceLinkTitleSync(href: string): string;
    };
}
