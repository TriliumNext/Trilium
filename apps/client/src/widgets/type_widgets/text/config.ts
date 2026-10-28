import { type AttachmentUploadHost, type ContentEmbedHost, type EditorConfig, getCkLocale, type IconPickerRequest, type LinkEmbedHost, SnippetDefinition, type TextTransformationConfig } from "@triliumnext/ckeditor5";
import emojiDefinitionsUrl from "@triliumnext/ckeditor5/src/emoji_definitions/en.json?url";
import { ALLOWED_PROTOCOLS, DISPLAYABLE_LOCALE_IDS, formatShortcut, IMAGE_UPLOAD_SUBTYPES, joinShortcut, KATEX_MACROS, MIME_TYPE_AUTO, normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import i18next from "i18next";

import type { CommandMappings, CommandNames } from "../../../components/app_context.js";
import { buildReferenceConfig, type ReferenceSource } from "../../../services/block_reference.js";
import { copyHtmlWithToast, copyTextWithToast } from "../../../services/clipboard_ext.js";
import { getUploadBoxSize } from "../../../services/content_renderer.js";
import { prompt } from "../../../services/dialog.js";
import { t } from "../../../services/i18n.js";
import imageService from "../../../services/image.js";
import { getNoteImageSourceToLoad } from "../../../services/image_urls.js";
import linkService from "../../../services/link.js";
import { detectEmbedType, fetchMetadata, renderEmbedPreview, renderMentionPreview, unresolvedMetadata } from "../../../services/link_embed.js";
import { default as mimeTypesService, getHighlightJsNameForMime } from "../../../services/mime_types.js";
import options from "../../../services/options.js";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content.js";
import server from "../../../services/server.js";
import { getSourceEmbedTypeByLanguage, SOURCE_EMBED_TYPES } from "../../../services/source_embeds.js";
import { ensureMimeTypesForHighlighting, isSyntaxHighlightEnabled } from "../../../services/syntax_highlight.js";
import { getTaskStateDefinitions, openCustomTaskStateConfig } from "../../../services/task_states.js";
import { formatDateTime, isMac, isMobile } from "../../../services/utils.js";
import { resolveContentLanguage } from "../../../utils/formatters.js";
import { convertImageToDrawing } from "../canvas/image_to_drawing.js";
import SAMPLE_DIAGRAMS from "../mermaid/sample_diagrams.js";
import buildAiAssistantStream, { type AiNoteLocationProvider, buildAiAssistantQuickActions } from "./ai_assistant_stream.js";
import diffAiResponse from "./ai_diff.js";
import { createColorMenuHost } from "./color_menu.js";
import { buildFontColorConfig, buildTableColorConfig } from "./color_palette.js";
import { createEmojiList, createNoteMentionList, createSlashCommandList } from "./mention_list_view.js";
import { getShownToolbarIsland } from "./mobile_editor_toolbar.js";
import { buildQuoteTransformation, resolveQuoteSetting } from "./quotes.js";
import { buildCustomTransformations, parseCustomReplacements } from "./replacements.js";
import { buildToolbarConfig } from "./toolbar.js";
import { createToolbarGroupMenuHost } from "./toolbar_group_menu.js";

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
    /**
     * Names the note the editor is open on, for the AI assistant to say where a run is writing and
     * for the `@` list to create a child note under.
     * A getter rather than the note itself: switching notes reuses the editor, so anything captured
     * here would name the note that happened to be open when it was built.
     */
    getNoteLocation?: AiNoteLocationProvider;
    /** The ID of the note the editor is open on. A getter for the same reason as `getNoteLocation`. */
    getNoteId?: () => string | undefined;
    /** The ID of the component that hosts the editor, which changes the editor makes are sent as. */
    getComponentId?: () => string | undefined;
    /** Triggers `command` with `data` on the component that hosts the editor. */
    triggerHostCommand?: <K extends CommandNames>(
        command: K, data?: CommandMappings[K]
    ) => Promise<unknown> | undefined | null;
    /** Shows the icon picker the editor asks for, as `inlineIcon.showPicker` does. */
    showIconPicker?: (request: IconPickerRequest) => (() => void) | null;
    /** The note that the block and tab references the editor copies point to. */
    referenceSource?: ReferenceSource;
    /**
     * What renders the embeds of the editor and acts on them. A getter: the handlers hold the
     * state of the component that hosts the editor, which changes as it renders.
     */
    getContentEmbedHandlers?: () => ContentEmbedHandlers | undefined;
}

/** The members of `contentEmbed` that the component hosting the editor implements. */
export type ContentEmbedHandlers =
    Omit<ContentEmbedHost, "pickNote" | "inlineLanguages" | "renderInlinePreview">;

export async function buildConfig(opts: BuildEditorOptions): Promise<EditorConfig> {
    // `undefined` when the AI features are off or no LLM provider is configured. Decided once:
    // it both disables the assistant's command and keeps its entries off the toolbar.
    const aiAssistantStream = buildAiAssistantStream(opts.getNoteLocation);
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
            katexRenderOptions: { macros: KATEX_MACROS },
            enableMathField: options.get("mathFieldEnabled") !== "false"
        },
        mermaid: {
            samples: SAMPLE_DIAGRAMS
        },
        contentEmbed: {
            pickNote: bindHostCommand(opts, "addIncludeNoteToText"),
            inlineLanguages: SOURCE_EMBED_TYPES.map((type) => type.language),
            renderInlinePreview: (language, source, container) => {
                void getSourceEmbedTypeByLanguage(language)?.renderPreview(source, container);
            },
            ...bindContentEmbedHandlers(opts.getContentEmbedHandlers)
        },
        image: {
            insert: {
                type: "auto"
            },
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
                "imagePosition",
                "|",
                "imageResize:25",
                "imageResize:50",
                "imageResize:original",
                "|",
                "toggleImageCaption",
                "|",
                "convertImageToDrawing"
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
            contentToolbar: [
                "tableColumn", "tableRow", "mergeTableCells", "tableSort", "tableProperties",
                "tableCellProperties", "toggleTableCaption"
            ],
            ...buildTableColorConfig()
        },
        list: {
            properties: {
                styles: true,
                startIndex: true,
                reversed: true
            }
        },
        alignment: {
            options: [ "left", "center", "right", "justify" ]
        },
        ...buildFontColorConfig(),
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
                : emojiDefinitionsUrl,
            list: createEmojiList
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
            copy: copyTextWithToast,
            copyHtml: copyHtmlWithToast
        },
        // Reads `customDateTimeFormat` on each call, so a changed format applies to open editors.
        formatDateTime: (date, format) => formatDateTime(date, format ?? options.get("customDateTimeFormat")),
        referenceLink: {
            getTitle: linkService.getReferenceLinkTitle,
            getTitleSync: linkService.getReferenceLinkTitleSync,
            renderTitle: (element, href, storedTitle) => {
                void linkService.loadReferenceLinkTitle($(element), href, opts.getNoteId?.(), storedTitle);
            },
            fixLink: (storedTitle, fix) => {
                void opts.triggerHostCommand?.("showAddLinkDialog", {
                    text: storedTitle,
                    hasSelection: false,
                    fixLink: true,
                    async addLink(notePath) {
                        fix(`#${notePath}`);
                    }
                });
            }
        },
        linkEmbed: buildLinkEmbedHost(opts.getNoteId),
        getNoteId: opts.getNoteId,
        attachmentUpload: buildAttachmentUploadHost(opts.getComponentId),
        internalLink: { openDialog: bindHostCommand(opts, "addLinkToText") },
        markdownImport: { open: bindHostCommand(opts, "pasteMarkdownIntoText") },
        inlineIcon: { showPicker: (request) => opts.showIconPicker?.(request) ?? null },
        ...(opts.referenceSource && buildReferenceConfig(opts.referenceSource)),
        imageToDrawing: {
            async convert(src) {
                const noteId = opts.getNoteId?.();
                return noteId ? convertImageToDrawing(noteId, src, opts.getComponentId?.()) : null;
            }
        },
        cutToNote: {
            cut: bindHostCommand(opts, "cutIntoNote"),
            saveNow: bindHostCommand(opts, "saveNoteDetailNow")
        },
        slashCommand: {
            // Drop CKEditor's built-in list slash commands, whose Title Case titles the palette
            // re-defines in sentence case.
            removeCommands: ["bulletedList", "numberedList"],
            list: createSlashCommandList
        },
        snippets: {
            definitions: opts.templates
        },
        aiAssistant: {
            stream: aiAssistantStream,
            // The "Changes" review view: a block-aware inline diff, so that a response which
            // rewrote a paragraph rather than editing it reads as a replacement instead of as
            // shredded `<ins>`/`<del>` pairs.
            diff: diffAiResponse,
            quickActions: buildAiAssistantQuickActions(),
            // The glyph the context menu gives the same row, so the two ways into a typed prompt
            // look alike.
            askIconClass: "bx bx-message-square-dots",
            // The model's HTML reaches the preview through `innerHTML`, so it gets the same
            // DOMPurify pass as any other untrusted content rendered outside the editor's
            // data pipeline. CKEditor ships no sanitizer of its own — like `htmlEmbed`, the
            // feature takes one from the integrator.
            sanitizeHtml: sanitizeNoteContentHtml
        },
        htmlSupport: buildHtmlSupportConfig(),
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
    // managers when it's false. The mobile layout leaves them out: they show keyboard
    // shortcuts, and the caret sets them off on every tap.
    (config as Record<string, unknown>).contentHintsEnabled = !isMobile()
        && options.get("textNoteContentHintsEnabled") === "true";

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

    // Loads a changed note image from a new URL, so the browser does not show the copy it loaded
    // before.
    config.imageEditingSource = { resolve: getNoteImageSourceToLoad };

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

    // Table sorting reads dates inserted in the user's own format.
    const customDateTimeFormat = options.get("customDateTimeFormat");
    config.autoSort = { dateFormats: customDateTimeFormat ? [customDateTimeFormat] : [] };

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

    config.mention = {
        feeds: [],
        hostedFeeds: options.get("textNoteCompletionEnabled") === "true" ? [
            {
                marker: "@",
                minimumCharacters: 0,
                // Note titles contain spaces, so the query must be allowed to as well.
                allowSpaces: true,
                list: () => createNoteMentionList({
                    allowCreatingNotes: true,
                    getParentNotePath: () => opts.getNoteLocation?.()?.notePath
                })
            }
        ] : []
    };

    config.toolbarGroupMenu = { host: () => createToolbarGroupMenuHost() };
    config.colorMenu = { host: () => createColorMenuHost() };
    config.listStartPrompt = async (label, current) =>
        parseListStart(await prompt({ title: label, defaultValue: String(current) }));
    config.tableColumnBar = { bottomObstacle: getShownToolbarIsland };

    return {
        ...config,
        ...buildToolbarConfig(opts.isClassicEditor, !!aiAssistantStream)
    };
}

/** The `contentEmbed` members that call the handlers `getHandlers()` returns at the time. */
function bindContentEmbedHandlers(
    getHandlers: () => ContentEmbedHandlers | undefined = () => undefined
): ContentEmbedHandlers {
    return {
        loadNote: (...args) => getHandlers()?.loadNote(...args),
        loadAttachment: (...args) => getHandlers()?.loadAttachment(...args),
        loadInline: (...args) => getHandlers()?.loadInline(...args),
        focusAttachment: (attachmentId) => getHandlers()?.focusAttachment(attachmentId),
        getAttachmentHref: async (attachmentId) =>
            (await getHandlers()?.getAttachmentHref(attachmentId)) ?? null,
        openMenu: (embed, anchor) => getHandlers()?.openMenu(embed, anchor),
        getTools: (embed) => getHandlers()?.getTools(embed) ?? null,
        enter: (embed, edge) => getHandlers()?.enter(embed, edge) ?? false
    };
}

/** A callback that triggers `command` on the component that hosts the editor, and waits for it. */
function bindHostCommand(opts: BuildEditorOptions, command: CommandNames) {
    return async () => {
        await opts.triggerHostCommand?.(command);
    };
}

/** The upload services of the editor, sending its uploads as changes of `getComponentId()`. */
function buildAttachmentUploadHost(getComponentId?: () => string | undefined): AttachmentUploadHost {
    return {
        async getHeaders() {
            // Sent as a change of the host, which then does not redraw the links and embeds it shows.
            const headers = await server.getHeaders({ "trilium-component-id": getComponentId?.() });
            const sent: Record<string, string> = {};
            for (const [ name, value ] of Object.entries(headers)) {
                if (value) {
                    sent[name] = value;
                }
            }
            return sent;
        },
        getLocalUpload: server.getLocalUpload,
        getEmbedBoxSize: getUploadBoxSize
    };
}

/** The link preview services of the editor, for the note `getNoteId()` names. */
function buildLinkEmbedHost(getNoteId?: () => string | undefined): LinkEmbedHost {
    return {
        async fetchMetadata(url) {
            // The pictures of a preview are stored as attachments of the note being edited, so
            // without a note the URL stays a plain link, as for any preview that cannot be built.
            const noteId = getNoteId?.();
            return noteId ? await fetchMetadata(url, noteId) : unresolvedMetadata(url);
        },
        detectEmbedType,
        renderEmbed: renderEmbedPreview,
        renderMention: renderMentionPreview
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
/** The number a list starts at, from the text of a prompt: a whole number of 0 or more, or `null`. */
function parseListStart(value: string | null) {
    const text = value?.trim() ?? "";
    return /^\d+$/.test(text) ? Number(text) : null;
}

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
        .getEnabledMimeTypes()
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

/**
 * Turns the `allowedHtmlTags` option — a flat list of tag names, shared with the server-side
 * sanitizer — into the General HTML Support allow-list.
 *
 * Gated on `textNoteHtmlSupportEnabled`, which ships off, so the default install runs with GHS
 * allowing nothing and the editor keeps only what its own features model. Everything below applies
 * once the user turns it on.
 *
 * The wrapping is not cosmetic. `DataFilter#loadAllowedConfig` reads each entry's `name` and falls
 * back to a match-everything pattern without one, so bare strings allowed *every* element, including
 * GHS's `$customElement` catch-all: unknown tags round-tripped as opaque blobs that the editing view
 * drew as an empty `<span data-ck-unsafe-element>` — visible in read mode and search, invisible and
 * un-navigable while editing (#10989). `attributes`/`classes`/`styles` are the per-element rules
 * `splitRules` looks for; without them GHS strips every attribute off what it does preserve.
 */
function buildHtmlSupportConfig(): EditorConfig["htmlSupport"] {
    // GHS decides per element, so switching it off is an empty allow-list rather than a narrower
    // one — there is no subset of the option that stays meaningful here.
    if (options.get("textNoteHtmlSupportEnabled") !== "true") {
        return { allow: [] };
    }

    const allowedTags: string[] = JSON.parse(options.get("allowedHtmlTags"));

    return {
        allow: allowedTags
            .filter((name) => !EDITOR_ONLY_DISALLOWED_TAGS.has(name))
            .map((name) => ({ name, attributes: true, classes: true, styles: true }))
    };
}

/**
 * Withheld from the editor even when the option lists them, and only from the editor — the
 * sanitizer reads the same option and still accepts them on import.
 *
 * `div` earns its place through GHS's dual content model: with inline content it becomes an
 * `htmlDivParagraph` that every paragraph-keyed feature mistreats, and around a block it becomes a
 * bare `htmlDiv` with no type-around, so a wrapped code block has nothing after it to escape into.
 * Unwrapping loses nothing — no in-tree feature needs GHS to handle a div, footnotes claim their own
 * by attribute — and it flattens the nested-div cruft that pasting from a web page drags in.
 */
const EDITOR_ONLY_DISALLOWED_TAGS = new Set(["div"]);

function getDisabledPlugins() {
    const disabledPlugins: string[] = [];

    if (options.get("textNoteEmojiCompletionEnabled") !== "true") {
        disabledPlugins.push("TriliumEmojiMention");
    }

    if (options.get("textNoteSlashCommandsEnabled") !== "true") {
        disabledPlugins.push("TriliumSlashCommands");
    }

    // The mobile layout leaves no margin beside the blocks for the drag handle.
    if (isMobile()) {
        disabledPlugins.push("BlockDragHandle");
    }

    return disabledPlugins;
}
