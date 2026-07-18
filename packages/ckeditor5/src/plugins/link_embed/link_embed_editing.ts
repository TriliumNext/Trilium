import { Plugin, toWidget, viewToModelPositionOutsideModelElement, Widget } from 'ckeditor5';
import { preventCKEditorHandling } from '../widget_utils.js';
import {
    CHANGE_LINK_DISPLAY_COMMAND,
    CHANGE_LINK_PREVIEW_TITLE_COMMAND,
    ChangeLinkDisplayCommand,
    ChangeLinkPreviewTitleCommand,
    InsertLinkEmbedCommand,
    LINK_EMBED_COMMAND,
    META_KEYS,
    REMOVE_LINK_EMBED_COMMAND,
    RemoveLinkEmbedCommand,
    type MetaKey
} from './link_embed_commands.js';

/**
 * Schema, converters and command registration for linkEmbed (block) and linkMention (inline).
 */
export default class LinkEmbedEditing extends Plugin {
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
        this.editor.commands.add(CHANGE_LINK_PREVIEW_TITLE_COMMAND, new ChangeLinkPreviewTitleCommand(this.editor));
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
                return writer.createContainerElement(
                    'section',
                    metadataViewAttributes(modelElement, 'link-embed', ['url', 'embedType'])
                );
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

                const section = writer.createContainerElement(
                    'section',
                    metadataViewAttributes(modelElement, 'link-embed', ['url', 'embedType'])
                );

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
                // hasSelectionHandle gives the block preview (both card and video) CKEditor's own
                // widget drag handle — the same one tables use. Without a handle the user grabs the
                // preview's own content and the browser's native drag tears the image and text apart;
                // the handle moves the whole widget atomically instead.
                return toWidget(section, writer, { label: 'link embed widget', hasSelectionHandle: true });
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
                return writer.createContainerElement(
                    'span',
                    metadataViewAttributes(modelElement, 'link-mention', ['url'])
                );
            }
        });

        conversion.for('editingDowncast').elementToElement({
            model: 'linkMention',
            view: (modelElement, { writer }) => {
                const url = modelElement.getAttribute('url') as string;
                const title = modelElement.getAttribute('title') as string | undefined;
                const favicon = modelElement.getAttribute('favicon') as string | undefined;

                const span = writer.createContainerElement(
                    'span',
                    metadataViewAttributes(modelElement, 'link-mention', ['url'])
                );

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

const DATA_ATTR_NAMES: Record<MetaKey, string> = {
    url: 'data-url',
    embedType: 'data-embed-type',
    title: 'data-title',
    description: 'data-description',
    favicon: 'data-favicon',
    siteName: 'data-site-name',
    image: 'data-image'
};

/**
 * Builds the widget wrapper's class + `data-*` attributes from a linkEmbed/linkMention element.
 *
 * Shared by the data AND the editing downcast on purpose: a copy gesture that starts inside the
 * rendered preview (a `data-cke-ignore-events` subtree, which CKEditor's clipboard pipeline
 * deliberately ignores) is handled natively by the browser and puts the *editing* markup on the
 * clipboard. Since upcast rebuilds the widget purely from the wrapper's `data-*` attributes, any
 * metadata missing from the editing wrapper would be silently lost on paste — historically the
 * favicon and title of a copied mention.
 */
function metadataViewAttributes(
    modelElement: { getAttribute(key: string): unknown },
    className: string,
    requiredKeys: readonly MetaKey[]
): Record<string, string> {
    const attrs: Record<string, string> = { class: className };
    for (const key of META_KEYS) {
        const val = modelElement.getAttribute(key) as string | undefined;
        if (val || requiredKeys.includes(key)) {
            attrs[DATA_ATTR_NAMES[key]] = val as string;
        }
    }
    return attrs;
}
