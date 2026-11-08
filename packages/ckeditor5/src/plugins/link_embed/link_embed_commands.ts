import {
    getLinkPreviewPlayer, isHttpUrl, LINK_PREVIEW_DATA_ATTRIBUTES, type LinkPreviewData
} from '@triliumnext/commons';
import {
    Command, type Editor, findAttributeRange, type ModelElement, ModelLiveRange, type ModelRange,
    type ModelTextProxy, type ModelWriter
} from 'ckeditor5';

import { getCaption, getCaptionedEmbed, isContentEmbed } from '../content_embed/content_embed.js';
import {
    createChangedMediaEmbed, createMediaEmbed, isMediaEmbed
} from '../content_embed/media_embed.js';

export const LINK_EMBED_COMMAND = 'insertLinkEmbed';
export const CHANGE_LINK_DISPLAY_COMMAND = 'changeLinkDisplay';
export const REMOVE_LINK_EMBED_COMMAND = 'removeLinkEmbed';

export const LINK_DISPLAY_MODES = [
    // The way out of the preview system: an ordinary <a> link, no widget. Offered in the same
    // dropdowns as the real modes so "back to a normal link" is found where the user looks for it.
    'textLink',
    'iconAndTextLink',
    'cardLink',
    'embedLink'
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
        case 'iconAndTextLink':
            return t('Icon & text');
        case 'cardLink':
            return t('Card');
        case 'embedLink':
            return t('Embed');
        case 'textLink':
            return t('Text');
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
 * The model attributes of a preview of the `mode` shape of the page at `href`, made from its
 * fetched `metadata`. `title` and `description` replace the page's own.
 */
export function getPreviewAttributes(
    editor: Editor, mode: Exclude<LinkDisplayMode, 'textLink'>, href: string,
    metadata: LinkEmbedMetadata, title?: string, description?: string
): Record<string, unknown> {
    return {
        ...getMetadataAttributes(metadata),
        embedType: mode === 'embedLink'
            ? getEmbedType(editor, href, metadata.embedType)
            : metadata.embedType,
        title: title || metadata.title,
        description: description || metadata.description
    };
}

/**
 * The model attributes of an embed that plays the media at `url`, made from its fetched `metadata`.
 * `title` replaces the title of the media. Throws when the metadata could not be read or names
 * nothing that a player plays.
 */
export function getMediaAttributes(
    editor: Editor, url: string, metadata: LinkEmbedMetadata, title?: string
): Record<string, unknown> {
    if (metadata.unresolved) {
        throw new Error('The metadata of the media could not be read.');
    }

    const attributes = getPreviewAttributes(editor, 'embedLink', url, metadata, title);
    const { embedType } = attributes as { embedType?: string };
    if (!getLinkPreviewPlayer({ url: metadata.url, embedType })) {
        throw new Error('The address is not that of a YouTube video, an audio or a video file.');
    }
    return attributes;
}

/**
 * Puts a link to `url` at the selection, or in place of the link or the link preview the selection
 * is in, and turns it into a preview of the `mode` shape once the page's metadata arrives. `title`
 * replaces the page's own title, and is the text of a `textLink`. `description` replaces the page's
 * own description.
 *
 * A selected preview of `url` changes its shape, title and description from the metadata it
 * stores, without fetching the page again. A selected media embed given another address in the
 * `embedLink` shape plays the media there once its metadata arrives, keeping its box and caption,
 * and rejects, changing nothing, when that address plays nothing.
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
        if (selected && mode !== 'textLink' && selected.getAttribute('url') === url) {
            model.change((writer) => {
                writer.setSelection(
                    rebuildLinkWidget(editor, writer, selected, mode, title, description), 'on'
                );
            });
            return;
        }
        if (selected && mode === 'embedLink' && isContentEmbed(selected)) {
            await changeMediaUrl(editor, selected, url, title);
            return;
        }

        const href = selection.getAttribute('linkHref');
        const position = selection.getFirstPosition();
        const target = typeof href === 'string' && position
            ? findAttributeRange(position, 'linkHref', href, model)
            : selection;

        // The text link shows at once; the metadata fetch reads the page server-side and can take
        // seconds.
        const linkRange = model.change((writer) => {
            const link = writer.createText(title || url, { linkHref: url });
            const range = model.insertContent(link, target);
            writer.setSelection(range.end);
            return range;
        });

        if (mode !== 'textLink') {
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
        const selected = this._getTarget();

        // No widget selected means the dropdown sits in the link balloon, over a native link.
        if (!selected) {
            await this._convertNativeLink(options.value);
            return;
        }

        const targetMode = options.value;
        const currentMode = getLinkWidgetMode(selected);
        if (targetMode === currentMode) return;

        const url = selected.getAttribute('url') as string;

        // "Text" leaves the preview system: the widget becomes an ordinary link whose text is
        // its title, or the URL without one. Inserted as new content (not an attribute change), so
        // AutoLinkToMention does not see it and immediately convert it back. A URL we would never
        // link to (see the isHttpUrl note in refresh()) degrades to bare text instead, as the
        // unlink button does.
        if (targetMode === 'textLink') {
            const title = selected.getAttribute('title') as string | undefined;
            model.change(writer => {
                const text = isHttpUrl(url)
                    ? writer.createText(title || url, { linkHref: url })
                    : writer.createText(url);
                keepCaptionText(writer, selected);
                model.insertContent(text, writer.createRangeOn(selected));
            });
            return;
        }

        model.change(writer => {
            rebuildLinkWidget(this.editor, writer, selected, targetMode);
        });
    }

    override refresh() {
        const selected = this._getTarget();

        if (selected) {
            this.isEnabled = true;
            this.value = getLinkWidgetMode(selected);
            const url = selected.getAttribute('url') as string;
            this.embedAvailable = getEmbedType(this.editor, url,
                selected.getAttribute('embedType') as string | undefined) !== 'opengraph';
            // Only ever hand out an http(s) URL. `url` comes from the stored `data-url`, which the
            // HTML sanitizers pass through unexamined, so a note carrying `data-url="javascript:…"`
            // would otherwise reach the toolbar's "open link" button as a live href. Withholding it
            // here disables that button (and the copy one) instead of arming them.
            this.url = isHttpUrl(url) ? url : null;
            return;
        }

        // A native link under the caret: the same dropdown, hosted in the link balloon this time,
        // offers to convert it into a preview. Its current display mode is "textLink".
        const href = this.editor.model.document.selection.getAttribute('linkHref');
        if (typeof href === 'string' && EMBEDDABLE_URL_REGEX.test(href)) {
            this.isEnabled = true;
            this.value = 'textLink';
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
     * into the chosen preview shape: the deliberate inverse of "Text". Unlike auto-detection
     * there is no gesture to interpret and no unresolved-page veto: the mode was picked outright,
     * so the conversion always happens (Ctrl+Z brings the link back). A link whose text differs
     * from its URL keeps that text as the title of the preview, as in the link dialog.
     */
    private async _convertNativeLink(targetMode: LinkDisplayMode) {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();
        const href = model.document.selection.getAttribute('linkHref');
        /* v8 ignore if -- refresh() disables the command unless the selection carries a linkHref */
        if (typeof href !== 'string' || !position) return;
        // The link already is one.
        if (targetMode === 'textLink') return;

        const range = findAttributeRange(position, 'linkHref', href, model);
        const text = getText(range).trim();
        const title = text && text !== href ? text : undefined;
        await replaceLinkWithPreview(this.editor, range, href, targetMode, title);
    }

    /**
     * The link preview that the command acts on: the selected one, else, unless the caret is on a
     * link, the media embed whose caption has the selection, which keeps its toolbar there.
     */
    private _getTarget(): ModelElement | null {
        const selection = this.editor.model.document.selection;
        const selected = getSelectedLinkWidget(this.editor);
        if (selected || selection.hasAttribute('linkHref')) {
            return selected;
        }

        const media = getCaptionedEmbed(selection.getFirstPosition());
        return media && isMediaEmbed(media) ? media : null;
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

/** The text in `range`, without its inline objects. */
function getText(range: ModelRange) {
    return Array.from(range.getItems())
        .filter((item): item is ModelTextProxy => item.is('$textProxy'))
        .map((item) => item.data)
        .join('');
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
    mode: Exclude<LinkDisplayMode, 'textLink'>, title?: string, description?: string
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

            const element = createLinkPreview(writer, mode,
                getPreviewAttributes(editor, mode, href, metadata, title, description));

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

/** The latest call of `changeMediaUrl()` for each media embed. */
const latestMediaChanges = new WeakMap<ModelElement, object>();

/**
 * Makes the media embed `embed` play the media at `url` once its metadata arrives, keeping its box
 * and caption, and keeps it selected if it is still selected. `title` replaces the title of the
 * media. Changes nothing once `embed` has left the document or a later call has given it another
 * address. Rejects, changing nothing, when the address plays nothing.
 */
async function changeMediaUrl(editor: Editor, embed: ModelElement, url: string, title?: string) {
    const model = editor.model;
    const change = {};
    latestMediaChanges.set(embed, change);
    const metadata = await getLinkEmbedHost(editor).fetchMetadata(url);
    if (editor.state === 'destroyed' || embed.root === model.document.graveyard
        || latestMediaChanges.get(embed) !== change) {
        return;
    }

    const attributes = getMediaAttributes(editor, url, metadata, title);
    model.change((writer) => {
        const isSelected = model.document.selection.getSelectedElement() === embed;
        const replacement = createChangedMediaEmbed(writer, embed, attributes);
        model.insertContent(replacement, writer.createRangeOn(embed));
        if (isSelected) {
            writer.setSelection(replacement, 'on');
        }
    });
}

/**
 * Replaces the link preview `element` with one of the `mode` shape, built from the metadata it
 * stores, and returns it. `title` and `description` replace its own.
 */
function rebuildLinkWidget(
    editor: Editor, writer: ModelWriter, element: ModelElement,
    mode: Exclude<LinkDisplayMode, 'textLink'>, title?: string, description?: string
) {
    const attrs: Record<string, unknown> = {};
    for (const key of META_KEYS) {
        const val = element.getAttribute(key);
        if (val != null) attrs[key] = val;
    }
    if (title) attrs.title = title;
    if (description) attrs.description = description;
    if (mode === 'cardLink') {
        attrs.embedType = 'opengraph';
    } else if (mode === 'embedLink') {
        attrs.embedType = getEmbedType(editor, attrs.url as string, attrs.embedType as string);
    }

    // Replaced rather than given new attributes: the editing downcast is elementToElement, which
    // does not re-render on attribute changes. A preview that keeps its shape keeps its other
    // attributes, such as the box of a video, and its children, such as the caption of a video.
    const ownAttributes = Object.fromEntries(element.getAttributes());
    let replacement: ModelElement;
    if (getLinkPreviewName(mode, attrs) === element.name) {
        replacement = writer.createElement(element.name, { ...ownAttributes, ...attrs });
        // The only child of a link preview is the caption of a video.
        for (const caption of element.getChildren()) {
            writer.append(writer.cloneElement(caption as ModelElement), replacement);
        }
    } else {
        replacement = createLinkPreview(writer, mode, attrs);
        keepCaptionText(writer, element);
    }
    editor.model.insertContent(replacement, writer.createRangeOn(element));
    return replacement;
}

/**
 * Moves the content of the caption of `element`, a video that a shape without a caption replaces,
 * into a paragraph after it.
 */
function keepCaptionText(writer: ModelWriter, element: ModelElement) {
    const caption = isContentEmbed(element) ? getCaption(element) : null;
    if (!caption || caption.isEmpty) {
        return;
    }

    const paragraph = writer.createElement('paragraph');
    writer.insert(paragraph, writer.createPositionAfter(element));
    writer.move(writer.createRangeIn(caption), writer.createPositionAt(paragraph, 0));
}

/**
 * Creates the element of the `mode` shape for a link preview with the fields `attributes`: a
 * `linkMention`, a `linkEmbed`, or a media embed (`ContentEmbedMedia`) for the embed of a URL
 * that a preview plays.
 */
export function createLinkPreview(
    writer: ModelWriter,
    mode: Exclude<LinkDisplayMode, 'textLink'>,
    attributes: Record<string, unknown>
) {
    switch (getLinkPreviewName(mode, attributes)) {
        case 'linkMention':
            return writer.createElement('linkMention', attributes);
        case 'contentEmbed':
            return createMediaEmbed(writer, attributes);
        default:
            // The renderers draw the `opengraph` type as a card, also for a URL with a video.
            return writer.createElement('linkEmbed', {
                ...attributes,
                embedType: mode === 'cardLink' ? 'opengraph' : attributes.embedType
            });
    }
}

/** The element of a link preview of the `mode` shape with the fields `attributes`. */
function getLinkPreviewName(
    mode: Exclude<LinkDisplayMode, 'textLink'>, attributes: Record<string, unknown>
) {
    if (mode === 'iconAndTextLink') {
        return 'linkMention';
    }
    const embedType = attributes.embedType as string | undefined;
    const hasPlayer = mode === 'embedLink'
        && !!getLinkPreviewPlayer({ url: attributes.url as string, embedType });
    return hasPlayer ? 'contentEmbed' : 'linkEmbed';
}

/**
 * The embed type of the Embed shape of a preview of `url` that stores `embedType`: the stored
 * type when the preview plays it, as the server reads the type of a file without an extension,
 * else the type that the host detects from the URL.
 */
function getEmbedType(editor: Editor, url: string, embedType: string | undefined) {
    return embedType && embedType !== 'opengraph' && getLinkPreviewPlayer({ url, embedType })
        ? embedType
        : getLinkEmbedHost(editor).detectEmbedType(url);
}

/** The display mode of the link preview `element`. */
export function getLinkWidgetMode(element: ModelElement): Exclude<LinkDisplayMode, 'textLink'> {
    if (element.name === 'linkMention') return 'iconAndTextLink';
    return element.getAttribute('embedType') === 'opengraph' ? 'cardLink' : 'embedLink';
}

/** Returns the selected linkEmbed or linkMention element, or media embed, or null. */
export function getSelectedLinkWidget(editor: Editor): ModelElement | null {
    const selected = editor.model.document.selection.getSelectedElement();
    if (selected && (selected.name === 'linkMention' || selected.name === 'linkEmbed')) {
        return selected;
    }
    if (selected?.name === 'contentEmbed' && isMediaEmbed(selected)) {
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
