import {
    BookmarkEditing, ButtonView, Command, ContextualBalloon, findAttributeRange, IconLink,
    IconPencil, LinkUI, ModelLiveRange, Plugin
} from 'ckeditor5';
import type { Editor, LinkCommand, ModelRange, View } from 'ckeditor5';
import HostedBalloon from '../hosted_balloon.js';
import internalLinkIcon from '../icons/trilium.svg?raw';
import {
    getLinkWidgetMode, getSelectedLinkWidget, type LinkDisplayMode
} from './link_embed/link_embed_commands.js';
import ReferenceLink, {
    getReferenceTitle, getReferenceTitleSync, getSelectedReference, referenceAttributes
} from './referencelink';

export const COMMAND_NAME = 'insertInternalLink';

/** The keystroke of `LinkUI`, which opens its link form. */
const LINK_KEYSTROKE = 'Ctrl+K';

export interface InternalLinkDialogOptions {
    /** The side the dialog opens on for a new link: a note, or a web address. */
    target?: 'note' | 'url';
    /**
     * How a new web link is displayed. `embed` falls back to a card for an address without a
     * player.
     */
    display?: LinkDisplayMode;
}

/** The request that the editor passes to the host's link dialog. */
export interface LinkDialogRequest extends InternalLinkDialogOptions {
    /** The element to render the dialog into, which the editor owns and places at the caret. */
    container: HTMLElement;
    /** Closes the balloon. The host calls it once the link is applied. */
    close(): void;
}

export default class InternalLinkPlugin extends Plugin {

    static get requires() {
        return [ ReferenceLink, ContextualBalloon ];
    }

    private dialog = new HostedBalloon(this.editor, 'edit-link-balloon');

	init() {
		const editor = this.editor;
		const t = editor.t;

        editor.commands.add(COMMAND_NAME, new InsertInternalLinkCommand(editor));

		editor.ui.componentFactory.add('internalLink', locale => {
			const view = new ButtonView( locale );

			// The shortcut is a `keystroke` rather than part of the label, so CKEditor appends it to
			// the tooltip itself — rendered as ⌘L on macOS, where the binding really is
			// `CommandOrControl+L`, and left out of the string translators see.
			view.set( {
				label: t('Internal link'),
				icon: internalLinkIcon,
				keystroke: 'CTRL+L',
				tooltip: true
			} );

            // enable internal link only if the editor is not read only
			const command = editor.commands.get(COMMAND_NAME)!;
            view.bind('isEnabled').to(command, 'isEnabled');
			view.on('execute', () => {
                editor.execute(COMMAND_NAME);
			} );

			return view;
		});
	}

    /**
     * Opens the link dialog from every place `LinkUI` opens its link form: the `link` and
     * `editLink` buttons, Ctrl+K in the text and Ctrl+K in the link toolbar. A new link opens on
     * the web link side.
     */
    afterInit() {
        const editor = this.editor;
        const t = editor.t;
        const command = editor.commands.get(COMMAND_NAME);
        if (!editor.plugins.has(LinkUI) || !command || !editor.config.get('internalLink')) {
            return;
        }

        const linkUI = editor.plugins.get(LinkUI);
        const openLinkDialog = () => {
            // `_hideUI()` is private, and the only way to close the toolbar with its listeners.
            (linkUI as unknown as { _hideUI(updateFocus?: boolean): void })._hideUI(false);
            editor.execute(COMMAND_NAME, { target: 'url' });
        };

        editor.ui.componentFactory.add('link', locale => {
            const linkCommand = editor.commands.get('link') as LinkCommand;
            const button = new ButtonView(locale);
            button.set({
                label: t('Link'),
                icon: IconLink,
                keystroke: LINK_KEYSTROKE,
                isToggleable: true,
                tooltip: true
            });
            button.bind('isEnabled').to(command, 'isEnabled');
            button.bind('isOn').to(linkCommand, 'value', value => !!value);
            this.listenTo(button, 'execute', openLinkDialog);
            return button;
        });

        editor.ui.componentFactory.add('editLink', locale => {
            const button = new ButtonView(locale);
            button.set({
                label: t('Edit link'),
                icon: IconPencil,
                tooltip: true
            });
            button.bind('isEnabled').to(command, 'isEnabled');
            this.listenTo(button, 'execute', openLinkDialog);
            return button;
        });

        // Ahead of the keystroke of `LinkUI`, which opens the link form.
        editor.keystrokes.set(LINK_KEYSTROKE, (_data, cancel) => {
            cancel();
            openLinkDialog();
        }, { priority: 'high' });

        // `LinkUI` creates its toolbar the first time it shows, with a Ctrl+K that opens the link
        // form. `editor.keystrokes` also listens on the toolbar, and opens the dialog.
        let isToolbarKeystrokeSet = false;
        const balloon = editor.plugins.get(ContextualBalloon);
        this.listenTo(balloon, 'change:visibleView', (_evt, _name, view: View | null) => {
            const toolbarView = linkUI.toolbarView;
            if (isToolbarKeystrokeSet || !toolbarView || view !== toolbarView) {
                return;
            }
            toolbarView.keystrokes.set(LINK_KEYSTROKE, (_data, cancel) => cancel(), {
                priority: 'high'
            });
            isToolbarKeystrokeSet = true;
        });
    }

    override destroy() {
        this.dialog.hide();
        super.destroy();
    }

    /**
     * Opens the link dialog in a balloon at the caret. A host that shows the dialog its own way
     * leaves the balloon empty, which closes it again.
     */
    showDialog(options: InternalLinkDialogOptions = {}) {
        const editor = this.editor;

        this.dialog.show(container => editor.config.get('internalLink')?.showDialog({
            ...options,
            container,
            close: () => this.dialog.hide()
        }) ?? null);
    }
}

class InsertInternalLinkCommand extends Command {

    refresh() {
        const selection = this.editor.model.document.selection;
        const position = selection.getFirstPosition();
        const isInCodeBlock = position?.findAncestor("codeBlock");

        this.isEnabled = !this.editor.isReadOnly && !isInCodeBlock;
    }

    execute(options?: InternalLinkDialogOptions) {
        this.editor.plugins.get(InternalLinkPlugin).showDialog(options);
    }
}

/** A link in the text, a reference link or a link preview, as the link dialog edits it. */
export interface LinkAtSelection {
    href: string;
    /** The whole text of a link, or the title of a reference link or a preview. */
    text: string;
    /** The description of a preview. A link has none. */
    description?: string;
    display: LinkDisplayMode;
    /** Whether the link is a reference link, whose text follows the title of its note. */
    isReference?: boolean;
}

/**
 * The link around the selection, or the selected reference link or link preview, or `null`
 * outside one.
 */
export function getLinkAtSelection(editor: Editor): LinkAtSelection | null {
    const reference = getSelectedReference(editor);
    if (reference) {
        const href = reference.getAttribute('href') as string;
        const storedTitle = reference.getAttribute('storedTitle') as string | undefined;
        return {
            href,
            text: getReferenceTitleSync(editor, href, storedTitle),
            display: 'plain',
            isReference: true
        };
    }

    const preview = getSelectedLinkWidget(editor);
    if (preview) {
        return {
            href: preview.getAttribute('url') as string,
            text: (preview.getAttribute('title') as string | undefined) ?? '',
            description: (preview.getAttribute('description') as string | undefined) ?? '',
            display: getLinkWidgetMode(preview)
        };
    }

    const found = findLinkAtSelection(editor);
    if (!found) {
        return null;
    }

    let text = '';
    for (const item of found.range.getItems()) {
        if (item.is('$textProxy')) {
            text += item.data;
        }
    }
    return { href: found.href, text, display: 'plain' };
}

/**
 * Replaces the link around the selection, or the selected reference link or link preview, with
 * `text` linking to `href`, keeping the formatting of the link's start, or with a reference to the
 * note at `href` when `text` is `null`. A reference replaces
 * the link once `getReferenceTitle()` resolves, in one undo step with the removal, and
 * takes the caret along only if the user has not moved it in the meantime.
 */
export async function replaceLinkAtSelection(editor: Editor, href: string, text: string | null) {
    const found = findLinkAtSelection(editor);
    if (!found) {
        return;
    }

    const model = editor.model;
    if (text === null) {
        const range = ModelLiveRange.fromRange(found.range);
        const selection = model.document.selection;
        let selectionMoved = false;
        const onSelectionChange = (_event: unknown, data: { directChange: boolean }) => {
            selectionMoved = data.directChange || selectionMoved;
        };
        selection.on('change:range', onSelectionChange);
        try {
            const title = await getReferenceTitle(editor, href);
            if (range.root.rootName === '$graveyard') {
                return;
            }
            model.change((writer) => {
                const attributes = referenceAttributes(href, title);
                const reference = writer.createElement('reference', attributes);
                // `insertContent()` puts a paragraph around it in place of a block preview.
                model.insertContent(reference, range);
                if (!selectionMoved) {
                    writer.setSelection(reference, 'after');
                }
            });
        } finally {
            selection.off('change:range', onSelectionChange);
            range.detach();
        }
        return;
    }

    model.change((writer) => {
        // A link ends where its attribute does, so its range starts at the boundary of a node.
        const first = found.range.start.nodeAfter;
        const attributes = new Map(first?.is('$text') ? first.getAttributes() : []);
        attributes.set('linkHref', href);
        const inserted = model.insertContent(writer.createText(text, attributes), found.range);
        writer.setSelection(inserted.end);
    });
}

/** The names of the anchors in the document, sorted as the anchor list of `LinkUI` sorts them. */
export function getAnchorNames(editor: Editor): string[] {
    if (!editor.plugins.has(BookmarkEditing)) {
        return [];
    }

    const names = editor.plugins.get(BookmarkEditing).getAllBookmarkNames();
    return [ ...names ].sort((a, b) => a.localeCompare(b));
}

function findLinkAtSelection(editor: Editor): { href: string; range: ModelRange } | null {
    const model = editor.model;
    const reference = getSelectedReference(editor);
    if (reference) {
        return { href: reference.getAttribute('href') as string, range: model.createRangeOn(reference) };
    }

    const preview = getSelectedLinkWidget(editor);
    if (preview) {
        return { href: preview.getAttribute('url') as string, range: model.createRangeOn(preview) };
    }

    const selection = model.document.selection;
    const href = selection.getAttribute('linkHref');
    const position = selection.getFirstPosition();
    if (typeof href !== 'string' || !position) {
        return null;
    }

    return { href, range: findAttributeRange(position, 'linkHref', href, model) };
}

declare module 'ckeditor5' {
    interface EditorConfig {
        internalLink?: {
            /**
             * Renders the dialog that adds a link at the selection, or edits the link there, into
             * `request.container`, and returns the function that removes it. A host that shows the
             * dialog somewhere else (a phone, which has no room for a balloon) leaves the container
             * alone and returns `null`.
             */
            showDialog(request: LinkDialogRequest): (() => void) | null;
        };
    }
}
