import type { KeyboardActionNames } from "./keyboard_actions_interface.js";
import type { ImageJpegHandling, ImagePngHandling } from "./server_api.js";

/**
 * A dictionary where the keys are the option keys (e.g. `theme`) and their corresponding values.
 */
export type OptionMap = Record<OptionNames, string>;

/**
 * For each keyboard action, there is a corresponding option which identifies the key combination defined by the user.
 */
type KeyboardShortcutsOptions<T extends KeyboardActionNames> = {
    [key in T as `keyboardShortcuts${Capitalize<key>}`]: string;
};

export type FontFamily = "theme" | "serif" | "sans-serif" | "monospace" | string;

/**
 * System sans-serif font stack for cross-platform compatibility.
 * Used when the user selects "System default" for non-monospace fonts.
 */
export const SYSTEM_SANS_SERIF_FONT_STACK = [
    "system-ui",
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "Cantarell",
    "Ubuntu",
    "Noto Sans",
    "Helvetica",
    "Arial",
    "sans-serif",
    "Apple Color Emoji",
    "Segoe UI Emoji"
].join(",");

/**
 * System monospace font stack for cross-platform compatibility.
 * Used when the user selects "System default" for monospace fonts.
 */
export const SYSTEM_MONOSPACE_FONT_STACK = [
    "ui-monospace",
    "SFMono-Regular",
    "SF Mono",
    "Consolas",
    "Source Code Pro",
    "Ubuntu Mono",
    "Menlo",
    "Liberation Mono",
    "monospace"
].join(",");

export interface OptionDefinitions extends KeyboardShortcutsOptions<KeyboardActionNames> {
    openNoteContexts: string;
    lastDailyBackupDate: string;
    lastWeeklyBackupDate: string;
    lastMonthlyBackupDate: string;
    /**
     * Directory the database backups are written to, replacing the default one inside the data
     * directory. Empty means "use the default". Honoured on the desktop application only; the server
     * is configured through the `TRILIUM_BACKUP_DIR` environment variable instead.
     */
    customDbBackupDir: string;
    dbVersion: string;
    theme: string;
    syncServerHost: string;
    syncServerTimeout: string;
    syncServerTimeoutTimeScale: number;
    syncProxy: string;
    syncIncomplete: boolean;
    syncMaxBlobContentSize: number;
    mainFontFamily: FontFamily;
    treeFontFamily: FontFamily;
    detailFontFamily: FontFamily;
    monospaceFontFamily: FontFamily;
    spellCheckLanguageCode: string;
    codeNotesMimeTypes: string;
    contentManagerSortOrder: string;
    contentManagerViewMode: string;
    headingStyle: string;
    highlightsList: string;
    customSearchEngineName: string;
    customSearchEngineUrl: string;
    locale: string;
    formattingLocale: string;
    /**
     * The language a note is written in when it carries no `#language` label of its own — which is
     * almost every note, the label being opt-in. Governs what the content language drives: text
     * direction and which typographic quotes typing produces.
     *
     * An empty value means "follow the application's language" rather than "no language".
     */
    defaultContentLanguage: string;
    codeBlockTheme: string;
    codeBlockThemeMatchesApp: boolean;
    codeBlockThemeLight: string;
    codeBlockThemeDark: string;
    textNoteEditorType: string;
    layoutOrientation: string;
    allowedHtmlTags: string;
    /** JSON: what the Content Manager's cleanup tool was last set to erase — see `CleanupToolOptions`. */
    cleanupToolOptions: string;
    /** JSON: how the image compression tool was last set to compress — see `ImageCompressionToolOptions`. */
    imageCompressionToolOptions: string;
    documentId: string;
    documentSecret: string;
    passwordVerificationHash: string;
    passwordVerificationSalt: string;
    passwordDerivedKeySalt: string;
    encryptedDataKey: string;
    hoistedNoteId: string;
    customDateTimeFormat: string;

    // Multi-Factor Authentication
    mfaMethod: string;
    totpEncryptionSalt: string;
    totpEncryptedSecret: string;
    totpVerificationHash: string;
    encryptedRecoveryCodes: boolean;
    recoveryCodeInitialVector: string;
    recoveryCodeSecurityKey: string;
    recoveryCodesEncrypted: string;

    lastSyncedPull: number;
    lastSyncedPush: number;
    revisionSnapshotTimeInterval: number;
    revisionSnapshotTimeIntervalTimeScale: number;
    revisionSnapshotNumberLimit: number;
    revisionIgnoreNamedSnapshots: boolean;
    protectedSessionTimeout: number;
    protectedSessionTimeoutTimeScale: number;
    zoomFactor: number;
    mainFontSize: number;
    treeFontSize: number;
    detailFontSize: number;
    monospaceFontSize: number;
    imageMaxWidthHeight: number;
    imageJpegQuality: number;
    /** JPEG quality a lossless image is converted at, kept apart from {@link imageJpegQuality}. */
    imageConversionQuality: number;
    leftPaneWidth: number;
    rightPaneWidth: number;
    rightPaneCollapsedItems: string;
    rightPaneSelectedTab: string;
    /**
     * Which map the connections tab draws, `link` or `tree`. A preference of the reader's rather than
     * a property of any one note: the tab is a lens on whatever note is being read, and a note map
     * that is a note's own thing — a note map note, a hoisted map — is told which to draw by that
     * note's own `mapType` label instead.
     */
    rightPaneNoteMapType: string;
    eraseEntitiesAfterTimeInSeconds: number;
    eraseEntitiesAfterTimeScale: number;
    autoReadonlySizeText: number;
    autoReadonlySizeCode: number;
    maxContentWidth: number;
    centerContent: boolean;
    minTocHeadings: number;
    eraseUnusedAttachmentsAfterSeconds: number;
    eraseUnusedAttachmentsAfterTimeScale: number;
    logRetentionDays: number;
    firstDayOfWeek: number;
    firstWeekOfYear: number;
    minDaysInFirstWeek: number;
    languages: string;

    // Appearance
    splitEditorOrientation: "horziontal" | "vertical";
    motionEnabled: boolean;
    shadowsEnabled: boolean;
    backdropEffectsEnabled: boolean;
    smoothScrollEnabled: boolean;
    /** Desktop only: when disabled, Electron starts with GPU hardware acceleration turned off (workaround for GPU driver incompatibilities that cause a blank window). Requires an app restart. */
    hardwareAccelerationEnabled: boolean;
    codeNoteTheme: string;
    codeNoteThemeMatchesApp: boolean;
    codeNoteThemeLight: string;
    codeNoteThemeDark: string;

    initialized: boolean;
    databaseReadonly: boolean;
    backendScriptingEnabled: boolean;
    sqlConsoleEnabled: boolean;
    allowLanAccess: boolean;
    hasUserBackendScripts: boolean;
    isPasswordSet: boolean;
    overrideThemeFonts: boolean;
    /**
     * Whether the monospace font's programming ligatures (`!=` rendered as `≠`, `->` as `→`) are
     * left on. Off by default: the bundled JetBrains Mono ships them enabled, so users get them
     * without choosing them and repeatedly mistake them for their characters having been replaced.
     */
    monospaceLigaturesEnabled: boolean;
    spellCheckEnabled: boolean;
    autoFixConsistencyIssues: boolean;
    vimKeymapEnabled: boolean;
    codeLineWrapEnabled: boolean;
    leftPaneVisible: boolean;
    rightPaneVisible: boolean;
    nativeTitleBarVisible: boolean;
    hideArchivedNotes_main: boolean;
    debugModeEnabled: boolean;
    autoCollapseNoteTree: boolean;
    treeScrollFollowNavigation: boolean;
    dailyBackupEnabled: boolean;
    weeklyBackupEnabled: boolean;
    monthlyBackupEnabled: boolean;
    /**
     * Whether backups are gzip-compressed. Compression or encryption switches the backup from a
     * plain database file to a backup container; with both off, backups stay plain `.db` copies.
     */
    backupEnableCompression: boolean;
    /**
     * Whether backups are encrypted with the stored backup passphrase. Desktop only, and only where
     * the OS offers a keyring to keep that passphrase in, since unattended backups cannot ask for
     * it.
     */
    backupEnableEncryption: boolean;
    compressImages: boolean;
    /**
     * Whether an image above {@link imageMaxWidthHeight} is scaled down on its way in. Off, the
     * bound governs nothing and only the re-encoding choices below can shrink anything.
     */
    imageResize: boolean;
    /** What becomes of an already-lossy image on its way in: left as encoded, or recompressed. */
    imageJpegHandling: ImageJpegHandling;
    /** What becomes of a lossless image on its way in: left alone, quantized, or converted. */
    imagePngHandling: ImagePngHandling;
    downloadImagesAutomatically: boolean;
    checkForUpdates: boolean;
    disableTray: boolean;
    /** When closing the window on desktop, hide it to the system tray instead of quitting. Requires the tray icon to be enabled. */
    closeToTray: boolean;
    /** Whether the desktop app is launched automatically when the user logs into their computer. */
    launchOnStartup: boolean;
    /** When the app is launched automatically at login, start it minimized to the tray instead of showing a window. Requires {@link launchOnStartup} and the tray icon. */
    hideOnAutoStart: boolean;
    editedNotesOpenInRibbon: boolean;
    codeBlockWordWrap: boolean;
    codeBlockTabWidth: number;
    codeNoteTabWidth: number;
    codeNoteIndentWithTabs: boolean;
    textNoteEditorMultilineToolbar: boolean;
    /**
     * Which marks a typed `"…"` becomes: `auto` to follow the note's content language, `off` to
     * leave straight quotes alone, or the id of one of `QUOTE_MARK_PRESETS` to always use that pair
     * whatever the note is written in.
     */
    textNoteDoubleQuoteStyle: string;
    /** The same for a typed `'…'`, which conventions set a nested quotation in. */
    textNoteSingleQuoteStyle: string;
    /** Whether `...` becomes `…`, and ` -- ` / ` --- ` become an en/em dash, as they are typed. */
    textNotePunctuationReplacementsEnabled: boolean;
    /** Whether `1/2`, `!=`, `->` and their kin become `½`, `≠`, `→` as they are typed. */
    textNoteMathReplacementsEnabled: boolean;
    /** Whether `(c)`, `(r)` and `(tm)` become `©`, `®` and `™` as they are typed. */
    textNoteSymbolReplacementsEnabled: boolean;
    /** JSON: the user's own replacements, as `{ from, to }` pairs — see `CustomReplacement`. */
    textNoteCustomReplacements: string;
    /** Whether keyboard auto-completion for emojis is triggered when typing `:`. */
    textNoteEmojiCompletionEnabled: boolean;
    /** Whether keyboard auto-completion for notes is triggered when typing `@` in text notes (attribute editing is not affected). */
    textNoteCompletionEnabled: boolean;
    /** Whether keyboard auto-completion for editing commands is triggered when typing `/`. */
    textNoteSlashCommandsEnabled: boolean;
    /** Whether the MathLive visual editor is shown when editing math. If false, only the LaTeX textarea is used. */
    mathFieldEnabled: boolean;
    /** Whether the editor surfaces content-area hints (bottom-corner popups that document how to interact with the element under the caret or pointer, e.g. task-state cycle, collapsible-summary shortcut, drag-handle label). */
    textNoteContentHintsEnabled: boolean;
    /** Whether a URL typed or pasted into a text note is automatically turned into a link preview. The "Link preview" dialog is unaffected and always inserts one on request. */
    textNoteAutoLinkPreviewsEnabled: boolean;
    /**
     * Whether the editor preserves the HTML tags it has no editing feature of its own for — the
     * ones named by `allowedHtmlTags`, carried through CKEditor's General HTML Support.
     *
     * Off by default: GHS renders such a tag as an opaque blob that is awkward to navigate and, for
     * an unknown element, invisible while editing (#10989). The price of leaving it off is that
     * those tags are dropped from a note the first time it is edited and saved. The server-side
     * sanitizer reads the same `allowedHtmlTags` list and keeps accepting them on import either way,
     * so an imported note shows them correctly until it is edited.
     */
    textNoteHtmlSupportEnabled: boolean;
    /** Whether copying note content embeds internal images as data: URIs so they paste into external apps (internal paste stays reference-based). Hidden kill-switch. */
    clipboardImageEmbedEnabled: boolean;
    backgroundEffects: boolean;
    newLayout: boolean;

    // PDF settings
    /**
     * The pdf.js reusable signature library, stored as a JSON string keyed by signature UUID
     * (`{ [uuid]: { description, signatureData } }`). Persisted here — instead of pdf.js' default
     * per-browser `localStorage` — so saved signatures sync across devices.
     */
    pdfSignatures: string;

    // Search settings
    /** Whether fuzzy matching is enabled in search (matches similar words when exact matches are insufficient). */
    searchEnableFuzzyMatching: boolean;
    /** Whether fuzzy matching is enabled for autocomplete (typing in search bar). Disabled by default for faster response. */
    searchAutocompleteFuzzy: boolean;

    // Share settings
    redirectBareDomain: boolean;
    showLoginInShareTheme: boolean;

    seenCallToActions: string;
    experimentalFeatures: string;

    // Include note settings
    includeNoteDefaultBoxSize: "small" | "medium" | "full" | "expandable";

    // AI / LLM
    /** Whether the AI/LLM features (chat sidebar, LLM chat notes) are enabled. */
    aiEnabled: boolean;
    /** JSON array of configured LLM providers with their API keys */
    llmProviders: string;
    /** The model the text editor's AI assistant runs on, as JSON `{ providerId, provider, model }`; empty to follow the first configured provider's default. */
    aiAssistantModel: string;
    /** Whether the MCP (Model Context Protocol) server endpoint is enabled. */
    mcpEnabled: boolean;

    // OCR options
    ocrEnabled: boolean;
    ocrLanguage: string;
    ocrAutoProcessImages: boolean;
    ocrMinConfidence: string;
}

export type OptionNames = keyof OptionDefinitions;

export type FilterOptionsByType<U> = {
    [K in keyof OptionDefinitions]: OptionDefinitions[K] extends U ? K : never;
}[keyof OptionDefinitions];
