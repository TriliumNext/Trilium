import { ALLOWED_PROTOCOLS, DISPLAYABLE_LOCALE_IDS, MIME_TYPE_AUTO } from "@triliumnext/commons";
import { buildExtraCommands, type EditorConfig, getCkLocale, PREMIUM_PLUGINS, TemplateDefinition } from "@triliumnext/ckeditor5";
import { getHighlightJsNameForMime } from "../../../services/mime_types.js";
import options from "../../../services/options.js";
import { ensureMimeTypesForHighlighting, isSyntaxHighlightEnabled } from "../../../services/syntax_highlight.js";
import emojiDefinitionsUrl from "@triliumnext/ckeditor5/src/emoji_definitions/en.json?url";
import { copyTextWithToast } from "../../../services/clipboard_ext.js";
import { t } from "../../../services/i18n.js";
import { getMermaidConfig } from "../../../services/mermaid.js";
import noteAutocompleteService, { type Suggestion } from "../../../services/note_autocomplete.js";
import mimeTypesService from "../../../services/mime_types.js";
import { normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { buildToolbarConfig } from "./toolbar.js";

export const OPEN_SOURCE_LICENSE_KEY = "GPL";

export interface BuildEditorOptions {
    forceGplLicense: boolean;
    isClassicEditor: boolean;
    uiLanguage: DISPLAYABLE_LOCALE_IDS;
    contentLanguage: string | null;
    templates: TemplateDefinition[];
}

export async function buildConfig(opts: BuildEditorOptions): Promise<EditorConfig> {
    const licenseKey = (opts.forceGplLicense ? OPEN_SOURCE_LICENSE_KEY : getLicenseKey());
    const hasPremiumLicense = (licenseKey !== OPEN_SOURCE_LICENSE_KEY);

    const config: EditorConfig = {
        licenseKey,
        placeholder: t("editable_text.placeholder"),
        codeBlock: {
            languages: buildListOfLanguages()
        },
        math: {
            engine: "katex",
            outputType: "span", // or script
            lazyLoad: async () => {
                (window as any).katex = (await import("../../../services/math.js")).default
            },
            forceOutputType: false, // forces output to use outputType
            enablePreview: true // Enable preview view
        },
        mermaid: {
            lazyLoad: async () => (await import("mermaid")).default, // FIXME
            config: getMermaidConfig()
        },
        image: {
            styles: {
                options: [
                    "inline",
                    "alignBlockLeft",
                    "alignCenter",
                    "alignBlockRight",
                    "alignLeft",
                    "alignRight",
                    "side"
                ]
            },
            resizeOptions: [
                {
                    name: "imageResize:original",
                    value: null,
                    icon: "original"
                },
                {
                    name: "imageResize:25",
                    value: "25",
                    icon: "small"
                },
                {
                    name: "imageResize:50",
                    value: "50",
                    icon: "medium"
                },
                {
                    name: "imageResize:75",
                    value: "75",
                    icon: "medium"
                }
            ],
            toolbar: [
                // Image styles, see https://ckeditor.com/docs/ckeditor5/latest/features/images/images-styles.html#demo.
                "imageStyle:inline",
                "imageStyle:alignCenter",
                {
                    name: "imageStyle:wrapText",
                    title: "Wrap text",
                    items: ["imageStyle:alignLeft", "imageStyle:alignRight"],
                    defaultItem: "imageStyle:alignRight"
                },
                {
                    name: "imageStyle:block",
                    title: "Block align",
                    items: ["imageStyle:alignBlockLeft", "imageStyle:alignBlockRight"],
                    defaultItem: "imageStyle:alignBlockLeft"
                },
                "|",
                "imageResize:25",
                "imageResize:50",
                "imageResize:original",
                "|",
                "toggleImageCaption"
            ],
            upload: {
                types: ["jpeg", "png", "gif", "bmp", "webp", "tiff", "svg", "svg+xml", "avif"]
            }
        },
        heading: {
            options: [
                { model: "paragraph" as const, title: "Paragraph", class: "ck-heading_paragraph" },
                // heading1 is not used since that should be a note's title
                { model: "heading2" as const, view: "h2", title: "Heading 2", class: "ck-heading_heading2" },
                { model: "heading3" as const, view: "h3", title: "Heading 3", class: "ck-heading_heading3" },
                { model: "heading4" as const, view: "h4", title: "Heading 4", class: "ck-heading_heading4" },
                { model: "heading5" as const, view: "h5", title: "Heading 5", class: "ck-heading_heading5" },
                { model: "heading6" as const, view: "h6", title: "Heading 6", class: "ck-heading_heading6" }
            ]
        },
        table: {
            contentToolbar: ["tableColumn", "tableRow", "mergeTableCells", "tableProperties", "tableCellProperties", "toggleTableCaption"]
        },
        list: {
            properties: {
                styles: true,
                startIndex: true,
                reversed: true
            }
        },
        alignment: {
            options: [ "left", "right", "center", "justify"]
        },
        link: {
            defaultProtocol: "https://",
            allowedProtocols: ALLOWED_PROTOCOLS
        },
        emoji: {
            definitionsUrl: window.glob.isDev
                ? new URL(import.meta.url).origin + emojiDefinitionsUrl
                : emojiDefinitionsUrl
        },
        syntaxHighlighting: {
            loadHighlightJs: async () => {
                await ensureMimeTypesForHighlighting();
                return await import("@triliumnext/highlightjs");
            },
            mapLanguageName: getHighlightJsNameForMime,
            defaultMimeType: MIME_TYPE_AUTO,
            enabled: isSyntaxHighlightEnabled()
        },
        clipboard: {
            copy: copyTextWithToast
        },
        slashCommand: {
            removeCommands: [],
            dropdownLimit: Number.MAX_SAFE_INTEGER,
            extraCommands: buildExtraCommands()
        },
        template: {
            definitions: opts.templates
        },
        htmlSupport: {
            allow: JSON.parse(options.get("allowedHtmlTags"))
        },
        removePlugins: getDisabledPlugins(),
        ...await getCkLocale(opts.uiLanguage)
    };

    // Set up content language.
    const { contentLanguage } = opts;
    if (contentLanguage) {
        config.language = {
            ui: (typeof config.language === "string" ? config.language : "en"),
            content: contentLanguage
        }
    }

    // Mention customisation.
    if (options.get("textNoteCompletionEnabled") === "true") {
        config.mention = {
            feeds: [
                {
                    marker: "@",
                    feed: (queryText: string) => noteAutocompleteService.autocompleteSourceForCKEditor(queryText),
                    itemRenderer: (item) => {
                        const itemElement = document.createElement("button");

                        itemElement.innerHTML = `${(item as Suggestion).highlightedNotePathTitle} `;

                        return itemElement;
                    },
                    minimumCharacters: 0
                }
            ],
        };
    }

    // Enable premium plugins.
    if (hasPremiumLicense) {
        config.extraPlugins = [
            ...PREMIUM_PLUGINS
        ];
    }

    return {
        ...config,
        ...buildToolbarConfig(opts.isClassicEditor)
    };
}

function buildListOfLanguages() {
    const userLanguages = mimeTypesService
        .getMimeTypes()
        .filter((mt) => mt.enabled)
        .map((mt) => ({
            language: normalizeMimeTypeForCKEditor(mt.mime),
            label: mt.title
        }));

    return [
        {
            language: mimeTypesService.MIME_TYPE_AUTO,
            label: t("editable_text.auto-detect-language")
        },
        ...userLanguages
    ];
}

function getLicenseKey() {
    const premiumLicenseKey = import.meta.env.VITE_CKEDITOR_KEY;
    if (!premiumLicenseKey) {
        logError("CKEditor license key is not set, premium features will not be available.");
        return OPEN_SOURCE_LICENSE_KEY;
    }

    return premiumLicenseKey;
}

function getDisabledPlugins() {
    let disabledPlugins: string[] = [];

    if (options.get("textNoteEmojiCompletionEnabled") !== "true") {
        disabledPlugins.push("EmojiMention");
    }

    if (options.get("textNoteSlashCommandsEnabled") !== "true") {
        disabledPlugins.push("SlashCommand");
    }

    return disabledPlugins;
}
