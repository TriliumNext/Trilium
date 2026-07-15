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

    interface EditorComponent extends Component {
        loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string): Promise<void>;
        createNoteForReferenceLink(title: string): Promise<string>;
        loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>, boxSize?: string): void;
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
    }
}
