import {
    ButtonView,
    Collection,
    createDropdown,
    createLabeledInputText,
    DropdownButtonView,
    FocusCycler,
    FocusTracker,
    KeystrokeHandler,
    LabeledFieldView,
    type DropdownView,
    type FocusableView,
    type InputTextView,
    type ListDropdownButtonDefinition,
    type Locale,
    addListToDropdown,
    submitHandler,
    View,
    ViewCollection,
    ViewModel
} from "ckeditor5";

import { LINK_DISPLAY_MODES, type LinkDisplayMode } from "./link_embed_commands.js";

/** Resolves a translation key, falling back to the given English text. See `translate.ts`. */
type Translate = (key: string, fallback: string) => string;

/**
 * The balloon form behind the "Link preview" toolbar button: a URL field, a display-mode selector
 * and an Insert button.
 *
 * It wears CKEditor's own `ck-link-form ck-responsive-form` classes rather than a Trilium modal, so
 * it looks and behaves exactly like the editor's native link balloon — including its narrow-screen
 * layout — and so inserting a preview never leaves the editor.
 */
export default class LinkEmbedFormView extends View {

    /** The URL to preview. */
    declare public url: string;
    /** The shape the preview will take. */
    declare public mode: LinkDisplayMode;
    /** Whether the URL supports a player (a YouTube link, say); "Embed" is hidden when it does not. */
    declare public embedAvailable: boolean;
    /** True while the metadata is being fetched, which disables the form. */
    declare public isFetching: boolean;

    public readonly urlInputView: LabeledFieldView<InputTextView>;
    public readonly modeDropdownView: DropdownView;
    public readonly insertButtonView: ButtonView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly _focusables = new ViewCollection<FocusableView>();
    private readonly _focusCycler: FocusCycler;

    constructor(locale: Locale, translate: Translate) {
        super(locale);

        this.set("url", "");
        this.set("mode", "card");
        this.set("embedAvailable", false);
        this.set("isFetching", false);

        this.urlInputView = this._createUrlInput(locale, translate);
        this.modeDropdownView = this._createModeDropdown(locale, translate);
        this.insertButtonView = this._createInsertButton(locale, translate);

        this.setTemplate({
            tag: "form",
            attributes: {
                // CKEditor's own link-balloon classes: same paddings, same responsive behaviour.
                class: ["ck", "ck-link-form", "ck-responsive-form", "ck-link-embed-form"],
                tabindex: "-1"
            },
            children: [
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-link-embed-form__heading"] },
                    children: [{ text: translate("link_embed.title", "Link preview") }]
                },
                this.urlInputView,
                {
                    tag: "div",
                    attributes: { class: ["ck", "ck-link-embed-form__actions"] },
                    children: [
                        this.modeDropdownView,
                        this.insertButtonView
                    ]
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

        for (const view of [this.urlInputView, this.modeDropdownView, this.insertButtonView]) {
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

    /** Resets the form to a blank state, ready for the next insertion. */
    public reset(): void {
        this.url = "";
        this.mode = "card";
        this.embedAvailable = false;
        this.isFetching = false;
    }

    public focus(): void {
        this._focusCycler.focusFirst();
    }

    private _createUrlInput(locale: Locale, translate: Translate) {
        const urlInput = new LabeledFieldView(locale, createLabeledInputText);
        urlInput.label = translate("link_embed.url", "URL");
        urlInput.fieldView.placeholder = "http://";

        // Two-way: the field drives `url`, and reset() drives the field.
        urlInput.fieldView.bind("value").to(this, "url");
        urlInput.fieldView.on("input", () => {
            /* v8 ignore next -- the input event can only come from a rendered element */
            this.url = urlInput.fieldView.element?.value ?? "";
        });
        urlInput.bind("isEnabled").to(this, "isFetching", (isFetching) => !isFetching);

        return urlInput;
    }

    private _createModeDropdown(locale: Locale, translate: Translate) {
        const dropdown = createDropdown(locale, DropdownButtonView);

        dropdown.buttonView.set({ withText: true, tooltip: true });
        dropdown.buttonView.bind("label").to(this, "mode", (mode) => modeLabel(mode, translate));
        dropdown.bind("isEnabled").to(this, "isFetching", (isFetching) => !isFetching);

        const items = new Collection<ListDropdownButtonDefinition>();
        for (const modeDef of LINK_DISPLAY_MODES) {
            const definition: ListDropdownButtonDefinition = {
                type: "button",
                model: new ViewModel({
                    _displayMode: modeDef.value,
                    label: translate(modeDef.labelKey, modeDef.label),
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(this, "mode", (mode) => mode === modeDef.value);

            // A player only exists for a URL that has one.
            if (modeDef.value === "embed") {
                definition.model.bind("isVisible").to(this, "embedAvailable");
            }

            items.add(definition);
        }
        addListToDropdown(dropdown, items);

        dropdown.on("execute", (evt) => {
            this.mode = (evt.source as unknown as { _displayMode: LinkDisplayMode })._displayMode;
        });

        return dropdown;
    }

    private _createInsertButton(locale: Locale, translate: Translate) {
        const button = new ButtonView(locale);

        // A text button, like the Insert button of the editor's own link form.
        button.set({
            label: translate("link_embed.insert", "Insert"),
            withText: true,
            type: "submit",
            class: "ck-button-action ck-button-bold"
        });

        // A URL is required, and nothing may be submitted twice while the first fetch is in flight.
        button.bind("isEnabled").to(
            this, "url",
            this, "isFetching",
            (url, isFetching) => !!String(url).trim() && !isFetching
        );

        return button;
    }
}

/** A display mode's label, in the user's language. */
function modeLabel(mode: LinkDisplayMode, translate: Translate): string {
    const found = LINK_DISPLAY_MODES.find((modeDef) => modeDef.value === mode);
    /* v8 ignore next -- `mode` is only ever set from LINK_DISPLAY_MODES, so the fallback is unreachable */
    return found ? translate(found.labelKey, found.label) : String(mode);
}
