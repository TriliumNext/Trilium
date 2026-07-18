import { isHttpUrl } from '@triliumnext/commons';
import { Command, findAttributeRange, ModelLiveRange } from 'ckeditor5';

export const LINK_EMBED_COMMAND = 'insertLinkEmbed';
export const CHANGE_LINK_DISPLAY_COMMAND = 'changeLinkDisplay';
export const REMOVE_LINK_EMBED_COMMAND = 'removeLinkEmbed';
export const CHANGE_LINK_PREVIEW_TITLE_COMMAND = 'changeLinkPreviewTitle';

export const LINK_DISPLAY_MODES = [
    { value: 'inline', label: 'Inline', labelKey: 'link_embed.mode_inline' },
    { value: 'card', label: 'Card', labelKey: 'link_embed.mode_card' },
    { value: 'embed', label: 'Embed', labelKey: 'link_embed.mode_embed' },
    // The way out of the preview system: an ordinary <a> link, no widget. Offered in the same
    // dropdowns as the real modes so "back to a normal URL" is found where the user looks for it.
    { value: 'plain', label: 'Plain link', labelKey: 'link_embed.mode_plain' }
] as const;

export type LinkDisplayMode = typeof LINK_DISPLAY_MODES[number]['value'];

/**
 * What a URL must look like before any conversion — automatic or command-driven — considers turning
 * it into a preview: http(s) and free of whitespace. Everything else (an internal `#root/…` note
 * reference, a mailto:, a mid-edit fragment) has no page behind it to preview.
 */
export const EMBEDDABLE_URL_REGEX = /^https?:\/\/\S+$/;

/** Every piece of fetched metadata a linkEmbed/linkMention element stores as a model attribute. */
export const META_KEYS = ['url', 'embedType', 'title', 'description', 'favicon', 'siteName', 'image'] as const;

export type MetaKey = (typeof META_KEYS)[number];

/**
 * Inserts a preview for a URL: fetches its metadata through the host, then puts the widget in.
 *
 * All the metadata is written onto the element whichever shape is chosen — an inline mention stores
 * the description and image it does not itself show — so that switching modes later, via the widget
 * toolbar's Display dropdown, never has to go back to the network.
 */
export class InsertLinkEmbedCommand extends Command {
    override async execute({ url, mode }: { url: string; mode: LinkDisplayMode }) {
        const editor = this.editor;

        // A plain link is not a preview at all, so no metadata is fetched: the URL becomes an
        // ordinary link, exactly as the editor's own link balloon would have inserted it.
        if (mode === 'plain') {
            editor.model.change((writer) => {
                editor.model.insertContent(writer.createText(url, { linkHref: url }));
            });
            return;
        }

        const editorEl = editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl<EditorComponent>(editorEl);

        const metadata = await component.fetchLinkMetadata(url);

        editor.model.change((writer) => {
            editor.model.insertContent(writer.createElement(mode === 'inline' ? 'linkMention' : 'linkEmbed', {
                url: metadata.url,
                // A card is an embed that declines to play: forcing "opengraph" is what tells the
                // renderer to draw the static card rather than the provider's player.
                embedType: mode === 'card' ? 'opengraph' : metadata.embedType,
                title: metadata.title,
                description: metadata.description,
                favicon: metadata.favicon,
                siteName: metadata.siteName,
                image: metadata.image
            }));
        });
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
        const currentMode = this._getMode(selected);
        if (targetMode === currentMode) return;

        // Collect all metadata from the current element.
        const attrs: Record<string, unknown> = {};
        for (const key of META_KEYS) {
            const val = selected.getAttribute(key);
            if (val != null) attrs[key] = val;
        }

        const url = attrs.url as string;

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

        // Detect the actual embed type from the URL via the client service.
        const detectedType = this._detectEmbedType(url);

        model.change(writer => {
            if (targetMode === 'inline') {
                const mention = writer.createElement('linkMention', attrs);
                model.insertContent(mention, writer.createRangeOn(selected));
            } else {
                // 'card' forces opengraph; 'embed' uses detected type.
                attrs.embedType = targetMode === 'card' ? 'opengraph' : detectedType;
                const embed = writer.createElement('linkEmbed', attrs);
                model.insertContent(embed, writer.createRangeOn(selected));
            }
        });
    }

    override refresh() {
        const selected = getSelectedLinkWidget(this.editor);

        if (selected) {
            this.isEnabled = true;
            this.value = this._getMode(selected);
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
        const editor = this.editor;
        const model = editor.model;
        const position = model.document.selection.getFirstPosition();
        const href = model.document.selection.getAttribute('linkHref');
        /* v8 ignore next -- refresh() disables the command unless the selection carries a linkHref */
        if (typeof href !== 'string' || !position) return;
        // The link already is one.
        if (targetMode === 'plain') return;

        const editorEl = editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl<EditorComponent>(editorEl);

        // The linked text is tracked as a live range: the metadata fetch reads the page server-side
        // and can take seconds, and edits made meanwhile must not shift what gets replaced.
        const liveRange = ModelLiveRange.fromRange(findAttributeRange(position, 'linkHref', href, model));
        const metadata = await component.fetchLinkMetadata(href);
        const range = liveRange.toRange();
        liveRange.detach();

        model.change(writer => {
            // The link may have been edited away while the fetch was in flight.
            let linkStillThere = false;
            for (const { item } of range.getWalker()) {
                if (item.is('$textProxy') && item.getAttribute('linkHref') === href) {
                    linkStillThere = true;
                    break;
                }
            }
            if (!linkStillThere) return;

            const element = writer.createElement(targetMode === 'inline' ? 'linkMention' : 'linkEmbed', {
                url: metadata.url,
                // Same rule as the widget path above: a card is an embed that declines to play.
                embedType: targetMode === 'card' ? 'opengraph'
                    : targetMode === 'embed' ? this._detectEmbedType(href)
                    : metadata.embedType,
                title: metadata.title,
                description: metadata.description,
                favicon: metadata.favicon,
                siteName: metadata.siteName,
                image: metadata.image
            });

            model.insertContent(element, range);
            // Leave the new widget selected, so its toolbar — this same dropdown included — takes
            // over from the link balloon.
            writer.setSelection(element, 'on');
        });
    }

    private _getMode(element: any): LinkDisplayMode {
        if (element.name === 'linkMention') return 'inline';
        const embedType = element.getAttribute('embedType') as string;
        return embedType === 'opengraph' ? 'card' : 'embed';
    }

    /** Delegates to the client service to avoid duplicating URL detection logic. */
    private _detectEmbedType(url: string): string {
        const editorEl = this.editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl<EditorComponent>(editorEl);
        return component.detectEmbedType(url);
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
 * Edits the title a link preview displays — the pill text of a mention, the heading of a card.
 * The preview counterpart of the "Displayed text" field the editor's own link form offers for
 * native links: the fetched title is often noisy ("Article | Site | Section"), and converting a
 * labeled link replaces the user's wording, so both need a way back to words of the user's choosing.
 *
 * `value` is what the preview currently shows (the stored title, or the hostname the renderers
 * fall back to), for the edit form to prefill. As in the official form, saving it back unchanged —
 * or blank — changes nothing.
 */
export class ChangeLinkPreviewTitleCommand extends Command {
    declare value: string | null;

    override execute({ title }: { title: string }) {
        const model = this.editor.model;
        const selected = getSelectedLinkWidget(this.editor);
        if (!selected) return;

        const newTitle = title.trim();
        if (!newTitle || newTitle === effectiveTitle(selected)) return;

        model.change(writer => {
            const attrs: Record<string, unknown> = {};
            for (const key of META_KEYS) {
                const val = selected.getAttribute(key);
                if (val != null) attrs[key] = val;
            }
            attrs.title = newTitle;

            // Clone-replace rather than setAttribute: the editing downcast is elementToElement,
            // which does not re-render on attribute changes — replacing does (and it is how mode
            // switching already works). The widget stays selected, so its toolbar stays up.
            const replacement = writer.createElement(selected.name, attrs);
            model.insertContent(replacement, writer.createRangeOn(selected));
            writer.setSelection(replacement, 'on');
        });
    }

    override refresh() {
        const selected = getSelectedLinkWidget(this.editor);
        this.isEnabled = !!selected;
        this.value = selected ? effectiveTitle(selected) : null;
    }
}

/**
 * The title a preview currently displays: its stored title, or — mirroring the renderers'
 * fallback (see MentionPreview in the client) — the hostname of its URL.
 */
function effectiveTitle(element: any): string {
    const title = element.getAttribute('title') as string | undefined;
    if (title) return title;

    /* v8 ignore next -- every linkEmbed/linkMention is created with a url attribute (a widget without one does not even render), so the fallback arm is unreachable */
    const url = (element.getAttribute('url') ?? '') as string;
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

/** Returns the currently selected linkEmbed/linkMention element, or null. */
function getSelectedLinkWidget(editor: any) {
    const selected = editor.model.document.selection.getSelectedElement();
    if (selected && (selected.name === 'linkMention' || selected.name === 'linkEmbed')) {
        return selected;
    }
    return null;
}
