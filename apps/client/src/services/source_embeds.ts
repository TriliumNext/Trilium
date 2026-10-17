import { MERMAID_ATTACHMENT_MIME } from "@triliumnext/commons";
import type { ComponentType } from "preact";

import type { ContentEditor } from "./content_renderer";

/** What the component of a {@link SourceEmbedType} receives, wherever its source is stored. */
export interface SourceEmbedProps {
    /** The saved source. It changes when the source is saved elsewhere, or undone. */
    content: string;
    /** Saves the edited source. Without it the content is read-only. */
    editor?: ContentEditor;
}

/**
 * A kind of content that an embed in a text note shows from a source, such as a Mermaid diagram.
 * The source is stored in one of two ways, and its component works the same with both:
 *
 * - inline, as a `<pre><code class="language-…">` code block of the note, of {@link language};
 * - in an attachment of the note, of media type {@link mime}.
 */
export interface SourceEmbedType {
    /** The language of the code block that keeps the source inline. */
    language: string;
    /** The media type of an attachment that keeps the source. */
    mime: string;
    /** The content type that `getRenderedContent()` names the content, for its styles. */
    contentType: string;
    /** Loads the component that shows and edits the source. */
    load(): Promise<ComponentType<SourceEmbedProps>>;
    /** Renders `source` into `container` as a static picture, outside an embed. */
    renderPreview(source: string, container: HTMLElement): Promise<void>;
}

export const SOURCE_EMBED_TYPES: readonly SourceEmbedType[] = [
    {
        language: "mermaid",
        mime: MERMAID_ATTACHMENT_MIME,
        contentType: "mermaidDiagram",
        load: async () => (await import("../widgets/type_widgets/mermaid/MermaidDiagram")).default,
        async renderPreview(source, container) {
            const { renderMermaidSvg } = await import("./mermaid");
            try {
                container.innerHTML = await renderMermaidSvg(source);
            } catch (e) {
                container.textContent = (e as Error)?.message ?? String(e);
            }
        }
    }
];

/** The type of the source embeds whose code blocks are of `language`, or `undefined`. */
export function getSourceEmbedTypeByLanguage(language: string) {
    return SOURCE_EMBED_TYPES.find((type) => type.language === language);
}

/** The type of the source embeds whose content type is `contentType`, or `undefined`. */
export function getSourceEmbedTypeByContentType(contentType: string) {
    return SOURCE_EMBED_TYPES.find((type) => type.contentType === contentType);
}
