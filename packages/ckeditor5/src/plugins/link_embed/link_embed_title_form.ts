import {
    ButtonView,
    createLabeledInputText,
    FocusCycler,
    FocusTracker,
    KeystrokeHandler,
    LabeledFieldView,
    submitHandler,
    View,
    ViewCollection,
    type FocusableView,
    type InputTextView,
    type Locale
} from "ckeditor5";

/** Resolves a translation key, falling back to the given English text. See `translate.ts`. */
type Translate = (key: string, fallback: string) => string;

/**
 * The balloon form behind the widget toolbar's "Edit title" button: a single Title field and a
 * Save button — the preview counterpart of the "Displayed text" field the editor's own link form
 * offers for native links.
 *
 * It wears the same classes as the insert form (which reuses CKEditor's own `ck-link-form`), so it
 * looks and behaves like the editor's native link balloons.
 */
export default class LinkEmbedTitleFormView extends View {

    /** The title being edited, prefilled with what the preview currently shows. */
    declare public title: string;

    public readonly titleInputView: LabeledFieldView<InputTextView>;
    public readonly saveButtonView: ButtonView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly _focusables = new ViewCollection<FocusableView>();
    private readonly _focusCycler: FocusCycler;

    constructor(locale: Locale, translate: Translate) {
        super(locale);

        this.set("title", "");

        this.titleInputView = this._createTitleInput(locale, translate);
        this.saveButtonView = this._createSaveButton(locale, translate);

        this.setTemplate({
            tag: "form",
            attributes: {
                class: ["ck", "ck-link-form", "ck-responsive-form", "ck-link-embed-form"],
                tabindex: "-1"
            },
            children: [
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-link-embed-form__heading"] },
                    children: [{ text: translate("link_embed.edit_title", "Edit title") }]
                },
                this.titleInputView,
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-link-embed-form__actions"] },
                    children: [this.saveButtonView]
                }
            ]
        });

        this._focusCycler = new FocusCycler({
            focusables: this._focusables,
            focusTracker: this.focusTracker,
            keystrokeHandler: this.keystrokes,
            actions: {
                focusPrevious: "shift + tab",
                focusNext: "tab"
            }
        });
    }

    public override render(): void {
        super.render();

        // Turns a native form submit (the Enter key included) into the view's own `submit` event.
        submitHandler({ view: this });

        for (const view of [this.titleInputView, this.saveButtonView]) {
            this._focusables.add(view);
            /* v8 ignore next -- a child view rendered as part of this template always has an element */
            if (view.element) {
                this.focusTracker.add(view.element);
            }
        }

        /* v8 ignore next -- super.render() has just built this view's element */
        if (this.element) {
            this.keystrokes.listenTo(this.element);
        }
    }

    public override destroy(): void {
        super.destroy();
        this.focusTracker.destroy();
        this.keystrokes.destroy();
    }

    /** Prefills the form with the title the preview currently shows. */
    public reset(currentTitle: string): void {
        this.title = currentTitle;
    }

    public focus(): void {
        this._focusCycler.focusFirst();
    }

    private _createTitleInput(locale: Locale, translate: Translate) {
        const titleInput = new LabeledFieldView(locale, createLabeledInputText);
        titleInput.label = translate("link_embed.title_label", "Title");

        // Two-way: the field drives `title`, and reset() drives the field.
        titleInput.fieldView.bind("value").to(this, "title");
        titleInput.fieldView.on("input", () => {
            /* v8 ignore next -- the input event can only come from a rendered element */
            this.title = titleInput.fieldView.element?.value ?? "";
        });

        return titleInput;
    }

    private _createSaveButton(locale: Locale, translate: Translate) {
        const button = new ButtonView(locale);

        button.set({
            label: translate("link_embed.save", "Save"),
            withText: true,
            type: "submit",
            class: "ck-button-action ck-button-bold"
        });

        // A blank title is never saved — clearing the field is not how a title is removed.
        button.bind("isEnabled").to(this, "title", (title) => !!String(title).trim());

        return button;
    }
}
