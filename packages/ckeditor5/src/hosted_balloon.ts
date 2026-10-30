import {
    ContextualBalloon, type Editor, KeystrokeHandler, type Locale, View, type ViewRange
} from "ckeditor5";

/**
 * A balloon at the caret with content rendered by the host application. The editor places the
 * balloon and takes it down; the host renders its own component into the balloon's element.
 *
 * The plugin that creates it must require `ContextualBalloon`.
 */
export default class HostedBalloon {

    private readonly editor: Editor;
    private readonly className: string;
    private readonly balloon: ContextualBalloon;
    private view: HostedBalloonView | null = null;
    private release: (() => void) | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private repositionFrame = 0;

    /** `className` is set on the element the host renders into. */
    constructor(editor: Editor, className: string) {
        this.editor = editor;
        this.className = className;
        this.balloon = editor.plugins.get(ContextualBalloon);

        // Esc reaches the editor only while the caret has focus, and the host's content takes
        // focus away, so `HostedBalloonView` registers a handler of its own.
        editor.keystrokes.set("Esc", (_data, cancel) => {
            if (this.view) {
                this.hide();
                cancel();
            }
        });
    }

    /**
     * Opens the balloon at the caret and calls `render` with the element to render into. `render`
     * returns the function that removes the rendered content, or `null` when the host shows the
     * content somewhere else, which closes the balloon again. Does nothing while it is open.
     */
    show(render: (container: HTMLElement) => (() => void) | null) {
        const editor = this.editor;
        const editorEl = editor.editing.view.getDomRoot();
        const shownAt = editor.editing.view.document.selection.getFirstRange();

        if (this.view || !editorEl || !shownAt) {
            return;
        }

        const view = new HostedBalloonView(editor.locale, this.className);
        view.keystrokes.set("Esc", (_data, cancel) => {
            this.hide();
            editor.editing.view.focus();
            cancel();
        });

        // Wired per view rather than once: the handler listens through the view, so destroying
        // the view on the way out stops it. It listens in the capture phase because link previews
        // and content embeds stop presses from bubbling, to keep them from CKEditor.
        view.listenTo(document, 'mousedown', (_evt, domEvent) => {
            // The balloon renders its panel as the editor starts up.
            const keepOpen = [
                this.balloon.view.element as HTMLElement, ...getHostLayers(editor, editorEl)
            ];
            if (!keepOpen.some((element) => element.contains(domEvent.target as Node))) {
                this.hide();
            }
        }, { useCapture: true });

        this.balloon.add({ view, position: getBalloonPosition(editor, shownAt) });
        this.view = view;

        const container = view.element;
        /* v8 ignore next 4 -- the balloon renders the view as it adds it, so it has an element */
        if (!container) {
            this.hide();
            return;
        }

        const release = render(container);
        if (!release) {
            this.hide();
            return;
        }

        this.release = release;

        // The host renders into the container only after `render` returns, and a balloon placed
        // around an empty container puts its arrow half the content's width from the caret.
        // Reposition on every size change, not just the first render. The reposition waits for
        // the next frame because it can change the container's width, which Chrome reports as an
        // observer loop.
        this.resizeObserver = new ResizeObserver(() => {
            cancelAnimationFrame(this.repositionFrame);

            this.repositionFrame = requestAnimationFrame(() => {
                /* v8 ignore next -- disconnecting the observer cancels the pending frames */
                if (this.view) {
                    this.balloon.updatePosition();
                }
            });
        });
        this.resizeObserver.observe(container);
    }

    /** Removes the host's content and closes the balloon. Does nothing while it is closed. */
    hide() {
        const view = this.view;

        this.view = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        cancelAnimationFrame(this.repositionFrame);
        this.release?.();
        this.release = null;

        if (!view) {
            return;
        }

        /* v8 ignore next -- a view this balloon still references is one the balloon still has */
        if (this.balloon.hasView(view)) {
            this.balloon.remove(view);
        }

        view.destroy();
    }

}

/**
 * The view inside the balloon: an element for the host to render into, and nothing else.
 *
 * It has `ck-reset_all-excluded` because everything a balloon shows sits inside the body
 * collection's `ck-reset_all`, which would strip the application's own styling from the content.
 */
class HostedBalloonView extends View {

    public readonly keystrokes = new KeystrokeHandler();

    constructor(locale: Locale, className: string) {
        super(locale);

        this.setTemplate({
            tag: "div",
            attributes: {
                class: [ "ck-reset_all-excluded", className ]
            }
        });
    }

    public override render() {
        super.render();

        /* v8 ignore next 3 -- `render()` is what builds the element, so it is never absent here */
        if (!this.element) {
            return;
        }

        this.keystrokes.listenTo(this.element);
    }

    public override destroy() {
        super.destroy();
        this.keystrokes.destroy();
    }

}

/**
 * The elements matching `hostedBalloon.keepOpenSelector` that do not hold the editor, such as a
 * list of suggestions that the host's content renders in the page's body.
 */
function getHostLayers(editor: Editor, editorEl: HTMLElement): Element[] {
    const selector = editor.config.get("hostedBalloon")?.keepOpenSelector;
    if (!selector) {
        return [];
    }

    return [ ...document.querySelectorAll(selector) ].filter((layer) => !layer.contains(editorEl));
}

/** Where the balloon points: the caret, read again on every placement, as the emoji picker does. */
function getBalloonPosition(editor: Editor, shownAt: ViewRange) {
    const view = editor.editing.view;

    return {
        target: () => {
            /* v8 ignore next -- a rendered document always has a range for the caret */
            const range = view.document.selection.getFirstRange() ?? shownAt;

            return view.domConverter.viewRangeToDom(range);
        }
    };
}

declare module "ckeditor5" {
    interface EditorConfig {
        hostedBalloon?: {
            /**
             * Matches the host's floating layers, which render outside the balloon. A press in
             * one keeps the balloon open, unless the layer holds the editor, as a dialog around it
             * does.
             */
            keepOpenSelector: string;
        };
    }
}
