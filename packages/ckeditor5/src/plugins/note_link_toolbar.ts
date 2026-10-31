import { parseBlockRange } from '@triliumnext/commons/src/lib/block_reference.js';
import {
    BookmarkEditing, ButtonView, Command, type Editor, IconUnlink, LinkUI, type ModelElement,
    Plugin, type ViewElement, WidgetToolbarRepository
} from 'ckeditor5';

import { BLOCK_ID } from './block_reference/block_reference_editing.js';
import { showAnchorElement, showBlocks } from './block_reference/block_reference_read_only.js';
import { createCopyUrlButton } from './copy_link_url.js';
import InternalLinkPlugin from './internallink.js';
import {
    LinkEmbedPreviewButtonView, type LinkEmbedPreviewNavigateEvent
} from './link_embed/link_embed_toolbar.js';
import {
    getAttachmentId, getNoteId, getReferenceTitleSync, getSelectedReference
} from './referencelink.js';

export const UNLINK_REFERENCE_COMMAND = 'unlinkReference';

/**
 * The toolbar of a link to a note. A link in the text shows the link toolbar of `LinkUI`, and a
 * reference link shows a widget toolbar with the same buttons. In both, the first button reads
 * "Open note" instead of the address. A link into the same note reads "Jump to heading", "Jump to
 * block" or "Jump to anchor", as does an anchor link.
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
            button.on<LinkEmbedPreviewNavigateEvent>('navigate', (_evt, href, cancel) => {
                if (jumpInNote(editor, href)) {
                    cancel();
                }
            });
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
                // Ahead of the provider of `BookmarkUI`, which reads an anchor link as its name.
                order: -1,
                getListItems: () => [],
                getItem: href => {
                    if (getLinkedAnchor(editor, href)) {
                        return { href, label: editor.t('Jump to anchor') };
                    }

                    return NOTE_LINK.test(href)
                        ? { href, label: getOpenLinkLabel(editor, href) }
                        : null;
                },
                navigate: ({ href }) => jumpInNote(editor, href)
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

/**
 * The text of the button that follows the link `href` to a note, an attachment, or blocks or an
 * anchor of the note in the editor.
 */
function getOpenLinkLabel(editor: Editor, href: string) {
    if (getAttachmentId(href)) {
        return editor.t('Open attachment');
    }

    const target = getInNoteTarget(editor, href);
    if (target?.block) {
        const [ first, last ] = findBlockRange(editor, target.block) ?? [];
        return first && first === last && /^heading[1-6]$/.test(first.name)
            ? editor.t('Jump to heading')
            : editor.t('Jump to block');
    }

    return target?.bookmark ? editor.t('Jump to anchor') : editor.t('Open note');
}

/**
 * The `block` and `bookmark` parameters of `href` when it links to the note in the editor, or
 * `null` for a link elsewhere.
 */
function getInNoteTarget(editor: Editor, href: string) {
    const noteId = editor.config.get('getNoteId')?.();
    if (!noteId || !NOTE_LINK.test(href) || getNoteId(href) !== noteId) {
        return null;
    }

    const params = new URLSearchParams(href.split('?')[1]);
    return { block: params.get('block'), bookmark: params.get('bookmark') };
}

/**
 * The first and the last block of the note in the editor that `value`, a `block` link parameter,
 * points at, in document order, or `null` when one is missing.
 */
function findBlockRange(editor: Editor, value: string): [ ModelElement, ModelElement ] | null {
    const range = parseBlockRange(value);
    const start = range && findBlock(editor, range.startId);
    const end = range && range.endId !== range.startId ? findBlock(editor, range.endId) : start;
    if (!start || !end) {
        return null;
    }

    return end.isBefore(start) ? [ end, start ] : [ start, end ];
}

/** The block of the note in the editor whose block id is `blockId`, or `null`. */
function findBlock(editor: Editor, blockId: string) {
    const root = editor.model.document.getRoot() as ModelElement;
    for (const item of editor.model.createRangeIn(root).getItems()) {
        if (item.is('element') && item.getAttribute(BLOCK_ID) === blockId) {
            return item;
        }
    }

    return null;
}

/** The anchor of the document that `href` links to, or `null`. */
function getLinkedAnchor(editor: Editor, href: string) {
    return href.startsWith('#') ? findAnchor(editor, href.slice(1)) : null;
}

/** The anchor of the note in the editor named `name`, or `null`. */
function findAnchor(editor: Editor, name: string) {
    return editor.plugins.has(BookmarkEditing)
        ? editor.plugins.get(BookmarkEditing).getElementForBookmarkId(name)
        : null;
}

/** The element of the editing view's DOM that renders `element` of the model. */
function toDomElement(editor: Editor, element: ModelElement) {
    // Every element in the model document has a view element.
    const viewElement = editor.editing.mapper.toViewElement(element) as ViewElement;
    return editor.editing.view.domConverter.mapViewToDom(viewElement);
}

/**
 * Scrolls to the blocks or the anchor of the note that `href` links to and flashes them, as a link
 * within a page does. Returns whether it does. A click with Ctrl, Cmd or Shift is left to the
 * host, which opens the link in a new tab or window.
 *
 * The targets are found in the model, as the editing view also renders the content of included
 * notes, with block ids and anchor names of their own.
 */
function jumpInNote(editor: Editor, href: string) {
    // The `navigate` event of `LinkUI` does not pass the click, so it is read from `window`.
    const click = window.event;
    if (click instanceof MouseEvent && (click.ctrlKey || click.metaKey || click.shiftKey)) {
        return false;
    }

    const target = getInNoteTarget(editor, href);
    if (target?.block) {
        // The host opens a broken range in the note context, which shows the error.
        const [ first, last ] = (findBlockRange(editor, target.block) ?? [])
            .map(block => toDomElement(editor, block));
        if (first && last) {
            showBlocks(first, last);
        }
        return !!first && !!last;
    }

    const anchor = target?.bookmark
        ? findAnchor(editor, target.bookmark)
        : getLinkedAnchor(editor, href);
    const element = anchor && toDomElement(editor, anchor);
    if (element) {
        showAnchorElement(element);
    }
    return !!element;
}

declare module 'ckeditor5' {
    interface PluginsMap {
        [NoteLinkToolbar.pluginName]: NoteLinkToolbar;
    }
}
