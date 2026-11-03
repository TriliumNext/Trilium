import {
    getLinkPreviewVideoId, isHttpUrl, LINK_PREVIEW_DATA_ATTRIBUTES, type LinkPreviewData
} from '@triliumnext/commons';
import {
    Command, type Editor, findAttributeRange, type ModelElement, ModelLiveRange, type ModelRange,
    type ModelWriter
} from 'ckeditor5';

import { createVideoEmbed, isVideoEmbed } from '../content_embed/video_embed.js';

export const LINK_EMBED_COMMAND = 'insertLinkEmbed';
export const CHANGE_LINK_DISPLAY_COMMAND = 'changeLinkDisplay';
export const REMOVE_LINK_EMBED_COMMAND = 'removeLinkEmbed';

export const LINK_DISPLAY_MODES = [
    'inline',
    'card',
    'embed',
    // The way out of the preview system: an ordinary <a> link, no widget. Offered in the same
    // dropdowns as the real modes so "back to a normal URL" is found where the user looks for it.
    'plain'
] as const;

export type LinkDisplayMode = typeof LINK_DISPLAY_MODES[number];

/**
 * The user-facing name of a display mode, as shown by the widget toolbar's Display dropdown.
 *
 * A switch rather than a table of labels, so that each one is written as a literal argument of a
 * `t()` call: that is how the messages this package owns are discovered (see `messages.ts`) and a
 * label tucked away in a table would be invisible to translators.
 *
 * @param t the editor's translation function.
 * @param mode the display mode; an unrecognized one has no label and is returned as-is.
 */
export function getLinkDisplayModeLabel(t: (message: string) => string, mode: LinkDisplayMode): string {
    switch (mode) {
        case 'inline':
            return t('Inline');
        case 'card':
            return t('Card');
        case 'embed':
            return t('Embed');
        case 'plain':
            return t('Plain link');
        default:
            return mode;
    }
}

/**
 * What a URL must look like before any conversion — automatic or command-driven — considers turning
 * it into a preview: http(s) and free of whitespace. Everything else (an internal `#root/…` note
 * reference, a mailto:, a mid-edit fragment) has no page behind it to preview.
 */
export const EMBEDDABLE_URL_REGEX = /^https?:\/\/\S+$/;

export type MetaKey = keyof LinkPreviewData;

/** Every piece of fetched metadata a linkEmbed/linkMention element stores as a model attribute. */
export const META_KEYS = Object.keys(LINK_PREVIEW_DATA_ATTRIBUTES) as MetaKey[];

/** The model attributes of a link preview made from the fetched `metadata`. */
export function getMetadataAttributes(metadata: LinkEmbedMetadata): Record<string, unknown> {
    return Object.fromEntries(META_KEYS.map((key) => [ key, metadata[key] ]));
}

/**
 * Puts a link to `url` at the selection, or in place of the link or the link preview the selection
 * is in, and turns it into a preview of the `mode` shape once the page's metadata arrives. `title`
 * replaces the page's own title, and is the text of a plain link. `description` replaces the page's
 * own description.
 *
 * A selected preview of `url` changes its shape, title and description from the metadata it
 * stores, without fetching the page again.
 *
 * All the metadata is written onto the element whichever shape is chosen — an inline mention stores
 * the description and image it does not itself show — so that switching modes later, via the widget
 * toolbar's Display dropdown, never has to go back to the network.
 */
export class InsertLinkEmbedCommand extends Command {
    override async execute({ url, mode, title, description }: {
        url: string; mode: LinkDisplayMode; title?: string; description?: string;
    }) {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;
        const selected = getSelectedLinkWidget(editor);
        if (selected && mode !== 'plain' && selected.getAttribute('url') === url) {
            model.change((writer) => {
                writer.setSelection(
                    rebuildLinkWidget(editor, writer, selected, mode, title, description), 'on'
                );
            });
            return;
        }

        const href = selection.getAttribute('linkHref');
        const position = selection.getFirstPosition();
        const target = typeof href === 'string' && position
            ? findAttributeRange(position, 'linkHref', href, model)
            : selection;

        // The plain link shows at once; the metadata fetch reads the page server-side and can take
        // seconds.
        const linkRange = model.change((writer) => {
            const link = writer.createText(title || url, { linkHref: url });
            const range = model.insertContent(link, target);
            writer.setSelection(range.end);
            return range;
        });

        if (mode !== 'plain') {
            await replaceLinkWithPreview(editor, linkRange, url, mode, title, description);
        }
    }

    override refresh() {
        const model = this.editor.model;
        const selection = model.document.selection;
        const firstPosition = selection.getFirstPosition();
        const allowedIn = firstPosition && model.schema.findAllowedParent(firstPosition, 'linkEmbed');
        this.isEnabled = allowedIn !== null;
    }
}

export class ChangeLinkDisplayCommand extends Command {
    declare value: LinkDisplayMode | null;
    /** Whether the selected link supports embed mode (e.g. YouTube). */
    declare embedAvailable: boolean;
    /** URL of the selected link widget, exposed for the toolbar's open-link button. */
    declare url: string | null;

    constructor(editor: any) {
        super(editor);
        // Register as observables so CKEditor's bind().to() works.
        this.set('embedAvailable', false);
        this.set('url', null);
    }

    override async execute(options: { value: LinkDisplayMode }) {
        const model = this.editor.model;
        const selected = getSelectedLinkWidget(this.editor);

        // No widget selected means the dropdown sits in the link balloon, over a native link.
        if (!selected) {
            await this._convertNativeLink(options.value);
            return;
        }

        const targetMode = options.value;
        const currentMode = getLinkWidgetMode(selected);
        if (targetMode === currentMode) return;

        const url = selected.getAttribute('url') as string;

        // "Plain link" leaves the preview system: the widget becomes an ordinary link whose text is
        // the URL. Inserted as new content (not an attribute change), so AutoLinkToMention does not
        // see it and immediately convert it back. A URL we would never link to (see the isHttpUrl
        // note in refresh()) degrades to bare text instead, as the unlink button does.
        if (targetMode === 'plain') {
            model.change(writer => {
                const text = isHttpUrl(url) ? writer.createText(url, { linkHref: url }) : writer.createText(url);
                model.insertContent(text, writer.createRangeOn(selected));
            });
            return;
        }

        model.change(writer => {
            rebuildLinkWidget(this.editor, writer, selected, targetMode);
        });
    }

    override refresh() {
        const selected = getSelectedLinkWidget(this.editor);

        if (selected) {
            this.isEnabled = true;
            this.value = getLinkWidgetMode(selected);
            const url = selected.getAttribute('url') as string;
            this.embedAvailable = this._detectEmbedType(url) !== 'opengraph';
            // Only ever hand out an http(s) URL. `url` comes from the stored `data-url`, which the
            // HTML sanitizers pass through unexamined, so a note carrying `data-url="javascript:…"`
            // would otherwise reach the toolbar's "open link" button as a live href. Withholding it
            // here disables that button (and the copy one) instead of arming them.
            this.url = isHttpUrl(url) ? url : null;
            return;
        }

        // A native link under the caret: the same dropdown, hosted in the link balloon this time,
        // offers to convert it into a preview. Its current display mode is by definition "plain".
        const href = this.editor.model.document.selection.getAttribute('linkHref');
        if (typeof href === 'string' && EMBEDDABLE_URL_REGEX.test(href)) {
            this.isEnabled = true;
            this.value = 'plain';
            this.embedAvailable = this._detectEmbedType(href) !== 'opengraph';
            this.url = href;
            return;
        }

        this.isEnabled = false;
        this.value = null;
        this.embedAvailable = false;
        this.url = null;
    }

    /**
     * Converts the native link under the caret — the one whose balloon toolbar hosts the dropdown —
     * into the chosen preview shape: the deliberate inverse of "Plain link". Unlike auto-detection
     * there is no gesture to interpret and no unresolved-page veto: the mode was picked outright,
     * so the conversion always happens (Ctrl+Z brings the link back), and a labeled link's display
     * text is replaced by the preview.
     */
    private async _convertNativeLink(targetMode: LinkDisplayMode) {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();
        const href = model.document.selection.getAttribute('linkHref');
        /* v8 ignore next -- refresh() disables the command unless the selection carries a linkHref */
        if (typeof href !== 'string' || !position) return;
        // The link already is one.
        if (targetMode === 'plain') return;

        const range = findAttributeRange(position, 'linkHref', href, model);
        await replaceLinkWithPreview(this.editor, range, href, targetMode);
    }

    /** Delegates to the host to avoid duplicating URL detection logic. */
    private _detectEmbedType(url: string): string {
        return getLinkEmbedHost(this.editor).detectEmbedType(url);
    }
}

export class RemoveLinkEmbedCommand extends Command {
    override execute() {
        const model = this.editor.model;
        const selected = getSelectedLinkWidget(this.editor);
        if (!selected) return;

        const url = selected.getAttribute('url') as string;

        // Mirror the default link's unlink: drop the link entirely, leaving the
        // bare URL as plain (non-linked) text.
        model.change(writer => {
            model.insertContent(writer.createText(url), writer.createRangeOn(selected));
        });
    }

    override refresh() {
        this.isEnabled = !!getSelectedLinkWidget(this.editor);
    }
}

/**
 * Replaces the link to `href` in `range` with a preview of the `mode` shape, once the page's
 * metadata arrives, and selects it unless the user has moved the selection in the meantime.
 * `title` and `description` replace the page's own.
 *
 * The range is tracked as a live range while the metadata is fetched, so edits made meanwhile do
 * not shift what gets replaced. Nothing is replaced when the link is no longer in the range by
 * then.
 */
async function replaceLinkWithPreview(
    editor: Editor, range: ModelRange, href: string,
    mode: Exclude<LinkDisplayMode, 'plain'>, title?: string, description?: string
) {
    const model = editor.model;
    const liveRange = ModelLiveRange.fromRange(range);
    const selection = model.document.selection;
    let selectionMoved = false;
    const onSelectionChange = (_event: unknown, data: { directChange: boolean }) => {
        selectionMoved = data.directChange || selectionMoved;
    };
    selection.on('change:range', onSelectionChange);
    try {
        const metadata = await getLinkEmbedHost(editor).fetchMetadata(href);
        const currentRange = liveRange.toRange();

        model.change(writer => {
            let linkStillThere = false;
            for (const { item } of currentRange.getWalker()) {
                if (item.is('$textProxy') && item.getAttribute('linkHref') === href) {
                    linkStillThere = true;
                    break;
                }
            }
            if (!linkStillThere) return;

            const element = createLinkPreview(writer, mode, {
                ...getMetadataAttributes(metadata),
                embedType: mode === 'embed'
                    ? getLinkEmbedHost(editor).detectEmbedType(href)
                    : metadata.embedType,
                title: title || metadata.title,
                description: description || metadata.description
            });

            model.insertContent(element, currentRange);
            // The widget toolbar, with its Display dropdown, takes over from the link balloon.
            if (!selectionMoved) {
                writer.setSelection(element, 'on');
            }
        });
    } finally {
        selection.off('change:range', onSelectionChange);
        liveRange.detach();
    }
}

/**
 * Replaces the link preview `element` with one of the `mode` shape, built from the metadata it
 * stores, and returns it. `title` and `description` replace its own.
 */
function rebuildLinkWidget(
    editor: Editor, writer: ModelWriter, element: ModelElement,
    mode: Exclude<LinkDisplayMode, 'plain'>, title?: string, description?: string
) {
    const attrs: Record<string, unknown> = {};
    for (const key of META_KEYS) {
        const val = element.getAttribute(key);
        if (val != null) attrs[key] = val;
    }
    if (title) attrs.title = title;
    if (description) attrs.description = description;
    if (mode === 'card') {
        attrs.embedType = 'opengraph';
    } else if (mode === 'embed') {
        attrs.embedType = getLinkEmbedHost(editor).detectEmbedType(attrs.url as string);
    }

    // Replaced rather than given new attributes: the editing downcast is elementToElement, which
    // does not re-render on attribute changes. A preview that keeps its shape keeps its other
    // attributes, such as the box of a video.
    const ownAttributes = Object.fromEntries(element.getAttributes());
    const replacement = getLinkPreviewName(mode, attrs) === element.name
        ? writer.createElement(element.name, { ...ownAttributes, ...attrs })
        : createLinkPreview(writer, mode, attrs);
    editor.model.insertContent(replacement, writer.createRangeOn(element));
    return replacement;
}

/**
 * Creates the element of the `mode` shape for a link preview with the fields `attributes`: a
 * `linkMention`, a `linkEmbed`, or a video embed (`ContentEmbedVideo`) for the embed of a URL
 * with a video.
 */
export function createLinkPreview(
    writer: ModelWriter,
    mode: Exclude<LinkDisplayMode, 'plain'>,
    attributes: Record<string, unknown>
) {
    switch (getLinkPreviewName(mode, attributes)) {
        case 'linkMention':
            return writer.createElement('linkMention', attributes);
        case 'contentEmbed':
            return createVideoEmbed(writer, attributes);
        default:
            // The renderers draw the `opengraph` type as a card, also for a URL with a video.
            return writer.createElement('linkEmbed', {
                ...attributes,
                embedType: mode === 'card' ? 'opengraph' : attributes.embedType
            });
    }
}

/** The element of a link preview of the `mode` shape with the fields `attributes`. */
function getLinkPreviewName(
    mode: Exclude<LinkDisplayMode, 'plain'>, attributes: Record<string, unknown>
) {
    if (mode === 'inline') {
        return 'linkMention';
    }
    const embedType = attributes.embedType as string | undefined;
    const hasVideo = mode === 'embed'
        && !!getLinkPreviewVideoId({ url: attributes.url as string, embedType });
    return hasVideo ? 'contentEmbed' : 'linkEmbed';
}

/** The display mode of the link preview `element`. */
export function getLinkWidgetMode(element: ModelElement): Exclude<LinkDisplayMode, 'plain'> {
    if (element.name === 'linkMention') return 'inline';
    return element.getAttribute('embedType') === 'opengraph' ? 'card' : 'embed';
}

/** Returns the selected linkEmbed or linkMention element, or video embed, or null. */
export function getSelectedLinkWidget(editor: Editor): ModelElement | null {
    const selected = editor.model.document.selection.getSelectedElement();
    if (selected && (selected.name === 'linkMention' || selected.name === 'linkEmbed')) {
        return selected;
    }
    if (selected?.name === 'contentEmbed' && isVideoEmbed(selected)) {
        return selected;
    }
    return null;
}

/**
 * The link preview services of the `linkEmbed` config entry. A service the host leaves out falls
 * back to a placeholder: metadata that is unresolved, the `opengraph` type, and a preview that
 * shows the title or the URL as text.
 */
export function getLinkEmbedHost(editor: Editor): LinkEmbedHost {
    return { ...FALLBACK_HOST, ...editor.config.get('linkEmbed') };
}

/** The services the host provides for link previews, through the `linkEmbed` config entry. */
export interface LinkEmbedHost {
    /**
     * Reads a page's preview metadata. Never rejects: any failure (network error, HTTP error,
     * unparseable page) resolves as `{ unresolved: true }` with hostname-derived placeholders, so
     * callers branch on `unresolved` instead of catching.
     */
    fetchMetadata(url: string): Promise<LinkEmbedMetadata>;
    /** The kind of preview `url` supports: `opengraph` for a card, anything else for a player. */
    detectEmbedType(url: string): string;
    renderEmbed(container: HTMLElement, metadata: LinkEmbedMetadata, editable?: boolean): void;
    renderMention(container: HTMLElement, metadata: Pick<LinkEmbedMetadata, 'url' | 'title' | 'favicon'>, editable?: boolean): void;
}

const FALLBACK_HOST: LinkEmbedHost = {
    fetchMetadata: async (url) => ({ url, embedType: 'opengraph', unresolved: true }),
    detectEmbedType: () => 'opengraph',
    renderEmbed: renderAsText,
    renderMention: renderAsText
};

function renderAsText(container: HTMLElement, { url, title }: Pick<LinkEmbedMetadata, 'url' | 'title'>) {
    container.textContent = title || url;
}

declare module 'ckeditor5' {
    interface EditorConfig {
        linkEmbed?: Partial<LinkEmbedHost>;
    }
}
