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

export interface OptionDefinitions extends KeyboardShortcutsOptions<KeyboardActionNames> {
    openNoteContexts: string;
    lastDailyBackupDate: string;
    lastWeeklyBackupDate: string;
    lastMonthlyBackupDate: string;
    dbVersion: string;
    theme: string;
    syncServerHost: string;
    syncServerTimeout: string;
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
    textNoteEditorMultilineToolbar: boolean;
    /** Whether keyboard auto-completion for emojis is triggered when typing `:`. */
    textNoteEmojiCompletionEnabled: boolean;
    /** Whether keyboard auto-completion for notes is triggered when typing `@` in text notes (attribute editing is not affected). */
    textNoteCompletionEnabled: boolean;
    /** Whether keyboard auto-completion for editing commands is triggered when typing `/`. */
    textNoteSlashCommandsEnabled: boolean;
    backgroundEffects: boolean;
    newLayout: boolean;

    // Share settings
    redirectBareDomain: boolean;
    showLoginInShareTheme: boolean;

    // AI/LLM integration options
    aiEnabled: boolean;
    aiProvider: string;
    aiProviderPrecedence: string; // TODO: Is this still supported?
    aiSystemPrompt: string;
    aiTemperature: string;
    openaiApiKey: string;
    openaiDefaultModel: string;
    openaiBaseUrl: string;
    anthropicApiKey: string;
    anthropicDefaultModel: string;
    voyageApiKey: string;
    anthropicBaseUrl: string;
    ollamaEnabled: boolean;
    ollamaBaseUrl: string;
    ollamaDefaultModel: string;
    codeOpenAiModel: string;
    aiSelectedProvider: string;
    seenCallToActions: string;
    experimentalFeatures: string;
}

export type OptionNames = keyof OptionDefinitions;

export type FilterOptionsByType<U> = {
    [K in keyof OptionDefinitions]: OptionDefinitions[K] extends U ? K : never;
}[keyof OptionDefinitions];
