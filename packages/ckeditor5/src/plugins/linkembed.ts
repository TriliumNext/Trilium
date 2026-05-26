import { ButtonView, Command, Plugin, toWidget, Widget, type Observable } from 'ckeditor5';
import linkEmbedIcon from '../icons/link-embed.svg?raw';
import { preventCKEditorHandling } from './widget_utils.js';

export const LINK_EMBED_COMMAND = 'insertLinkEmbed';
export const CHANGE_LINK_DISPLAY_COMMAND = 'changeLinkDisplay';

export const LINK_DISPLAY_MODES = [
    { value: 'inline', label: 'Inline' },
    { value: 'card', label: 'Card' },
    { value: 'embed', label: 'Embed' }
] as const;

export type LinkDisplayMode = typeof LINK_DISPLAY_MODES[number]['value'];

const EMBEDDABLE_URL_REGEX = /^https?:\/\/\S+$/;

export default class LinkEmbed extends Plugin {
    static get requires() {
        return [LinkEmbedEditing, LinkEmbedUI, AutoLinkToMention];
    }
}

class LinkEmbedUI extends Plugin {
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

            if (command) {
                buttonView.bind('isOn', 'isEnabled').to(
                    command as Observable & { value: boolean } & { isEnabled: boolean },
                    'value', 'isEnabled'
                );
            }

            this.listenTo(buttonView, 'execute', () => editor.execute(LINK_EMBED_COMMAND));
            return buttonView;
        });
    }
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
        this.editor.commands.add(LINK_EMBED_COMMAND, new InsertLinkEmbedCommand(this.editor));
        this.editor.commands.add(CHANGE_LINK_DISPLAY_COMMAND, new ChangeLinkDisplayCommand(this.editor));
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

class InsertLinkEmbedCommand extends Command {
    override execute() {
        const editorEl = this.editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl(editorEl);
        component.triggerCommand('addLinkEmbedToText');
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

class ChangeLinkDisplayCommand extends Command {
    declare value: LinkDisplayMode | null;
    /** Whether the selected link supports embed mode (e.g. YouTube). */
    declare embedAvailable: boolean;

    constructor(editor: any) {
        super(editor);
        // Register as observable so CKEditor's bind().to() works.
        this.set('embedAvailable', false);
    }

    override execute(options: { value: LinkDisplayMode }) {
        const model = this.editor.model;
        const selected = this._getSelectedLinkWidget();
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
        const selected = this._getSelectedLinkWidget();
        this.isEnabled = !!selected;
        this.value = selected ? this._getMode(selected) : null;

        if (selected) {
            const url = selected.getAttribute('url') as string;
            this.embedAvailable = this._detectEmbedType(url) !== 'opengraph';
        } else {
            this.embedAvailable = false;
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

    private _getSelectedLinkWidget() {
        const selection = this.editor.model.document.selection;
        const selected = selection.getSelectedElement();
        if (selected && (selected.name === 'linkMention' || selected.name === 'linkEmbed')) {
            return selected;
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Auto-convert pasted URLs to linkMention widgets.
// Piggybacks on CKEditor's AutoLink plugin: when AutoLink sets `linkHref` on
// text whose content matches the href (i.e. a raw pasted URL, not
// "[label](url)"), we fetch metadata and replace it with a linkMention.
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
                    if (!parent?.is('element')) continue;

                    this._replaceWithMention(href, parent.getPath());
                    return;
                }
            }
        });
    }

    private _replaceWithMention(url: string, parentPath: number[]) {
        const editor = this.editor;
        const editorEl = editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl<EditorComponent>(editorEl);

        component.fetchLinkMetadata(url).then((metadata: LinkEmbedMetadata) => {
            this._converting = true;

            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
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

                    const start = writer.createPositionAt(parentEl, item.item.startOffset!);
                    const end = writer.createPositionAt(parentEl, item.item.startOffset! + item.item.data.length);

                    const urlRange = writer.createRange(start, end);
                    writer.setSelection(urlRange);
                    editor.model.deleteContent(editor.model.document.selection);

                    editor.model.insertContent(writer.createElement('linkMention', {
                        url: metadata.url,
                        embedType: metadata.embedType,
                        title: metadata.title,
                        description: metadata.description,
                        favicon: metadata.favicon,
                        siteName: metadata.siteName,
                        image: metadata.image
                    }));
                    return;
                }
            });

            this._converting = false;
        });
    }
}
