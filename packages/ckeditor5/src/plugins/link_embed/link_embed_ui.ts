import { isHttpUrl } from '@triliumnext/commons';
import { ButtonView, clickOutsideHandler, ContextualBalloon, Plugin, type Editor, type Observable } from 'ckeditor5';
import linkPreviewIcon from '../../icons/link-preview.svg?raw';
import { translate } from '../translate.js';
import { LINK_EMBED_COMMAND } from './link_embed_commands.js';
import LinkEmbedFormView from './link_embed_form.js';

/**
 * The "Link preview" toolbar button and the balloon form it opens.
 *
 * The form lives inside the editor — the same balloon the native link button uses — rather than in a
 * Trilium modal, so inserting a preview never leaves the editing surface and needs no round trip
 * out to the app and back.
 */
export default class LinkEmbedUI extends Plugin {

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
                icon: linkPreviewIcon,
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
        // Whatever mode the user picked was for the URL of this session — however it ended, the
        // next form opening follows its own URL again.
        this._modePickedByUser = false;
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
