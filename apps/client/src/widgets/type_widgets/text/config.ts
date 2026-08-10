import { type EditorConfig, getCkLocale, SnippetDefinition, type TextTransformationConfig } from "@triliumnext/ckeditor5";
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
import { getTaskStateDefinitions, openCustomTaskStateConfig } from "../../../services/task_states.js";
import { isMac } from "../../../services/utils.js";
import { resolveContentLanguage } from "../../../utils/formatters.js";
import SAMPLE_DIAGRAMS from "../mermaid/sample_diagrams.js";
import { buildQuoteTransformation, resolveQuoteSetting } from "./quotes.js";
import { buildCustomTransformations, parseCustomReplacements } from "./replacements.js";
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
                "toggleImageCaption"
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

    // Embed internal images as data: URIs when content is copied out to external apps, while
    // keeping internal Trilium paste reference-based (see the ClipboardImageEmbed plugin). The
    // resolver does the synchronous canvas encoding; the hidden option is a kill-switch.
    // `enabled` is a getter for the same reason as `autoLinkPreviewsEnabled` above, and because the
    // application-level handler covering read-only surfaces reads the option per copy — a baked-in
    // boolean would leave an open editor still embedding after the switch was flipped.
    config.clipboardImageEmbed = {
        enabled: () => options.get("clipboardImageEmbedEnabled") === "true",
        embedImage: (src: string) => imageService.embedReferenceImageAsDataUrl(src)
    };

    // The language this note is written in, which governs both its text direction and which
    // typographic quotes typing produces.
    //
    // The note's own `#language` label wins, being the only per-note signal and the one a
    // multilingual writer sets deliberately. Almost no note carries one though — the label is
    // opt-in, and the picker that sets it is empty until content languages are enabled — so the
    // `defaultContentLanguage` option is what answers in practice. It defaults to English, which is
    // what every note was implicitly treated as before the option existed; setting it to the empty
    // "auto" entry follows the application's language instead.
    //
    // Deliberately not `formattingLocale`: that one is presented as "Date & number format", so
    // someone who sets it for unambiguous dates would not expect it to restyle their prose.
    const contentLanguage = resolveContentLanguage(opts.contentLanguage);

    if (contentLanguage) {
        config.language = {
            ui: (typeof config.language === "string" ? config.language : "en"),
            content: contentLanguage
        };
    }

    config.typing = { transformations: buildTransformationsConfig(contentLanguage) };

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
 * Which as-you-type replacements the editor runs, expressed as deltas against CKEditor's own default
 * set rather than by restating it.
 *
 * That is deliberate: the dashes and the fractions are boundary-sensitive regexes upstream — ` -- `
 * needs its surrounding spaces, and `1/2` needs the guards that stop `11/2` becoming `1½` — and
 * those are exactly the definitions that break subtly when copied by hand. Naming a group in
 * `remove` disables it without us ever holding its pattern.
 *
 * Quotes are the one exception we do own, because which marks they produce depends on the note's
 * language and upstream has data for three locales. They are removed and re-supplied — but only when
 * we actually have a pair for the language, so an unmapped locale keeps falling through to
 * CKEditor's default rather than losing quote replacement altogether.
 */
function buildTransformationsConfig(contentLanguage: string | null): TextTransformationConfig {
    const remove: string[] = [];
    if (options.get("textNotePunctuationReplacementsEnabled") !== "true") remove.push("typography");
    if (options.get("textNoteMathReplacementsEnabled") !== "true") remove.push("mathematical");
    if (options.get("textNoteSymbolReplacementsEnabled") !== "true") remove.push("symbols");

    // The two keys are settled apart, so each is taken over from upstream only when we have
    // something to put in its place — naming the individual transformations rather than the `quotes`
    // group, which would take both away together.
    const double = resolveQuoteSetting(options.get("textNoteDoubleQuoteStyle"), "primary", contentLanguage);
    const single = resolveQuoteSetting(options.get("textNoteSingleQuoteStyle"), "secondary", contentLanguage);
    if (double.overridesUpstream) remove.push("quotesPrimary");
    if (single.overridesUpstream) remove.push("quotesSecondary");

    const extra = [
        ...(double.marks ? [buildQuoteTransformation("\"", double.marks)] : []),
        ...(single.marks ? [buildQuoteTransformation("'", single.marks)] : []),
        ...buildCustomTransformations(parseCustomReplacements(options.get("textNoteCustomReplacements")))
    ];

    // `include` is typed as required even though upstream's own documented examples pass `remove`
    // alone, and the plugin defines the default set in its constructor. Narrowed here rather than
    // restating the default groups, so that a group upstream adds later keeps working.
    return { remove, extra } as TextTransformationConfig;
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
