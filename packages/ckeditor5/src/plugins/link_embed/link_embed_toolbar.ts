import {
    Plugin,
    WidgetToolbarRepository,
    isWidget,
    type ViewElement,
    clickOutsideHandler,
    Collection,
    ContextualBalloon,
    ViewModel,
    createDropdown,
    addListToDropdown,
    ButtonView,
    DropdownButtonView,
    IconPencil,
    IconUnlink,
    type ListDropdownButtonDefinition,
    type Locale,
    type Command
} from "ckeditor5";
import LinkEmbed, {
    CHANGE_LINK_DISPLAY_COMMAND,
    CHANGE_LINK_PREVIEW_TITLE_COMMAND,
    LINK_DISPLAY_MODES,
    REMOVE_LINK_EMBED_COMMAND,
    type LinkDisplayMode
} from "./link_embed.js";
import LinkEmbedTitleFormView from "./link_embed_title_form.js";
import { createCopyUrlButton } from "../copy_link_url.js";
import { translate } from "../translate.js";

export default class LinkEmbedToolbar extends Plugin {

    static get requires() {
        return [WidgetToolbarRepository, LinkEmbed, LinkEmbedLinkButton, LinkEmbedCopyUrlButton, LinkEmbedEditTitleButton, LinkEmbedUnlinkButton, LinkEmbedDisplayDropdown] as const;
    }

    afterInit() {
        const widgetToolbarRepository = this.editor.plugins.get(WidgetToolbarRepository);

        widgetToolbarRepository.register("linkEmbed", {
            items: ["linkEmbedLink", "linkEmbedCopyUrl", "linkEmbedEditTitle", "linkEmbedUnlink", "|", "linkEmbedDisplayDropdown"],
            balloonClassName: "ck-toolbar-container link-embed-toolbar",
            getRelatedElement(selection) {
                const selectedElement = selection.getSelectedElement();
                if (selectedElement && isLinkEmbedWidget(selectedElement)) {
                    return selectedElement;
                }
                return null;
            }
        });
    }
}

function isLinkEmbedWidget(element: ViewElement): boolean {
    if (!isWidget(element)) {
        return false;
    }

    // Match both linkEmbed (<section.link-embed>) and linkMention (<span.link-mention>)
    if (element.is("element", "section")) {
        const classes = element.getAttribute("class") || "";
        return typeof classes === "string" && classes.includes("link-embed");
    }
    if (element.is("element", "span")) {
        const classes = element.getAttribute("class") || "";
        return typeof classes === "string" && classes.includes("link-mention");
    }
    return false;
}

class LinkEmbedDisplayDropdown extends Plugin {

    static get requires() {
        return [LinkEmbed] as const;
    }

    public init() {
        const editor = this.editor;
        const componentFactory = editor.ui.componentFactory;
        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as Command & { value: LinkDisplayMode | null; embedAvailable: boolean };

        componentFactory.add("linkEmbedDisplayDropdown", _locale => {
            const dropdownView = createDropdown(editor.locale, DropdownButtonView);

            const displayLabel = translate(editor, "link_embed.display", "Display");

            dropdownView.buttonView.set({
                withText: true,
                tooltip: true,
                label: displayLabel
            });

            dropdownView.bind("isEnabled").to(command, "isEnabled");
            // The dropdown also sits in the native link balloon (see `link.toolbar` in the client
            // config), which opens for links that cannot be previewed at all — an internal note
            // link, say. There it hides rather than showing permanently disabled.
            dropdownView.bind("class").to(command, "isEnabled", (isEnabled) => (isEnabled ? "" : "ck-hidden"));

            dropdownView.buttonView.bind("label").to(command, "value", (value) => {
                if (!value) return displayLabel;
                const mode = LINK_DISPLAY_MODES.find(m => m.value === value);
                return mode ? translate(editor, mode.labelKey, mode.label) : value;
            });

            dropdownView.on("execute", evt => {
                const source = evt.source as any;
                editor.execute(CHANGE_LINK_DISPLAY_COMMAND, {
                    value: source._displayMode
                });
                editor.editing.view.focus();
            });

            addListToDropdown(dropdownView, this._getItemDefinitions(command));
            return dropdownView;
        });
    }

    private _getItemDefinitions(command: Command & { value: LinkDisplayMode | null; embedAvailable: boolean }): Collection<ListDropdownButtonDefinition> {
        const items = new Collection<ListDropdownButtonDefinition>();

        for (const modeDef of LINK_DISPLAY_MODES) {
            const definition: ListDropdownButtonDefinition = {
                type: "button",
                model: new ViewModel({
                    _displayMode: modeDef.value,
                    label: translate(this.editor, modeDef.labelKey, modeDef.label),
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(command, "value", value => {
                return value === modeDef.value;
            });

            // Hide "Embed" when the URL doesn't support it.
            if (modeDef.value === "embed") {
                definition.model.bind("isVisible").to(command, "embedAvailable");
            }

            items.add(definition);
        }

        return items;
    }
}

/**
 * Registers the `linkEmbedLink` toolbar item: the leading segment of the link
 * embed balloon that shows the widget's URL and opens it in a new tab when
 * clicked — mirroring CKEditor's own link toolbar preview button.
 */
class LinkEmbedLinkButton extends Plugin {

    static get requires() {
        return [LinkEmbed] as const;
    }

    public init() {
        const editor = this.editor;
        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as (Command & { url: string | null }) | undefined;

        editor.ui.componentFactory.add("linkEmbedLink", locale => {
            const button = new LinkEmbedPreviewButtonView(locale);

            button.set("tooltip", locale.t("Open link in new tab"));

            /* v8 ignore next -- LinkEmbedEditing always registers CHANGE_LINK_DISPLAY_COMMAND (this plugin requires LinkEmbed), so the no-command branch is unreachable */
            if (command) {
                button.bind("isEnabled").to(command, "url", url => !!url);
                button.bind("label").to(command, "url", url => url ?? undefined);
                button.bind("href").to(command, "url", url => url ?? undefined);
            }

            return button;
        });
    }
}

/**
 * Registers the `linkEmbedCopyUrl` toolbar item: copies the selected widget's URL
 * to the clipboard, mirroring the default link toolbar's copy-URL button.
 */
class LinkEmbedCopyUrlButton extends Plugin {

    static get requires() {
        return [LinkEmbed] as const;
    }

    public init() {
        const editor = this.editor;
        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as (Command & { url: string | null }) | undefined;

        editor.ui.componentFactory.add("linkEmbedCopyUrl", locale =>
            createCopyUrlButton(editor, locale, () => command?.url)
        );
    }
}

/**
 * Registers the `linkEmbedUnlink` toolbar item: removes the link preview, leaving
 * the bare URL as plain text — mirroring the default link toolbar's unlink button
 * (same icon, same "remove the link" semantics).
 */
class LinkEmbedUnlinkButton extends Plugin {

    static get requires() {
        return [LinkEmbed] as const;
    }

    public init() {
        const editor = this.editor;
        const command = editor.commands.get(REMOVE_LINK_EMBED_COMMAND);

        editor.ui.componentFactory.add("linkEmbedUnlink", locale => {
            const button = new ButtonView(locale);
            button.set({
                label: locale.t("Unlink"),
                icon: IconUnlink,
                tooltip: true
            });

            /* v8 ignore next -- LinkEmbedEditing always registers REMOVE_LINK_EMBED_COMMAND (this plugin requires LinkEmbed), so the no-command branch is unreachable */
            if (command) {
                button.bind("isEnabled").to(command, "isEnabled");
            }

            button.on("execute", () => {
                editor.execute(REMOVE_LINK_EMBED_COMMAND);
                editor.editing.view.focus();
            });

            return button;
        });
    }
}

/**
 * Registers the `linkEmbedEditTitle` toolbar item: a pencil button opening a balloon form that
 * edits the title the selected preview displays — the widget counterpart of the "Displayed text"
 * field the editor's own link form offers for native links.
 */
class LinkEmbedEditTitleButton extends Plugin {

    static get requires() {
        return [LinkEmbed, ContextualBalloon] as const;
    }

    private _formView: LinkEmbedTitleFormView | null = null;

    public init() {
        const editor = this.editor;

        editor.ui.componentFactory.add("linkEmbedEditTitle", (locale) => {
            const command = editor.commands.get(CHANGE_LINK_PREVIEW_TITLE_COMMAND);
            const button = new ButtonView(locale);

            button.set({
                label: translate(editor, "link_embed.edit_title", "Edit title"),
                icon: IconPencil,
                tooltip: true
            });

            /* v8 ignore next -- LinkEmbedEditing always registers CHANGE_LINK_PREVIEW_TITLE_COMMAND (this plugin requires LinkEmbed), so the no-command branch is unreachable */
            if (command) {
                button.bind("isEnabled").to(command, "isEnabled");
            }

            button.on("execute", () => this._showForm());
            return button;
        });
    }

    public override destroy() {
        super.destroy();
        this._formView?.destroy();
    }

    private _showForm() {
        const editor = this.editor;
        const balloon = editor.plugins.get(ContextualBalloon);
        const form = this._getFormView();

        if (balloon.hasView(form)) return;

        // Prefill with what the preview currently shows, so a save without edits changes nothing.
        // The command always exists: LinkEmbedEditing registers it and this plugin requires LinkEmbed.
        const command = editor.commands.get(CHANGE_LINK_PREVIEW_TITLE_COMMAND) as Command & { value: string | null };
        form.reset(command.value ?? "");

        balloon.add({
            view: form,
            position: {
                target: () => {
                    const view = editor.editing.view;
                    const range = view.document.selection.getFirstRange();
                    /* v8 ignore next -- the editing view's selection always has a range while a widget is selected */
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
        this.editor.editing.view.focus();
    }

    private _getFormView(): LinkEmbedTitleFormView {
        if (this._formView) return this._formView;

        const editor = this.editor;
        const form = new LinkEmbedTitleFormView(editor.locale, (key, fallback) => translate(editor, key, fallback));
        this._formView = form;

        form.on("submit", () => {
            editor.execute(CHANGE_LINK_PREVIEW_TITLE_COMMAND, { title: form.title });
            this._hideForm();
        });

        // Esc and clicking away dismiss the form, exactly as they do for the insert form.
        form.keystrokes.set("Esc", (_data, cancel) => {
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
}

/**
 * A {@link ButtonView} rendered as an `<a target="_blank">` so a click opens the
 * URL in a new tab. Reuses CKEditor's `ck-link-toolbar__preview` styling for
 * visual parity with the built-in link toolbar.
 */
class LinkEmbedPreviewButtonView extends ButtonView {
    declare href: string | undefined;

    constructor(locale: Locale) {
        super(locale);

        const bind = this.bindTemplate;
        this.set("href", undefined);
        this.set("withText", true);

        this.extendTemplate({
            attributes: {
                class: ["ck-link-toolbar__preview"],
                href: bind.to("href"),
                target: "_blank",
                rel: "noopener noreferrer"
            }
        });

        /* v8 ignore next -- ButtonView always builds a template, and extendTemplate() above would have thrown otherwise, so the no-template branch is unreachable */
        if (this.template) {
            this.template.tag = "a";
        }
    }
}
