import { type BlockChildLike, chooseLinkPreviewKind, isHttpUrl, isUrlAloneInBlock } from '@triliumnext/commons';
import { ButtonView, clickOutsideHandler, Command, ContextualBalloon, Plugin, toWidget, viewToModelPositionOutsideModelElement, Widget, type Editor, type Observable } from 'ckeditor5';
import linkEmbedIcon from '../icons/link-embed.svg?raw';
import LinkEmbedFormView from './link_embed_form.js';
import { translate } from './translate.js';
import { preventCKEditorHandling } from './widget_utils.js';

export const LINK_EMBED_COMMAND = 'insertLinkEmbed';
export const CHANGE_LINK_DISPLAY_COMMAND = 'changeLinkDisplay';
export const REMOVE_LINK_EMBED_COMMAND = 'removeLinkEmbed';

export const LINK_DISPLAY_MODES = [
    { value: 'inline', label: 'Inline', labelKey: 'link_embed.mode_inline' },
    { value: 'card', label: 'Card', labelKey: 'link_embed.mode_card' },
    { value: 'embed', label: 'Embed', labelKey: 'link_embed.mode_embed' }
] as const;

export type LinkDisplayMode = typeof LINK_DISPLAY_MODES[number]['value'];

const EMBEDDABLE_URL_REGEX = /^https?:\/\/\S+$/;

export default class LinkEmbed extends Plugin {
    static get requires() {
        return [LinkEmbedEditing, LinkEmbedUI, AutoLinkToMention];
    }
}

/**
 * The "Link preview" toolbar button and the balloon form it opens.
 *
 * The form lives inside the editor — the same balloon the native link button uses — rather than in a
 * Trilium modal, so inserting a preview never leaves the editing surface and needs no round trip
 * out to the app and back.
 */
class LinkEmbedUI extends Plugin {

    static get requires() {
        return [ContextualBalloon];
    }

    private _formView: LinkEmbedFormView | null = null;

    init() {
        const editor = this.editor;

        editor.ui.componentFactory.add('linkEmbed', locale => {
            const command = editor.commands.get(LINK_EMBED_COMMAND);
            const buttonView = new ButtonView(locale);

            buttonView.set({
                label: editor.t('Link preview'),
                icon: linkEmbedIcon,
                tooltip: true
            });

            /* v8 ignore next -- LinkEmbedEditing always registers LINK_EMBED_COMMAND (both are required by LinkEmbed), so the no-command branch is unreachable */
            if (command) {
                buttonView.bind('isEnabled').to(command as Observable & { isEnabled: boolean }, 'isEnabled');
            }

            this.listenTo(buttonView, 'execute', () => this._showForm());
            return buttonView;
        });
    }

    override destroy() {
        super.destroy();
        this._formView?.destroy();
    }

    private _showForm() {
        const editor = this.editor;
        const balloon = editor.plugins.get(ContextualBalloon);
        const form = this._getFormView();

        if (balloon.hasView(form)) return;

        form.reset();
        balloon.add({
            view: form,
            position: {
                target: () => {
                    const view = editor.editing.view;
                    const range = view.document.selection.getFirstRange();
                    /* v8 ignore next -- the editing view's selection always has a range while the editor is focused */
                    if (!range) return editor.ui.getEditableElement() as HTMLElement;
                    return view.domConverter.viewRangeToDom(range);
                }
            }
        });
        form.focus();
    }

    private _hideForm() {
        const balloon = this.editor.plugins.get(ContextualBalloon);
        const form = this._formView;

        /* v8 ignore next -- the form is only ever hidden from its own handlers, so by then it exists and is shown */
        if (!form || !balloon.hasView(form)) return;

        balloon.remove(form);
        this.editor.editing.view.focus();
    }

    private _getFormView(): LinkEmbedFormView {
        if (this._formView) return this._formView;

        const editor = this.editor;
        const form = new LinkEmbedFormView(editor.locale, (key, fallback) => translate(editor, key, fallback));
        this._formView = form;

        // The mode selector only offers "Embed" for a URL that has a player behind it — the same
        // question the widget toolbar's dropdown asks of an existing preview.
        form.on('change:url', () => {
            const embedAvailable = detectEmbedTypeFor(editor, form.url) !== 'opengraph';
            form.embedAvailable = embedAvailable;

            // Follow the URL until the user overrules it: a video wants its player, anything else a card.
            if (!this._modePickedByUser) {
                form.mode = embedAvailable ? 'embed' : 'card';
            } else if (!embedAvailable && form.mode === 'embed') {
                form.mode = 'card';
            }
        });

        form.modeDropdownView.on('execute', () => {
            this._modePickedByUser = true;
        });

        form.on('submit', () => {
            void this._insert(form);
        });

        // Esc and clicking away dismiss the form, exactly as they do for the native link balloon.
        form.keystrokes.set('Esc', (_data, cancel) => {
            this._hideForm();
            cancel();
        });
        clickOutsideHandler({
            emitter: form,
            activator: () => this.editor.plugins.get(ContextualBalloon).hasView(form),
            contextElements: () => [this.editor.plugins.get(ContextualBalloon).view.element as HTMLElement],
            callback: () => this._hideForm()
        });

        return form;
    }

    private _modePickedByUser = false;

    private async _insert(form: LinkEmbedFormView) {
        // The Insert button is disabled mid-fetch, but Enter fires `submit` on the form itself, so
        // the guard has to live here or a second Enter would fetch and insert twice.
        if (form.isFetching) return;

        const url = normalizeUrl(form.url);
        if (!url) return;

        // The metadata fetch takes a moment (the server reads the page and downloads the image), so
        // the form stays open and disabled meanwhile rather than vanishing into an apparent no-op.
        form.isFetching = true;
        try {
            await this.editor.execute(LINK_EMBED_COMMAND, { url, mode: form.mode });
        } finally {
            form.isFetching = false;
        }

        this._modePickedByUser = false;
        this._hideForm();
    }
}

/**
 * Makes a typed URL absolute, defaulting the scheme the way the editor's own link field does.
 * Returns null when what was typed cannot be a link preview at all.
 */
function normalizeUrl(rawUrl: string): string | null {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return isHttpUrl(withScheme) ? withScheme : null;
}

/** Asks the host what kind of preview a URL supports. */
function detectEmbedTypeFor(editor: Editor, url: string): string {
    if (!url.trim()) return 'opengraph';

    const editorEl = editor.editing.view.getDomRoot();
    const component = glob.getComponentByEl<EditorComponent>(editorEl);
    return component.detectEmbedType(normalizeUrl(url) ?? url);
}

// ---------------------------------------------------------------------------
// Schema + converters for linkEmbed (block) and linkMention (inline)
// ---------------------------------------------------------------------------

class LinkEmbedEditing extends Plugin {
    static get requires() {
        return [Widget];
    }

    init() {
        this._defineSchema();
        this._defineConverters();

        // linkMention is an empty inline object whose editing view holds a UIElement child, so a
        // view position inside the rendered widget would otherwise resolve to a degenerate model
        // position *inside* the atomic element. Map it just outside the mention instead (mirrors
        // ReferenceLink). The block linkEmbed is a $block object and needs no such mapping.
        this.editor.editing.mapper.on(
            'viewToModelPosition',
            viewToModelPositionOutsideModelElement(this.editor.model, viewElement => viewElement.hasClass('link-mention'))
        );

        this.editor.commands.add(LINK_EMBED_COMMAND, new InsertLinkEmbedCommand(this.editor));
        this.editor.commands.add(CHANGE_LINK_DISPLAY_COMMAND, new ChangeLinkDisplayCommand(this.editor));
        this.editor.commands.add(REMOVE_LINK_EMBED_COMMAND, new RemoveLinkEmbedCommand(this.editor));
    }

    _defineSchema() {
        const schema = this.editor.model.schema;

        schema.register('linkEmbed', {
            isObject: true,
            allowAttributes: ['url', 'embedType', 'title', 'description', 'favicon', 'siteName', 'image'],
            allowWhere: '$block'
        });

        schema.register('linkMention', {
            isInline: true,
            isObject: true,
            // Stores all metadata so we can switch to card/embed without re-fetching.
            allowAttributes: ['url', 'embedType', 'title', 'description', 'favicon', 'siteName', 'image'],
            allowWhere: '$text'
        });
    }

    _defineConverters() {
        const editor = this.editor;
        const conversion = editor.conversion;

        // ===== linkEmbed (block) =====

        conversion.for('upcast').elementToElement({
            model: (viewElement, { writer }) => {
                return writer.createElement('linkEmbed', {
                    url: viewElement.getAttribute('data-url'),
                    embedType: viewElement.getAttribute('data-embed-type'),
                    title: viewElement.getAttribute('data-title'),
                    description: viewElement.getAttribute('data-description'),
                    favicon: viewElement.getAttribute('data-favicon'),
                    siteName: viewElement.getAttribute('data-site-name'),
                    image: viewElement.getAttribute('data-image')
                });
            },
            view: { name: 'section', classes: 'link-embed' }
        });

        conversion.for('dataDowncast').elementToElement({
            model: 'linkEmbed',
            view: (modelElement, { writer }) => {
                const attrs: Record<string, string> = {
                    class: 'link-embed',
                    'data-url': modelElement.getAttribute('url') as string,
                    'data-embed-type': modelElement.getAttribute('embedType') as string
                };
                for (const key of ['title', 'description', 'favicon', 'siteName', 'image'] as const) {
                    const val = modelElement.getAttribute(key) as string | undefined;
                    if (val) {
                        const attrName = key === 'siteName' ? 'data-site-name' : `data-${key}`;
                        attrs[attrName] = val;
                    }
                }
                return writer.createContainerElement('section', attrs);
            }
        });

        conversion.for('editingDowncast').elementToElement({
            model: 'linkEmbed',
            view: (modelElement, { writer }) => {
                const url = modelElement.getAttribute('url') as string;
                const embedType = modelElement.getAttribute('embedType') as string;
                const title = modelElement.getAttribute('title') as string | undefined;
                const description = modelElement.getAttribute('description') as string | undefined;
                const favicon = modelElement.getAttribute('favicon') as string | undefined;
                const siteName = modelElement.getAttribute('siteName') as string | undefined;
                const image = modelElement.getAttribute('image') as string | undefined;

                const section = writer.createContainerElement('section', {
                    class: 'link-embed',
                    'data-url': url,
                    'data-embed-type': embedType
                });

                const preview = writer.createUIElement('div', {
                    class: 'link-embed-preview-wrapper',
                    'data-cke-ignore-events': 'true'
                }, function (domDocument) {
                    const domElement = this.toDomElement(domDocument);
                    const editorEl = editor.editing.view.getDomRoot();
                    const component = glob.getComponentByEl<EditorComponent>(editorEl);
                    component.renderLinkEmbed(domElement, { url, embedType, title, description, favicon, siteName, image }, true);
                    preventCKEditorHandling(domElement, editor);
                    return domElement;
                });

                writer.insert(writer.createPositionAt(section, 0), preview);
                return toWidget(section, writer, { label: 'link embed widget' });
            }
        });

        // ===== linkMention (inline) =====

        conversion.for('upcast').elementToElement({
            model: (viewElement, { writer }) => {
                return writer.createElement('linkMention', {
                    url: viewElement.getAttribute('data-url'),
                    embedType: viewElement.getAttribute('data-embed-type'),
                    title: viewElement.getAttribute('data-title'),
                    description: viewElement.getAttribute('data-description'),
                    favicon: viewElement.getAttribute('data-favicon'),
                    siteName: viewElement.getAttribute('data-site-name'),
                    image: viewElement.getAttribute('data-image')
                });
            },
            view: { name: 'span', classes: 'link-mention' }
        });

        conversion.for('dataDowncast').elementToElement({
            model: 'linkMention',
            view: (modelElement, { writer }) => {
                const attrs: Record<string, string> = {
                    class: 'link-mention',
                    'data-url': modelElement.getAttribute('url') as string
                };
                for (const key of ['embedType', 'title', 'description', 'favicon', 'siteName', 'image'] as const) {
                    const val = modelElement.getAttribute(key) as string | undefined;
                    if (val) {
                        const attrName = key === 'embedType' ? 'data-embed-type'
                            : key === 'siteName' ? 'data-site-name'
                            : `data-${key}`;
                        attrs[attrName] = val;
                    }
                }
                return writer.createContainerElement('span', attrs);
            }
        });

        conversion.for('editingDowncast').elementToElement({
            model: 'linkMention',
            view: (modelElement, { writer }) => {
                const url = modelElement.getAttribute('url') as string;
                const title = modelElement.getAttribute('title') as string | undefined;
                const favicon = modelElement.getAttribute('favicon') as string | undefined;

                const span = writer.createContainerElement('span', {
                    class: 'link-mention',
                    'data-url': url
                });

                const inner = writer.createUIElement('span', {
                    class: 'link-mention-inner',
                    'data-cke-ignore-events': 'true'
                }, function (domDocument) {
                    const domElement = this.toDomElement(domDocument);
                    const editorEl = editor.editing.view.getDomRoot();
                    const component = glob.getComponentByEl<EditorComponent>(editorEl);
                    component.renderLinkMention(domElement, { url, title, favicon }, true);
                    preventCKEditorHandling(domElement, editor);
                    return domElement;
                });

                writer.insert(writer.createPositionAt(span, 0), inner);
                return toWidget(span, writer, { label: 'link mention widget', hasSelectionHandle: false });
            }
        });
    }
}

/**
 * Inserts a preview for a URL: fetches its metadata through the host, then puts the widget in.
 *
 * All the metadata is written onto the element whichever shape is chosen — an inline mention stores
 * the description and image it does not itself show — so that switching modes later, via the widget
 * toolbar's Display dropdown, never has to go back to the network.
 */
class InsertLinkEmbedCommand extends Command {
    override async execute({ url, mode }: { url: string; mode: LinkDisplayMode }) {
        const editor = this.editor;
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

const META_KEYS = ['url', 'embedType', 'title', 'description', 'favicon', 'siteName', 'image'] as const;

/** Returns the currently selected linkEmbed/linkMention element, or null. */
function getSelectedLinkWidget(editor: any) {
    const selected = editor.model.document.selection.getSelectedElement();
    if (selected && (selected.name === 'linkMention' || selected.name === 'linkEmbed')) {
        return selected;
    }
    return null;
}

class ChangeLinkDisplayCommand extends Command {
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

    override execute(options: { value: LinkDisplayMode }) {
        const model = this.editor.model;
        const selected = getSelectedLinkWidget(this.editor);
        if (!selected) return;

        const targetMode = options.value;
        const currentMode = this._getMode(selected);
        if (targetMode === currentMode) return;

        // Collect all metadata from the current element.
        const attrs: Record<string, unknown> = {};
        for (const key of META_KEYS) {
            const val = selected.getAttribute(key);
            if (val != null) attrs[key] = val;
        }

        // Detect the actual embed type from the URL via the client service.
        const url = attrs.url as string;
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
        this.isEnabled = !!selected;
        this.value = selected ? this._getMode(selected) : null;

        if (selected) {
            const url = selected.getAttribute('url') as string;
            this.embedAvailable = this._detectEmbedType(url) !== 'opengraph';
            // Only ever hand out an http(s) URL. `url` comes from the stored `data-url`, which the
            // HTML sanitizers pass through unexamined, so a note carrying `data-url="javascript:…"`
            // would otherwise reach the toolbar's "open link" button as a live href. Withholding it
            // here disables that button (and the copy one) instead of arming them.
            this.url = isHttpUrl(url) ? url : null;
        } else {
            this.embedAvailable = false;
            this.url = null;
        }
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

class RemoveLinkEmbedCommand extends Command {
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

// ---------------------------------------------------------------------------
// Auto-convert typed/pasted URLs to link preview widgets.
// Piggybacks on CKEditor's AutoLink plugin: when AutoLink sets `linkHref` on
// text whose content matches the href (i.e. a raw URL, not "[label](url)"), we
// fetch metadata and replace it with a preview widget.
//
// The shape follows the gesture (see chooseLinkPreviewKind):
//   * a URL left alone on its own line — sole content of a plain paragraph, then
//     Enter — becomes a block preview: a player if the URL is embeddable
//     (YouTube), a card otherwise;
//   * anything else — text either side of it, a list/table/quote/heading, or a
//     caret still in the block because the user is mid-sentence — becomes an
//     inline linkMention.
//
// The user can Ctrl+Z to revert back to a plain link.
// ---------------------------------------------------------------------------

class AutoLinkToMention extends Plugin {
    /** Guard against re-entrant changes triggered by our own model writes. */
    private _converting = false;
    /** URLs that were undone — don't re-convert these. */
    private _dismissed = new Set<string>();

    init() {
        const editor = this.editor;

        editor.model.document.on('change:data', (_evt, batch) => {
            if (this._converting) return;
            if (!this._autoDetectEnabled()) return;

            // When the user undoes our conversion, the undo batch re-inserts
            // the original linked text. Record its URL so we don't re-convert.
            if (batch.isUndo) {
                for (const change of editor.model.document.differ.getChanges()) {
                    if (change.type !== 'attribute' || change.attributeKey !== 'linkHref') continue;
                    if (typeof change.attributeNewValue === 'string') {
                        this._dismissed.add(change.attributeNewValue);
                    }
                }
                return;
            }

            // Detect AutoLink setting `linkHref` on existing text (paste + Space).
            // AutoLink calls writer.setAttribute('linkHref', url, range) which
            // shows up as an attribute change, not a text insertion.
            for (const change of editor.model.document.differ.getChanges()) {
                if (change.type !== 'attribute' || change.attributeKey !== 'linkHref') continue;
                // Only react to newly added links (null → url), not modifications.
                if (change.attributeOldValue !== null) continue;

                const href = change.attributeNewValue as string;
                if (!EMBEDDABLE_URL_REGEX.test(href)) continue;
                if (this._dismissed.has(href)) continue;

                // Walk the affected range to verify the text IS the URL
                // (raw pasted URL, not a labeled link like "click here").
                for (const item of change.range.getWalker()) {
                    if (!item.item.is('$textProxy')) continue;
                    if (item.item.data.trim() !== href) continue;

                    const parent = item.item.parent;
                    /* v8 ignore next -- a $textProxy always has an element parent, so this guard never fires */
                    if (!parent?.is('element')) continue;

                    this._replaceWithPreview(href, parent.getPath());
                    return;
                }
            }
        });
    }

    /**
     * Whether auto-detection is on (Options → Text Notes → Features). Consulted on every detected
     * URL rather than once at startup, so the host can supply a getter and have the option apply to
     * already-open editors. A plain boolean is honoured too, and an absent config means enabled.
     *
     * Only auto-detection is gated: inserting a preview from the toolbar dialog goes through
     * {@link InsertLinkEmbedCommand} and stays available either way.
     */
    private _autoDetectEnabled(): boolean {
        const setting = this.editor.config.get('autoLinkPreviewsEnabled') as boolean | (() => boolean) | undefined;
        return (typeof setting === 'function' ? setting() : setting) !== false;
    }

    private _replaceWithPreview(url: string, parentPath: number[]) {
        const editor = this.editor;
        const editorEl = editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl<EditorComponent>(editorEl);

        component.fetchLinkMetadata(url).then((metadata: LinkEmbedMetadata) => {
            // The page told us nothing (bot challenge, network error, no title of its own): leave the
            // plain link AutoLink already created. A preview built from a hostname placeholder would
            // show strictly less than the URL it replaced.
            if (metadata.unresolved) {
                // The URL is left out on purpose — a browser console gets screenshotted and pasted
                // into bug reports too, and the link is right there in the note anyway.
                console.warn('Link preview dropped: no metadata could be read from the page (the link was kept as a plain link).');
                return;
            }

            // Restored in the `finally`: were a model change ever to throw, a flag left raised would
            // silently switch auto-detection off for the rest of the session.
            this._converting = true;

            try {
                editor.model.change((writer) => {
                    const root = editor.model.document.getRoot();
                    /* v8 ignore next -- the document always has a root once the editor is created */
                    if (!root) return;

                    // Re-resolve the parent from the stored path.
                    let parentEl: any = root;
                    for (const idx of parentPath) {
                        if (!parentEl || typeof parentEl.getChild !== 'function') return;
                        parentEl = parentEl.getChild(idx);
                    }
                    if (!parentEl || !parentEl.is('element')) return;

                    // Find the text node that still contains the URL.
                    const range = writer.createRangeIn(parentEl);
                    for (const item of range.getWalker()) {
                        if (!item.item.is('$textProxy')) continue;
                        if (item.item.data.trim() !== url) continue;
                        if (item.item.getAttribute('linkHref') !== url) continue;

                        // Where the URL sits decides its shape. Evaluated here — at insertion time, not
                        // when the URL was detected — because the metadata fetch is async and the user
                        // may have kept typing meanwhile. Also before deleting anything, since deletion
                        // would empty the block and make it look like the URL was never alone.
                        const kind = chooseLinkPreviewKind(metadata.embedType, {
                            urlAloneInBlock: isUrlAloneInBlock(this._blockChildren(parentEl), url),
                            blockIsStandalone: this._isStandaloneBlock(parentEl),
                            caretLeftBlock: this._caretLeftBlock(parentEl)
                        });

                        const attributes = {
                            url: metadata.url,
                            embedType: metadata.embedType,
                            title: metadata.title,
                            description: metadata.description,
                            favicon: metadata.favicon,
                            siteName: metadata.siteName,
                            image: metadata.image
                        };

                        if (kind === 'mention') {
                            const urlRange = writer.createRangeOn(item.item);
                            writer.setSelection(urlRange);
                            editor.model.deleteContent(editor.model.document.selection);
                            editor.model.insertContent(writer.createElement('linkMention', attributes));
                            return;
                        }

                        // A card or an embed takes over the whole paragraph, which by now holds nothing
                        // but the URL. Swapped with writer.insert/remove rather than insertContent: the
                        // caret has moved on to the next line (that is what made this a block preview in
                        // the first place) and may already be mid-word, so it must not be dragged back.
                        // 'card' vs 'embed' needs no branch here — the renderer keys off embedType,
                        // which is "opengraph" for a card and the provider's own type for an embed.
                        writer.insert(writer.createElement('linkEmbed', attributes), parentEl, 'before');
                        writer.remove(parentEl);
                        return;
                    }
                });
            } finally {
                this._converting = false;
            }
        });
    }

    /**
     * True for a plain top-level paragraph — the only block a card or an embed may take over.
     * A list item is a paragraph carrying list attributes; a table cell, a quote and every other
     * container nest their paragraphs below the root; a heading is not a paragraph at all. In each
     * of those the URL keeps its inline mention, since a block preview there reads as an accident.
     */
    private _isStandaloneBlock(blockEl: any): boolean {
        if (blockEl.name !== 'paragraph') return false;
        if (blockEl.hasAttribute('listItemId')) return false;

        return blockEl.parent === this.editor.model.document.getRoot();
    }

    /**
     * True when the caret is no longer in the block — which is exactly what pressing Enter after the
     * URL does. While it is still there the user may yet type on that line, so the URL has not been
     * *left* alone and stays an inline mention.
     */
    private _caretLeftBlock(blockEl: any): boolean {
        const position = this.editor.model.document.selection.getFirstPosition();

        /* v8 ignore next -- the document selection always has a position */
        return position?.parent !== blockEl;
    }

    /**
     * Maps a model block's children to the runtime-neutral shape consumed by
     * {@link isUrlAloneInBlock}, keeping the decision logic pure and testable.
     */
    private _blockChildren(blockEl: any): BlockChildLike[] {
        const children: BlockChildLike[] = [];
        for (const child of blockEl.getChildren()) {
            const isText = child.is('$text');
            children.push({ isText, data: isText ? child.data : undefined });
        }
        return children;
    }
}
