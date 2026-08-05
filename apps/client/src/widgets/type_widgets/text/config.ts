import { type EditorConfig, getCkLocale, SnippetDefinition } from "@triliumnext/ckeditor5";
import emojiDefinitionsUrl from "@triliumnext/ckeditor5/src/emoji_definitions/en.json?url";
import { ALLOWED_PROTOCOLS, DISPLAYABLE_LOCALE_IDS, formatShortcut, IMAGE_UPLOAD_SUBTYPES, joinShortcut, KATEX_MACROS, MIME_TYPE_AUTO, normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import i18next from "i18next";

import { copyTextWithToast } from "../../../services/clipboard_ext.js";
import { t } from "../../../services/i18n.js";
import imageService from "../../../services/image.js";
import { getMermaidConfig } from "../../../services/mermaid.js";
import { default as mimeTypesService, getHighlightJsNameForMime } from "../../../services/mime_types.js";
import noteAutocompleteService, { type Suggestion } from "../../../services/note_autocomplete.js";
import options from "../../../services/options.js";
import { ensureMimeTypesForHighlighting, isSyntaxHighlightEnabled } from "../../../services/syntax_highlight.js";
import { isMac } from "../../../services/utils.js";
import { getTaskStateDefinitions, openCustomTaskStateConfig } from "../../../services/task_states.js";
import SAMPLE_DIAGRAMS from "../mermaid/sample_diagrams.js";
import { buildToolbarConfig } from "./toolbar.js";

/**
 * The only license key Trilium ever passes to CKEditor. Every premium plugin the editor used has
 * been replaced by a GPL in-tree one, so there is no commercial license to configure any more.
 */
export const OPEN_SOURCE_LICENSE_KEY = "GPL";

export interface BuildEditorOptions {
    isClassicEditor: boolean;
    uiLanguage: DISPLAYABLE_LOCALE_IDS;
    contentLanguage: string | null;
    templates: SnippetDefinition[];
}

export async function buildConfig(opts: BuildEditorOptions): Promise<EditorConfig> {
    const config: EditorConfig = {
        licenseKey: OPEN_SOURCE_LICENSE_KEY,
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
            katexRenderOptions: { macros: KATEX_MACROS }
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
                "toggleImageCaption",
                "|",
                "annotateImage"
            ],
            upload: {
                // Derived rather than listed, so what the editor inserts as a picture and what the
                // upload endpoint stores as one cannot drift apart — either direction of a mismatch
                // is a broken element. See IMAGE_MIMES.
                types: [ ...IMAGE_UPLOAD_SUBTYPES ]
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
            // linkEmbedDisplayDropdown is the same Display dropdown the link-preview widget toolbar
            // shows: on a native link it reads "Plain link" and converts to a preview shape.
            toolbar: ["linkPreview", "copyLinkUrl", "|", "editLink", "linkProperties", "unlink", "|", "linkEmbedDisplayDropdown"]
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
            // Drop CKEditor's built-in slash commands whose title/icon the palette re-defines: the
            // Mermaid one (generic icon) and the list ones (Title Case titles, normalized to
            // sentence case).
            removeCommands: ["insertMermaidCommand", "bulletedList", "numberedList", "todoList"],
            dropdownLimit: Number.MAX_SAFE_INTEGER
        },
        snippets: {
            definitions: opts.templates
        },
        htmlSupport: {
            allow: JSON.parse(options.get("allowedHtmlTags"))
        },
        removePlugins: getDisabledPlugins(),
        // The locale's CKEditor translations, plus the dictionary of Trilium-authored editor
        // strings resolved through the app's i18n (see `messages.ts` in the ckeditor5 package).
        ...await getCkLocale(opts.uiLanguage, { englishMessages: getEnglishEditorMessages(), translate: (key) => t(key) })
    };

    // User-configurable todo task states (from the `_taskStates` hidden subtree).
    (config as Record<string, unknown>).taskStates = await getTaskStateDefinitions();
    (config as Record<string, unknown>).editTaskStates = openCustomTaskStateConfig;

    // Renders a keystroke a plugin mentions in a hint. The editor's own strings translate through
    // its dictionary (see `messages.ts` in the ckeditor5 package), but the key names inside a
    // shortcut come from `keyboard_shortcut_keys`, which the command palette and the help dialog
    // read too — so the app renders them and hands the markup over.
    (config as Record<string, unknown>).renderShortcut = (shortcut: string) =>
        joinShortcut(formatShortcut(shortcut, t, isMac()).map((token) => `<kbd>${token}</kbd>`), isMac());

    // Global on/off switch for content-area hints (bottom-corner popups on task
    // checkboxes, collapsible summaries, drag handles). Plugins consult this via
    // `editor.config.get("contentHintsEnabled")` and skip registering their hint
    // managers when it's false.
    (config as Record<string, unknown>).contentHintsEnabled = options.get("textNoteContentHintsEnabled") === "true";

    // Whether a URL typed or pasted into the note is auto-detected and turned into a link preview.
    // A getter rather than a boolean: the LinkEmbed plugin calls it each time a URL is detected, so
    // toggling the option applies to already-open editors instead of only to ones created afterwards.
    // Only the auto-detection is gated — inserting a preview from the toolbar dialog always works.
    (config as Record<string, unknown>).autoLinkPreviewsEnabled = () => options.get("textNoteAutoLinkPreviewsEnabled") === "true";

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
                        itemElement.className = "note-mention-suggestion";

                        const iconElement = document.createElement("span");
                        // Choose appropriate icon based on action
                        let iconClass = suggestion.icon ?? "bx bx-note";
                        if (suggestion.action === "create-note") {
                            iconClass = "bx bx-plus";
                        }
                        iconElement.className = iconClass;

                        // The title keeps a wrapper of its own rather than being spread into the
                        // button: the row lays the icon out against the title as a whole (see the
                        // `note-mention-suggestion` rule), which it cannot do over loose text nodes.
                        const titleContainer = document.createElement("span");
                        titleContainer.className = "note-mention-suggestion-title";
                        titleContainer.innerHTML = suggestion.highlightedNotePathTitle ?? "";
                        itemElement.append(iconElement, titleContainer);

                        return itemElement;
                    },
                    minimumCharacters: 0,
                    // Note titles contain spaces, so the query must be allowed to as well.
                    allowSpaces: true
                }
            ],
        };
    }

    return {
        ...config,
        ...buildToolbarConfig(opts.isClassicEditor)
    };
}

/**
 * The English editor messages, i.e. the `text-editor.ck` section of the English catalog, mapping
 * each derived key to the English text that plugins pass to `editor.t()`. This section is the
 * registry of Trilium-authored editor strings — there is no list of them in code — so reading it
 * back is what lets the message dictionary be built.
 *
 * English is always loaded, being i18next's `fallbackLng`; an empty section only means every editor
 * string renders its English message id, which is what an unconfigured editor does anyway.
 *
 * `getResourceBundle` is bound onto the i18next instance by `init()`, so it is missing until
 * `initLocale()` has run — the case for a test that builds a config without booting i18n.
 */
function getEnglishEditorMessages(): Record<string, string> {
    const bundle = i18next.getResourceBundle?.("en", "translation") as
        { "text-editor"?: { ck?: Record<string, string> } } | undefined;
    return bundle?.["text-editor"]?.ck ?? {};
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

function getDisabledPlugins() {
    const disabledPlugins: string[] = [];

    if (options.get("textNoteEmojiCompletionEnabled") !== "true") {
        disabledPlugins.push("TriliumEmojiMention");
    }

    if (options.get("textNoteSlashCommandsEnabled") !== "true") {
        disabledPlugins.push("TriliumSlashCommands");
    }

    return disabledPlugins;
}
