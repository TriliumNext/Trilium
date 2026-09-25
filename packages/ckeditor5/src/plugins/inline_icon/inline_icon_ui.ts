import bxSticker from "boxicons/svg/regular/bx-sticker.svg?raw";
import {
    ButtonView, clickOutsideHandler, type Command, ContextualBalloon, type Editor,
    KeystrokeHandler, type Locale, Plugin, View, type ViewRange
} from "ckeditor5";

import { INSERT_ICON_COMMAND } from "./inline_icon_editing.js";

/**
 * The button `InlineIconToolbar` puts in the balloon over a selected icon. It opens the same
 * picker as the insert button, because `INSERT_ICON_COMMAND` replaces a selected icon.
 */
export const CHANGE_ICON = "changeIcon";

/**
 * The buttons that insert or replace an icon, and the balloon the picking happens in.
 *
 * The editor positions the balloon and takes it down; the application renders its own picker into
 * it through `showIconPicker`, the one place every installed icon pack is searchable. A host with
 * no room for a balloon shows the picker its own way and returns nothing to release.
 */
export default class InlineIconUI extends Plugin {

    public static get pluginName() {
        return "InlineIconUI" as const;
    }

    public static get requires() {
        return [ ContextualBalloon ] as const;
    }

    private _balloon: ContextualBalloon = this.editor.plugins.get(ContextualBalloon);
    private _pickerView: IconPickerView | null = null;
    private _releasePicker: (() => void) | null = null;
    private _pickerResize: ResizeObserver | null = null;
    private _replacePicker = 0;

    init() {
        const editor = this.editor;
        const t = editor.t;

        this.addPickerButton(INSERT_ICON_COMMAND, t("Insert icon"));
        this.addPickerButton(CHANGE_ICON, t("Change icon"));

        // Esc reaches the editor only while the caret has focus, and the picker takes focus away,
        // so {@link IconPickerView} registers a handler of its own.
        editor.keystrokes.set("Esc", (_data, cancel) => {
            if (this._pickerView) {
                this._hide();
                cancel();
            }
        });
    }

    public override destroy() {
        // Before the base class stops the listeners the balloon is taken down through.
        this._hide();
        super.destroy();
    }

    /** Opens the picker; the `/` palette calls this as well as the toolbar buttons. */
    public showPicker() {
        const editor = this.editor;
        const editorEl = editor.editing.view.getDomRoot();
        const shownAt = editor.editing.view.document.selection.getFirstRange();

        if (this._pickerView || !editorEl || !shownAt) {
            return;
        }

        const view = new IconPickerView(editor.locale);
        view.keystrokes.set("Esc", (_data, cancel) => {
            this._hide();
            editor.editing.view.focus();
            cancel();
        });

        // Wired per picker rather than once: the handler listens through the view, so destroying
        // the view on the way out stops it.
        clickOutsideHandler({
            emitter: view,
            activator: () => this._pickerView === view,
            /* v8 ignore next -- the balloon renders its panel as the editor starts up */
            contextElements: this._balloon.view.element ? [ this._balloon.view.element ] : [],
            callback: () => this._hide()
        });

        this._balloon.add({ view, position: getBalloonPosition(editor, shownAt) });
        this._pickerView = view;

        const container = view.element;
        /* v8 ignore next 4 -- the balloon renders the view as it adds it, so it has an element */
        if (!container) {
            this._hide();
            return;
        }

        const release = glob.getComponentByEl<EditorComponent>(editorEl).showIconPicker({
            container,
            onSelect: (iconClass) => {
                this._hide();
                editor.execute(INSERT_ICON_COMMAND, { iconClass });
                editor.editing.view.focus();
            }
        });

        if (!release) {
            this._hide();
            return;
        }

        this._releasePicker = release;

        // The host renders into the container only after the call above returns, and a balloon
        // placed around an empty container puts its arrow half the picker's width from the caret.
        // Reposition on every size change, not just the first render. The reposition waits for the
        // next frame because it can change the container's width, which Chrome reports as an
        // observer loop.
        this._pickerResize = new ResizeObserver(() => {
            cancelAnimationFrame(this._replacePicker);

            this._replacePicker = requestAnimationFrame(() => {
                /* v8 ignore next -- disconnecting the observer cancels the pending frames */
                if (this._pickerView) {
                    this._balloon.updatePosition();
                }
            });
        });
        this._pickerResize.observe(container);
    }

    /**
     * One button that opens the picker. Both buttons execute `INSERT_ICON_COMMAND` and take their
     * enabled state from it, so both are disabled where an icon cannot be inserted.
     */
    private addPickerButton(name: string, label: string) {
        const editor = this.editor;

        editor.ui.componentFactory.add(name, (locale) => {
            // Always registered: InlineIconEditing is loaded beside this plugin.
            const command = editor.commands.get(INSERT_ICON_COMMAND) as Command;
            const view = new ButtonView(locale);

            view.set({
                label,
                icon: bxSticker,
                tooltip: true
            });

            view.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(view, "execute", () => this.showPicker());

            return view;
        });
    }

    private _hide() {
        const view = this._pickerView;

        this._pickerView = null;
        this._pickerResize?.disconnect();
        this._pickerResize = null;
        cancelAnimationFrame(this._replacePicker);
        this._releasePicker?.();
        this._releasePicker = null;

        if (!view) {
            return;
        }

        /* v8 ignore next -- a picker this plugin still references is one the balloon still has */
        if (this._balloon.hasView(view)) {
            this._balloon.remove(view);
        }

        view.destroy();
    }

}

/**
 * The view inside the balloon: an element for the host to render into, and nothing else.
 *
 * It has `ck-reset_all-excluded` because everything a balloon shows sits inside the body
 * collection's `ck-reset_all`, which would strip the application's own styling from the picker.
 */
class IconPickerView extends View {

    public readonly keystrokes = new KeystrokeHandler();

    constructor(locale: Locale) {
        super(locale);

        this.setTemplate({
            tag: "div",
            attributes: {
                class: [ "ck-reset_all-excluded", "icon-picker-balloon" ]
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
