import { buildExtraCommands, type EditorConfig, getCkLocale, loadPremiumPlugins, TemplateDefinition } from "@triliumnext/ckeditor5";
import emojiDefinitionsUrl from "@triliumnext/ckeditor5/src/emoji_definitions/en.json?url";
import { ALLOWED_PROTOCOLS, DISPLAYABLE_LOCALE_IDS, KATEX_MACROS, MIME_TYPE_AUTO, normalizeMimeTypeForCKEditor } from "@triliumnext/commons";

import { copyTextWithToast } from "../../../services/clipboard_ext.js";
import { t } from "../../../services/i18n.js";
import imageService from "../../../services/image.js";
import { getMermaidConfig } from "../../../services/mermaid.js";
import { default as mimeTypesService, getHighlightJsNameForMime } from "../../../services/mime_types.js";
import noteAutocompleteService, { type Suggestion } from "../../../services/note_autocomplete.js";
import options from "../../../services/options.js";
import { ensureMimeTypesForHighlighting, isSyntaxHighlightEnabled } from "../../../services/syntax_highlight.js";
import { getTaskStateDefinitions, openCustomTaskStateConfig } from "../../../services/task_states.js";
import SAMPLE_DIAGRAMS from "../mermaid/sample_diagrams.js";
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
                (window as any).katex = (await import("../../../services/math.js")).default;
            },
            forceOutputType: false, // forces output to use outputType
            enablePreview: true, // Enable preview view
            // Map MathLive-only commands (e.g. \differentialD) onto KaTeX equivalents so
            // formulas produced by the visual editor render instead of erroring out (#9523).
            katexRenderOptions: { macros: KATEX_MACROS },
            enableMathField: options.get("mathFieldEnabled") !== "false"
        },
        mermaid: {
            lazyLoad: async () => (await import("mermaid")).default, // FIXME
            config: getMermaidConfig(),
            samples: SAMPLE_DIAGRAMS
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
            allowedProtocols: ALLOWED_PROTOCOLS,
            toolbar: ["linkPreview", "copyLinkUrl", "|", "editLink", "linkProperties", "unlink"]
        },
        bookmark: {
            toolbar: [
                "bookmarkPreview",
                "copyAnchorLink",
                "|",
                "editBookmark",
                "removeBookmark"
            ]
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
            // Drop CKEditor's built-in slash commands whose title/icon we re-define in
            // buildExtraCommands: the Mermaid one (generic icon) and the list ones
            // (Title Case titles, normalized to sentence case).
            removeCommands: ["insertMermaidCommand", "bulletedList", "numberedList", "todoList"],
            dropdownLimit: Number.MAX_SAFE_INTEGER,
            extraCommands: buildExtraCommands((key, params) => t(key, params), SAMPLE_DIAGRAMS)
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

    // User-configurable todo task states (from the `_taskStates` hidden subtree).
    (config as Record<string, unknown>).taskStates = await getTaskStateDefinitions();
    (config as Record<string, unknown>).editTaskStates = openCustomTaskStateConfig;

    // The app's i18n translate function, so plugins can resolve Trilium translation keys.
    (config as Record<string, unknown>).translate = (key: string, params?: Record<string, unknown>) => t(key, params);

    // Image toolbar actions (copy / download), handled by the ImageActions plugin. The copy
    // button is only added where copying the raw image is supported (Electron or a secure
    // context); elsewhere the browser's own context menu still offers a "Copy image" entry.
    (config as Record<string, unknown>).imageActions = {
        copyToClipboard: (src: string) => imageService.copyImageToClipboard(src),
        download: (src: string) => imageService.downloadImage(src)
    };
    const imageToolbar = (config.image as { toolbar: (string | object)[] }).toolbar;
    imageToolbar.push("|", ...(imageService.isImageCopySupported() ? ["copyImageToClipboard"] : []), "downloadImage");

    // Set up content language.
    const { contentLanguage } = opts;
    if (contentLanguage) {
        config.language = {
            ui: (typeof config.language === "string" ? config.language : "en"),
            content: contentLanguage
        };
    }

    // Mention customisation.
    if (options.get("textNoteCompletionEnabled") === "true") {
        config.mention = {
            feeds: [
                {
                    marker: "@",
                    feed: (queryText: string) => noteAutocompleteService.autocompleteSourceForCKEditor(queryText),
                    itemRenderer: (item) => {
                        const suggestion = item as Suggestion;
                        const itemElement = document.createElement("button");

                        const iconElement = document.createElement("span");
                        // Choose appropriate icon based on action
                        let iconClass = suggestion.icon ?? "bx bx-note";
                        if (suggestion.action === "create-note") {
                            iconClass = "bx bx-plus";
                        }
                        iconElement.className = iconClass;

                        itemElement.append(iconElement, document.createTextNode(" "));
                        const titleContainer = document.createElement("span");
                        titleContainer.innerHTML = suggestion.highlightedNotePathTitle ?? "";
                        itemElement.append(...titleContainer.childNodes, document.createTextNode(" "));

                        return itemElement;
                    },
                    minimumCharacters: 0
                }
            ],
        };
    }

    // Enable premium plugins dynamically to avoid eager loading.
    if (hasPremiumLicense) {
        config.extraPlugins = await loadPremiumPlugins();
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
        // The `env=frontend`/`env=backend` JavaScript variants are Trilium script environments,
        // which are meaningless inside a (display-only) code block. Plain `text/javascript`
        // already provides JavaScript highlighting, so omit the script-specific variants here.
        .filter((mt) => mt.mime && !mt.mime.startsWith("application/javascript;env="))
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
    const disabledPlugins: string[] = [];

    if (options.get("textNoteEmojiCompletionEnabled") !== "true") {
        disabledPlugins.push("EmojiMention");
    }

    if (options.get("textNoteSlashCommandsEnabled") !== "true") {
        disabledPlugins.push("SlashCommand");
    }

    return disabledPlugins;
}
