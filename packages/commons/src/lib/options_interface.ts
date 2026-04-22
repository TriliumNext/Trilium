import type { KeyboardActionNames } from "./keyboard_actions_interface.js";

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
    dbVersion: string;
    theme: string;
    syncServerHost: string;
    syncServerTimeout: string;
    syncServerTimeoutTimeScale: number;
    syncProxy: string;
    mainFontFamily: FontFamily;
    treeFontFamily: FontFamily;
    detailFontFamily: FontFamily;
    monospaceFontFamily: FontFamily;
    spellCheckLanguageCode: string;
    codeNotesMimeTypes: string;
    headingStyle: string;
    highlightsList: string;
    customSearchEngineName: string;
    customSearchEngineUrl: string;
    locale: string;
    formattingLocale: string;
    codeBlockTheme: string;
    textNoteEditorType: string;
    layoutOrientation: string;
    allowedHtmlTags: string;
    documentId: string;
    documentSecret: string;
    passwordVerificationHash: string;
    passwordVerificationSalt: string;
    passwordDerivedKeySalt: string;
    encryptedDataKey: string;
    hoistedNoteId: string;
    customDateTimeFormat: string;

    // Multi-Factor Authentication
    mfaEnabled: boolean;
    mfaMethod: string;
    totpEncryptionSalt: string;
    totpEncryptedSecret: string;
    totpVerificationHash: string;
    encryptedRecoveryCodes: boolean;
    userSubjectIdentifierSaved: boolean;
    recoveryCodeInitialVector: string;
    recoveryCodeSecurityKey: string;
    recoveryCodesEncrypted: string;

    lastSyncedPull: number;
    lastSyncedPush: number;
    revisionSnapshotTimeInterval: number;
    revisionSnapshotTimeIntervalTimeScale: number;
    revisionSnapshotNumberLimit: number;
    protectedSessionTimeout: number;
    protectedSessionTimeoutTimeScale: number;
    zoomFactor: number;
    mainFontSize: number;
    treeFontSize: number;
    detailFontSize: number;
    monospaceFontSize: number;
    imageMaxWidthHeight: number;
    imageJpegQuality: number;
    leftPaneWidth: number;
    rightPaneWidth: number;
    rightPaneCollapsedItems: string;
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
    codeNoteTheme: string;

    initialized: boolean;
    databaseReadonly: boolean;
    isPasswordSet: boolean;
    overrideThemeFonts: boolean;
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
    dailyBackupEnabled: boolean;
    weeklyBackupEnabled: boolean;
    monthlyBackupEnabled: boolean;
    compressImages: boolean;
    downloadImagesAutomatically: boolean;
    checkForUpdates: boolean;
    disableTray: boolean;
    editedNotesOpenInRibbon: boolean;
    codeBlockWordWrap: boolean;
    codeBlockTabWidth: number;
    codeNoteTabWidth: number;
    codeNoteIndentWithTabs: boolean;
    textNoteEditorMultilineToolbar: boolean;
    /** Whether keyboard auto-completion for emojis is triggered when typing `:`. */
    textNoteEmojiCompletionEnabled: boolean;
    /** Whether keyboard auto-completion for notes is triggered when typing `@` in text notes (attribute editing is not affected). */
    textNoteCompletionEnabled: boolean;
    /** Whether keyboard auto-completion for editing commands is triggered when typing `/`. */
    textNoteSlashCommandsEnabled: boolean;
    backgroundEffects: boolean;
    newLayout: boolean;

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
    /** JSON array of configured LLM providers with their API keys */
    llmProviders: string;
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
