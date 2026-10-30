import {
    ButtonView, Command, type Editor, IconUnlink, LinkUI, type ModelElement, Plugin,
    WidgetToolbarRepository
} from 'ckeditor5';

import { createCopyUrlButton } from './copy_link_url.js';
import InternalLinkPlugin from './internallink.js';
import { LinkEmbedPreviewButtonView } from './link_embed/link_embed_toolbar.js';
import { getAttachmentId, getReferenceTitleSync, getSelectedReference } from './referencelink.js';

export const UNLINK_REFERENCE_COMMAND = 'unlinkReference';

/**
 * The toolbar of a link to a note. A link in the text shows the link toolbar of `LinkUI`, and a
 * reference link shows a widget toolbar with the same buttons. In both, the first button reads
 * "Open note" instead of the address.
 */
export default class NoteLinkToolbar extends Plugin {

    /** The `href` of the selected reference link, or `null` when the selection holds none. */
    declare referenceHref: string | null;

    static get requires() {
        return [ WidgetToolbarRepository, InternalLinkPlugin ] as const;
    }

    static get pluginName() {
        return 'NoteLinkToolbar' as const;
    }

    init() {
        const editor = this.editor;
        const factory = editor.ui.componentFactory;
        const unlinkCommand = new UnlinkReferenceCommand(editor);
        editor.commands.add(UNLINK_REFERENCE_COMMAND, unlinkCommand);

        this.set('referenceHref', null);
        this.listenTo(editor.model.document, 'change', () => {
            const href = getSelectedReference(editor)?.getAttribute('href');
            this.referenceHref = typeof href === 'string' ? href : null;
        });

        factory.add('referenceLinkPreview', locale => {
            const button = new LinkEmbedPreviewButtonView(locale);
            button.bind('href').to(this, 'referenceHref', href => href ?? undefined);
            button.bind('label').to(this, 'referenceHref',
                href => href ? getOpenLinkLabel(editor, href) : undefined);
            return button;
        });

        factory.add('referenceLinkCopyUrl', locale =>
            createCopyUrlButton(editor, locale, () => this.referenceHref)
        );

        factory.add('referenceLinkUnlink', locale => {
            const button = new ButtonView(locale);
            button.set({
                label: editor.t('Unlink'),
                icon: IconUnlink,
                tooltip: true
            });
            button.bind('isEnabled').to(unlinkCommand);
            button.on('execute', () => {
                editor.execute(UNLINK_REFERENCE_COMMAND);
                editor.editing.view.focus();
            });
            return button;
        });
    }

    afterInit() {
        const editor = this.editor;

        if (editor.plugins.has(LinkUI)) {
            editor.plugins.get(LinkUI).registerLinksListProvider({
                label: editor.t('Internal link'),
                getListItems: () => [],
                getItem: href => NOTE_LINK.test(href)
                    ? { href, label: getOpenLinkLabel(editor, href) }
                    : null
            });
        }

        editor.plugins.get(WidgetToolbarRepository).register('referenceLink', {
            items: [
                'referenceLinkPreview', 'referenceLinkCopyUrl', '|', 'editLink', 'referenceLinkUnlink'
            ],
            balloonClassName: 'ck-toolbar-container reference-link-toolbar',
            getRelatedElement(selection) {
                const element = selection.getSelectedElement();
                return element?.hasClass('reference-link') ? element : null;
            }
        });
    }
}

/** Replaces the selected reference link with its title as plain text. */
class UnlinkReferenceCommand extends Command {

    override refresh() {
        this.isEnabled = !!getSelectedReference(this.editor);
    }

    override execute() {
        const editor = this.editor;
        // `refresh()` disables the command without a selected reference.
        const reference = getSelectedReference(editor) as ModelElement;
        const href = reference.getAttribute('href') as string;
        const storedTitle = reference.getAttribute('storedTitle') as string | undefined;
        const title = getReferenceTitleSync(editor, href, storedTitle);
        const model = editor.model;
        model.change(writer => {
            const range = model.createRangeOn(reference);
            const inserted = model.insertContent(writer.createText(title), range);
            writer.setSelection(inserted.end);
        });
    }
}

/** A link to a note or to an attachment of one, as opposed to a web address or an anchor. */
const NOTE_LINK = /^#root(?:[/?]|$)/;

/** The text of the button that opens the note or attachment `href` points to. */
function getOpenLinkLabel(editor: Editor, href: string) {
    return getAttachmentId(href) ? editor.t('Open attachment') : editor.t('Open note');
}

declare module 'ckeditor5' {
    interface PluginsMap {
        [NoteLinkToolbar.pluginName]: NoteLinkToolbar;
    }
}
