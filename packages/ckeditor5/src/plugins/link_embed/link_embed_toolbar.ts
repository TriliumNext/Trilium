import {
    Plugin,
    WidgetToolbarRepository,
    isWidget,
    type ViewElement,
    Collection,
    ViewModel,
    createDropdown,
    addListToDropdown,
    ButtonView,
    DropdownButtonView,
    LinkUI,
    type ListDropdownButtonDefinition,
    type Locale,
    type Command
} from "ckeditor5";
import InternalLinkPlugin from "../internallink.js";
import LinkEmbed, {
    CHANGE_LINK_DISPLAY_COMMAND,
    getLinkDisplayModeLabel,
    LINK_DISPLAY_MODES,
    type LinkDisplayMode
} from "./link_embed.js";
import { EMBEDDABLE_URL_REGEX } from "./link_embed_commands.js";
import { createCopyUrlButton } from "../copy_link_url.js";

/**
 * The toolbar of a selected link preview. Its `editLink` item comes from `InternalLinkPlugin`, and
 * its `linkMenu` item from `LinkMenu`, which holds Unlink.
 */
export default class LinkEmbedToolbar extends Plugin {

    static get requires() {
        return [
            WidgetToolbarRepository, InternalLinkPlugin, LinkEmbed, LinkEmbedLinkButton,
            LinkEmbedCopyUrlButton, LinkEmbedDisplayDropdown
        ] as const;
    }

    afterInit() {
        const widgetToolbarRepository = this.editor.plugins.get(WidgetToolbarRepository);

        widgetToolbarRepository.register("linkEmbed", {
            items: [
                "linkEmbedLink", "linkEmbedCopyUrl", "editLink", "|",
                "linkEmbedDisplayDropdown", "linkMenu"
            ],
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

export class LinkEmbedDisplayDropdown extends Plugin {

    static get requires() {
        return [LinkEmbed] as const;
    }

    public init() {
        const editor = this.editor;
        const componentFactory = editor.ui.componentFactory;
        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as Command & { value: LinkDisplayMode | null; embedAvailable: boolean };

        componentFactory.add("linkEmbedDisplayDropdown", _locale => {
            const dropdownView = createDropdown(editor.locale, DropdownButtonView);

            const displayLabel = editor.t("Display");

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
                return getLinkDisplayModeLabel(editor.t, value);
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

        for (const mode of LINK_DISPLAY_MODES) {
            const definition: ListDropdownButtonDefinition = {
                type: "button",
                model: new ViewModel({
                    _displayMode: mode,
                    label: getLinkDisplayModeLabel(this.editor.t, mode),
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(command, "value", value => {
                return value === mode;
            });

            // Hide "Embed" when the URL doesn't support it.
            if (mode === "embedLink") {
                definition.model.bind("isVisible").to(command, "embedAvailable");
            }

            items.add(definition);
        }

        return items;
    }
}

/**
 * Registers the `linkEmbedLink` toolbar item: the leading segment of the link
 * embed balloon, named "Open link", that opens the widget's URL in a new tab when
 * clicked — mirroring CKEditor's own link toolbar preview button. The `linkPreview`
 * button of `LinkUI` has the same name on a link in the text to a web page.
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

            button.set({
                label: editor.t("Open link"),
                tooltip: locale.t("Open link in new tab")
            });

            /* v8 ignore next -- LinkEmbedEditing always registers CHANGE_LINK_DISPLAY_COMMAND (this plugin requires LinkEmbed), so the no-command branch is unreachable */
            if (command) {
                button.bind("isEnabled").to(command, "url", url => !!url);
                button.bind("href").to(command, "url", url => url ?? undefined);
            }

            return button;
        });
    }

    public afterInit() {
        const editor = this.editor;
        if (!editor.plugins.has(LinkUI)) {
            return;
        }

        // `LinkUI` names its `linkPreview` button after the item of the provider that knows the
        // link, and after the address of any other link.
        editor.plugins.get(LinkUI).registerLinksListProvider({
            label: editor.t("Link to a web page"),
            getListItems: () => [],
            getItem: (href) => (EMBEDDABLE_URL_REGEX.test(href)
                ? {
                    href, label: editor.t("Open link"), tooltip: editor.t("Open link in new tab")
                }
                : null)
        });
    }
}

/**
 * Registers the `linkEmbedCopyUrl` toolbar item: copies the selected widget's URL
 * to the clipboard, mirroring the default link toolbar's copy-URL button.
 */
export class LinkEmbedCopyUrlButton extends Plugin {

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
 * A {@link ButtonView} rendered as an `<a target="_blank">` so a click opens the
 * URL in a new tab. Reuses CKEditor's `ck-link-toolbar__preview` styling for
 * visual parity with the built-in link toolbar. Like CKEditor's preview button, it fires
 * `navigate` on a click, whose listener can cancel opening the URL.
 */
export class LinkEmbedPreviewButtonView extends ButtonView {
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
            },
            on: {
                click: bind.to((event) => {
                    if (this.href) {
                        this.fire<LinkEmbedPreviewNavigateEvent>("navigate", this.href,
                            () => event.preventDefault());
                    }
                })
            }
        });

        /* v8 ignore next -- ButtonView always builds a template, and extendTemplate() above would have thrown otherwise, so the no-template branch is unreachable */
        if (this.template) {
            this.template.tag = "a";
        }
    }
}

/**
 * Fired by a click on a `LinkEmbedPreviewButtonView`, with its `href` and a function that cancels
 * opening it.
 */
export type LinkEmbedPreviewNavigateEvent = {
    name: "navigate";
    args: [ href: string, cancel: () => void ];
};
