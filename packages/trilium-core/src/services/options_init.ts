import {
    DEFAULT_TRANSCRIPTION_MODEL,
    type EntityChange,
    type KeyboardShortcutWithRequiredActionName,
    type OptionDefinitions,
    type OptionMap,
    type OptionNames,
    SANITIZER_DEFAULT_ALLOWED_TAGS
} from "@triliumnext/commons";

import becca from "../becca/becca.js";
import appInfo from "./app_info.js";
import { getConfig } from "./config.js";
import { addDeviceRecordEntries } from "./device_records.js";
import entityChangesService from "./entity_changes.js";
import { getPlatform } from "./platform.js";
import { getSql } from "./sql/index.js";
import syncOptions from "./sync_options.js";
import dateUtils from "./utils/date.js";
import keyboardActions from "./keyboard_actions.js";
import { getLog } from "./log.js";
import optionService from "./options.js";
import { isWindows, randomSecureToken } from "./utils/index.js";

export function initDocumentOptions() {
    optionService.createOption("documentId", randomSecureToken(16), false);
    optionService.createOption("documentSecret", randomSecureToken(16), false);
}

/**
 * Contains additional options to be initialized for a new database, containing the information entered by the user.
 */
interface NotSyncedOpts {
    syncServerHost?: string;
    syncProxy?: string;
    syncMaxBlobContentSize?: number;
}

/**
 * Represents a correspondence between an option and its default value, to be initialized when the database is missing that particular option (after a migration from an older version, or when creating a new database).
 */
interface DefaultOption {
    name: OptionNames;
    /**
     * The value to initialize the option with, if the option is not already present in the database.
     *
     * If a function is passed Gin instead, the function is called if the option does not exist (with access to the current options) and the return value is used instead. Useful to migrate a new option with a value depending on some other option that might be initialized.
     */
    value: string | ((options: OptionMap) => string);
    isSynced: boolean;
}

/**
 * Initializes the default options for new databases only.
 *
 * Every option registered here is local-only (hence the name), which is what makes it safe to run on
 * both paths that create a database: a brand-new document, and the empty shell that
 * `sql_init#createDatabaseForSync` fills by syncing an existing document into it. Defaults that must
 * be synced belong in {@link initNewDocumentOptions} instead — see the warning there.
 *
 * @param initialized `true` if the database has been fully initialized (i.e. a new database was created), or `false` if the database is created for sync.
 * @param opts additional options to be initialized, for example the sync configuration.
 */
export async function initNotSyncedOptions(initialized: boolean, opts: NotSyncedOpts = {}) {
    createNotSyncedOption(
        "openNoteContexts",
        JSON.stringify([
            {
                notePath: "root",
                active: true
            }
        ])
    );

    createNotSyncedOption("lastDailyBackupDate", dateUtils.utcNowDateTime());
    createNotSyncedOption("lastWeeklyBackupDate", dateUtils.utcNowDateTime());
    createNotSyncedOption("lastMonthlyBackupDate", dateUtils.utcNowDateTime());
    createNotSyncedOption("dbVersion", appInfo.dbVersion.toString());

    createNotSyncedOption("initialized", initialized ? "true" : "false");

    createNotSyncedOption("lastSyncedPull", "0");
    createNotSyncedOption("lastSyncedPush", "0");

    createNotSyncedOption("theme", "next");

    createNotSyncedOption("syncServerHost", opts.syncServerHost || "");
    createNotSyncedOption("syncServerTimeout", "120"); // 120 seconds (2 minutes)
    createNotSyncedOption("syncProxy", opts.syncProxy || "");
    createNotSyncedOption("syncIncomplete", "false");
    // Per-device blob size limit (bytes) for sync pulls; 0 = disabled. Set to a non-zero value only
    // on memory-constrained clients (mobile), so this is not synced across the cluster.
    createNotSyncedOption("syncMaxBlobContentSize", (opts.syncMaxBlobContentSize ?? 0).toString());
}

/**
 * Initializes the defaults that apply to a brand-new document only and that, unlike
 * {@link initNotSyncedOptions}, do participate in sync. Must therefore be called only when creating a
 * genuinely new document, never when creating a database to sync an existing one into.
 *
 * These cannot live in {@link defaultOptions}, which is also applied to existing databases on every
 * startup: a value there fills in for everyone who does not have the option yet, so it would change
 * the behaviour of upgrading users as well. And they must not live in {@link initNotSyncedOptions},
 * which also runs on the sync-setup path, on an empty database, before the first pull. An option
 * created there carries the current timestamp, so it wins the purely timestamp-based conflict
 * resolution in `sync_update#updateNormalEntity` against the server's older value and is then pushed
 * to the whole cluster — setting up a single fresh client would silently reset the setting
 * everywhere (#10626).
 */
export function initNewDocumentOptions() {
    optionService.createOption("textNoteEditorType", "ckeditor-classic", true);
}

/**
 * Creates a local-only option, i.e. one that is not propagated to the other instances of a sync
 * cluster. Deliberately offers no way to create a synced option, so that the contract of
 * {@link initNotSyncedOptions} cannot be broken by passing the wrong argument.
 */
function createNotSyncedOption<T extends OptionNames>(name: T, value: string | OptionDefinitions[T]) {
    optionService.createOption(name, value, false);
}

/**
 * Migrates a sync timeout value from milliseconds to seconds.
 * Values >= 1000 are assumed to be in milliseconds (since 1000+ seconds = 16+ minutes is unlikely).
 * TimeSelector stores values in seconds; the scale is only used for display.
 *
 * @returns The value in seconds and preferred display scale, or null if no migration is needed.
 */
export function migrateSyncTimeoutFromMilliseconds(milliseconds: number): { value: number; scale: number } | null {
    if (isNaN(milliseconds) || milliseconds < 1000) {
        return null;
    }

    const seconds = Math.round(milliseconds / 1000);

    // Value is always stored in seconds; scale determines display unit
    if (seconds >= 60 && seconds % 60 === 0) {
        return { value: seconds, scale: 60 }; // display as minutes
    }
    return { value: seconds, scale: 1 }; // display as seconds
}

/**
 * Contains all the default options that must be initialized on new and existing databases (at startup). The value can also be determined based on other options, provided they have already been initialized.
 */
const defaultOptions: DefaultOption[] = [
    {
        name: "syncServerTimeoutTimeScale",
        value: (optionsMap) => {
            const timeout = parseInt(optionsMap.syncServerTimeout || "120", 10);
            const migrated = migrateSyncTimeoutFromMilliseconds(timeout);
            if (migrated) {
                optionService.setOption("syncServerTimeout", String(migrated.value));
                getLog().info(`Migrated syncServerTimeout from ${timeout}ms to ${migrated.value}s`);
                return String(migrated.scale);
            }
            return "60"; // default to minutes
        },
        isSynced: false
    },
    { name: "syncMaxBlobContentSize", value: "0", isSynced: false },
    { name: "revisionSnapshotTimeInterval", value: "600", isSynced: true },
    { name: "revisionSnapshotTimeIntervalTimeScale", value: "60", isSynced: true }, // default to Minutes
    { name: "revisionSnapshotNumberLimit", value: "-1", isSynced: true },
    { name: "revisionIgnoreNamedSnapshots", value: "true", isSynced: true },
    { name: "protectedSessionTimeout", value: "600", isSynced: true },
    { name: "protectedSessionTimeoutTimeScale", value: "60", isSynced: true },
    { name: "zoomFactor", value: () => isWindows() ? "0.9" : "1.0", isSynced: false },
    { name: "overrideThemeFonts", value: "false", isSynced: false },
    { name: "mainFontFamily", value: "theme", isSynced: false },
    { name: "mainFontSize", value: "100", isSynced: false },
    { name: "treeFontFamily", value: "theme", isSynced: false },
    { name: "treeFontSize", value: "100", isSynced: false },
    { name: "detailFontFamily", value: "theme", isSynced: false },
    { name: "detailFontSize", value: "110", isSynced: false },
    { name: "monospaceFontFamily", value: "theme", isSynced: false },
    { name: "monospaceFontSize", value: "110", isSynced: false },
    // Off rather than on: the theme default is JetBrains Mono, whose ligatures nobody opted into,
    // and which have been reported as characters being replaced often enough to be worth defaulting
    // away from (#2851, #6224). Not synced, matching the font options it sits with in the UI.
    { name: "monospaceLigaturesEnabled", value: "false", isSynced: false },
    { name: "spellCheckEnabled", value: "true", isSynced: false },
    { name: "spellCheckLanguageCode", value: "en-US", isSynced: false },
    { name: "imageMaxWidthHeight", value: "2000", isSynced: true },
    { name: "imageJpegQuality", value: "75", isSynced: true },
    // What automatic compression does to an arriving image, said out loud rather than left implicit.
    // Scaling and recompressing are what it always did; the PNG answer is not. It used to turn every
    // PNG into a JPEG, which is lossy, permanent, and throws away transparency — the only thing it
    // could do before there was anything else. Optimizing makes a PNG smaller and leaves it a PNG,
    // which is the right default for a step that runs unattended on everything a user pastes.
    // Converting is still there for anyone who wants the space more than the format.
    { name: "imageResize", value: "true", isSynced: true },
    { name: "imageJpegHandling", value: "compress", isSynced: true },
    { name: "imagePngHandling", value: "optimize", isSynced: true },
    { name: "imageConversionQuality", value: "75", isSynced: true },
    { name: "autoFixConsistencyIssues", value: "true", isSynced: false },
    { name: "vimKeymapEnabled", value: "false", isSynced: false },
    { name: "codeLineWrapEnabled", value: "true", isSynced: false },
    { name: "codeLineNumbersEnabled", value: "true", isSynced: false },
    { name: "transcriptCleanupEnabled", value: "true", isSynced: true },
    { name: "transcriptionEnabled", value: "false", isSynced: true },
    { name: "transcriptionModel", value: DEFAULT_TRANSCRIPTION_MODEL, isSynced: false },
    { name: "transcriptionSpeakersEnabled", value: "true", isSynced: true },
    { name: "transcriptionKeepRecordings", value: "false", isSynced: false },
    { name: "codeNoteTabWidth", value: "4", isSynced: true },
    { name: "codeNoteIndentWithTabs", value: "false", isSynced: true },
    {
        name: "codeNotesMimeTypes",
        value: '["text/x-csrc","text/x-c++src","text/x-csharp","text/css","text/x-dockerfile","text/x-go","text/html","text/x-java","text/javascript","application/javascript;env=frontend","application/javascript;env=backend","application/json","text/jsx","text/x-kotlin","text/x-markdown","text/x-php","application/x-powershell","text/x-python","text/x-ruby","text/x-rustsrc",null,"text/x-sql","text/x-sqlite;schema=trilium","text/x-swift","text/xml","text/x-yaml","text/x-sh","application/typescript","text/typescript-jsx"]',
        isSynced: true
    },
    { name: "codeNotesMimeTypesSortAlphabetically", value: "true", isSynced: true },
    { name: "contentManagerSortOrder", value: "title", isSynced: true },
    { name: "contentManagerViewMode", value: "category", isSynced: true },
    { name: "leftPaneWidth", value: "25", isSynced: false },
    { name: "mobileLeftPaneWidth", value: "0", isSynced: false },
    { name: "leftPaneVisible", value: "true", isSynced: false },
    { name: "rightPaneWidth", value: "25", isSynced: false },
    { name: "rightPaneVisible", value: "true", isSynced: false },
    { name: "rightPaneCollapsedItems", value: "[]", isSynced: false },
    { name: "rightPaneSelectedTab", value: "outline", isSynced: false },
    { name: "presentationSidebarVisible", value: "true", isSynced: false },
    // Synced, unlike the rest of the pane's state: which map to read connections as is a preference
    // rather than where a window happens to be left standing.
    { name: "rightPaneNoteMapType", value: "link", isSynced: true },
    { name: "nativeTitleBarVisible", value: "false", isSynced: false },
    { name: "eraseEntitiesAfterTimeInSeconds", value: "604800", isSynced: true }, // default is 7 days
    { name: "eraseEntitiesAfterTimeScale", value: "86400", isSynced: true }, // default 86400 seconds = Day
    { name: "hideArchivedNotes_main", value: "false", isSynced: false },
    { name: "debugModeEnabled", value: "false", isSynced: false },
    { name: "headingStyle", value: "underline", isSynced: true },
    { name: "autoCollapseNoteTree", value: "true", isSynced: true },
    { name: "treeScrollFollowNavigation", value: "true", isSynced: true },
    { name: "treeDensity", value: "relaxed", isSynced: false },
    { name: "autoReadonlySizeText", value: "32000", isSynced: false },
    { name: "autoReadonlySizeCode", value: "64000", isSynced: false },
    { name: "dailyBackupEnabled", value: "true", isSynced: false },
    { name: "weeklyBackupEnabled", value: "true", isSynced: false },
    { name: "monthlyBackupEnabled", value: "true", isSynced: false },
    { name: "customDbBackupDir", value: "", isSynced: false },
    { name: "backupEnableCompression", value: "false", isSynced: false },
    { name: "backupEnableEncryption", value: "false", isSynced: false },
    { name: "maxContentWidth", value: "1200", isSynced: false },
    { name: "centerContent", value: "false", isSynced: false },
    { name: "compressImages", value: "true", isSynced: true },
    { name: "downloadImagesAutomatically", value: "true", isSynced: true },
    { name: "highlightsList", value: '["underline","color","bgColor"]', isSynced: true },
    { name: "checkForUpdates", value: "true", isSynced: true },
    { name: "disableTray", value: "false", isSynced: false },
    { name: "closeToTray", value: "false", isSynced: false },
    { name: "launchOnStartup", value: "false", isSynced: false },
    { name: "hideOnAutoStart", value: "false", isSynced: false },
    { name: "eraseUnusedAttachmentsAfterSeconds", value: "2592000", isSynced: true }, // default 30 days
    { name: "eraseUnusedAttachmentsAfterTimeScale", value: "86400", isSynced: true }, // default 86400 seconds = Day
    { name: "logRetentionDays", value: "90", isSynced: false }, // default 90 days
    { name: "customSearchEngineName", value: "DuckDuckGo", isSynced: true },
    { name: "customSearchEngineUrl", value: "https://duckduckgo.com/?q={keyword}", isSynced: true },

    // Search settings
    { name: "searchEnableFuzzyMatching", value: "true", isSynced: true },
    { name: "searchAutocompleteFuzzy", value: "false", isSynced: true },
    { name: "searchResultsPageSize", value: "20", isSynced: true },

    { name: "editedNotesOpenInRibbon", value: "true", isSynced: true },
    { name: "mfaMethod", value: "totp", isSynced: false },
    { name: "encryptedRecoveryCodes", value: "false", isSynced: false },
    // Declared so that every database holds them as device options, empty as
    // `resetTotpSecret()` leaves them.
    { name: "totpEncryptionSalt", value: "", isSynced: false },
    { name: "totpEncryptedSecret", value: "", isSynced: false },
    { name: "totpVerificationHash", value: "", isSynced: false },
    { name: "totpLastUsedStep", value: "", isSynced: false },
    { name: "recoveryCodeInitialVector", value: "", isSynced: false },
    { name: "recoveryCodeSecurityKey", value: "", isSynced: false },
    { name: "recoveryCodesEncrypted", value: "", isSynced: false },
    { name: "secondFactorState", value: "", isSynced: false },
    { name: "totpWrongCodeCount", value: "", isSynced: false },
    { name: "signInAttemptRecord", value: "", isSynced: false },
    { name: "startupRepairRecord", value: "", isSynced: false },
    { name: "clockAheadMarks", value: "", isSynced: false },

    // Appearance
    { name: "splitEditorOrientation", value: "horizontal", isSynced: true },
    {
        name: "codeNoteTheme",
        value: (optionsMap) => {
            switch (optionsMap.theme) {
                case "light":
                case "next-light":
                    return "default:vs-code-light";
                case "dark":
                case "next-dark":
                default:
                    return "default:vs-code-dark";
            }
        },
        isSynced: false
    },
    { name: "codeNoteThemeMatchesApp", value: "true", isSynced: false },
    { name: "codeNoteThemeLight", value: "default:vs-code-light", isSynced: false },
    { name: "codeNoteThemeDark", value: "default:vs-code-dark", isSynced: false },
    { name: "motionEnabled", value: "true", isSynced: false },
    { name: "shadowsEnabled", value: "true", isSynced: false },
    { name: "backdropEffectsEnabled", value: "true", isSynced: false },
    { name: "smoothScrollEnabled", value: "true", isSynced: false },
    { name: "hardwareAccelerationEnabled", value: "true", isSynced: false },

    // PDF
    { name: "pdfSignatures", value: "{}", isSynced: true },

    // Internationalization
    { name: "locale", value: "en", isSynced: true },
    { name: "formattingLocale", value: "", isSynced: true }, // no value means auto-detect
    // English rather than "" (which would follow the application's language), so that an install
    // that never touches this keeps writing the quotes it wrote before the setting existed. An
    // empty value is still honoured if the user picks the auto entry.
    { name: "defaultContentLanguage", value: "en", isSynced: true },
    { name: "firstDayOfWeek", value: "1", isSynced: true },
    { name: "firstWeekOfYear", value: "0", isSynced: true },
    { name: "minDaysInFirstWeek", value: "4", isSynced: true },
    { name: "languages", value: "[]", isSynced: true },

    // Code block configuration
    {
        name: "codeBlockTheme",
        value: (optionsMap) => {
            if (optionsMap.theme === "light") {
                return "default:stackoverflow-light";
            }
            return "default:stackoverflow-dark";

        },
        isSynced: false
    },
    { name: "codeBlockThemeMatchesApp", value: "true", isSynced: false },
    { name: "codeBlockThemeLight", value: "default:stackoverflow-light", isSynced: false },
    { name: "codeBlockThemeDark", value: "default:stackoverflow-dark", isSynced: false },
    { name: "codeBlockWordWrap", value: "false", isSynced: true },
    { name: "codeBlockTabWidth", value: "4", isSynced: true },

    // Text note configuration
    { name: "textNoteEditorType", value: "ckeditor-balloon", isSynced: true },
    { name: "textNoteEditorMultilineToolbar", value: "false", isSynced: true },
    // The four groups of as-you-type replacements. All on, which is how the editor behaved before
    // they could be turned off; the point of the setting is that the behaviour is now visible and
    // refusable, not that it changes for anyone who leaves it alone.
    // "auto" keeps the marks following the note's language, which is what the editor did before the
    // setting existed. An explicit preset overrides the language entirely — the point of offering
    // it. The two keys are set apart because the conventions disagree about which pair belongs on
    // which: British typography puts the single curly marks where American puts the double ones.
    { name: "textNoteDoubleQuoteStyle", value: "auto", isSynced: true },
    { name: "textNoteSingleQuoteStyle", value: "auto", isSynced: true },
    { name: "textNotePunctuationReplacementsEnabled", value: "true", isSynced: true },
    { name: "textNoteMathReplacementsEnabled", value: "true", isSynced: true },
    { name: "textNoteSymbolReplacementsEnabled", value: "true", isSynced: true },
    { name: "textNoteCustomReplacements", value: "[]", isSynced: true },
    { name: "textNoteEmojiCompletionEnabled", value: "true", isSynced: true },
    { name: "textNoteCompletionEnabled", value: "true", isSynced: true },
    { name: "textNoteCompletionLinkTargetsEnabled", value: "true", isSynced: true },
    { name: "textNoteSlashCommandsEnabled", value: "true", isSynced: true },
    { name: "mathFieldEnabled", value: "true", isSynced: true },
    { name: "textNoteContentHintsEnabled", value: "true", isSynced: true },
    { name: "textNoteScrollRailHighlightsEnabled", value: "true", isSynced: false },
    { name: "textNoteAutoLinkPreviewsEnabled", value: "true", isSynced: true },
    { name: "textNoteLinkTitleRetrievalEnabled", value: "true", isSynced: true },
    { name: "textNoteLinkDetailsRetrievalEnabled", value: "true", isSynced: true },
    { name: "textNoteStickyTableHeadersEnabled", value: "true", isSynced: false },
    // Off: the tags this carries are the ones the editor has no feature for, and GHS's handling of
    // them is worse than their absence. See `textNoteHtmlSupportEnabled` for what turning it off costs.
    { name: "textNoteHtmlSupportEnabled", value: "false", isSynced: true },
    { name: "textNoteVimModeEnabled", value: "false", isSynced: false },
    { name: "textNoteVimModeNoticeShown", value: "false", isSynced: false },
    { name: "textNoteVimInsertKeysEnabled", value: "false", isSynced: true },
    { name: "textNoteVimStartupCommands", value: "", isSynced: true },
    { name: "vimModeHintsEnabled", value: "true", isSynced: true },
    { name: "vimModeHintStripShown", value: "true", isSynced: true },
    { name: "clipboardImageEmbedEnabled", value: "true", isSynced: true },

    // HTML import configuration
    { name: "layoutOrientation", value: "vertical", isSynced: false },
    { name: "noteTitleStyle", value: "large", isSynced: false },
    { name: "backgroundEffects", value: "true", isSynced: false },
    {
        name: "allowedHtmlTags",
        value: JSON.stringify(SANITIZER_DEFAULT_ALLOWED_TAGS),
        isSynced: true
    },

    // Empty rather than a set of defaults: nothing the cleanup tool erases is picked until the user
    // picks it, so an uninitialized setting has to mean "nothing selected".
    { name: "cleanupToolOptions", value: "{}", isSynced: true },

    // Likewise empty: the compression tool fills its dimensions and quality in from the image
    // options, so an uninitialized setting opens on those rather than on a second set of defaults
    // that could disagree with them.
    { name: "imageCompressionToolOptions", value: "{}", isSynced: true },

    // Canvas settings
    { name: "canvasThinStroke", value: "true", isSynced: true },

    // Share settings
    { name: "redirectBareDomain", value: "false", isSynced: true },
    { name: "showLoginInShareTheme", value: "false", isSynced: true },

    {
        name: "seenCallToActions",
        value: JSON.stringify([
            "background_effects", "next_theme"
        ]),
        isSynced: true
    },
    { name: "experimentalFeatures", value: "[]", isSynced: true },
    { name: "notificationDisabledCategories", value: "[]", isSynced: true },

    // AI / LLM
    // Was previously the "llm" experimental feature; inherit the value from there for existing users.
    { name: "aiEnabled", value: (optionsMap) => optionsMap.experimentalFeatures?.includes('"llm"') ? "true" : "false", isSynced: true },
    { name: "llmProviders", value: "[]", isSynced: true },
    { name: "llmWebSearchProvider", value: "", isSynced: true },
    { name: "llmPermissionMode", value: "ask_before_changes", isSynced: true },
    { name: "aiAssistantModel", value: "", isSynced: true },
    { name: "mcpEnabled", value: "false", isSynced: false },

    // OCR options
    { name: "ocrAutoProcessImages", value: "false", isSynced: true },
    { name: "ocrMinConfidence", value: "0.75", isSynced: true },
];

/**
 * The value that a start writes into a device option that a sync peer stored as synced: `default`
 * is the declared default, `keep` the stored value, `block-second-factor` the stored value with
 * the second factor set to `blocked`, and a function computes the value.
 */
type PlantedOptionValue =
    | "default"
    | "keep"
    | "block-second-factor"
    | ((options: OptionMap) => string);

/** Device options whose planted rows a start resets to their default. */
const DEVICE_OPTIONS_TAKING_THEIR_DEFAULT = [
    "syncMaxBlobContentSize", "zoomFactor", "overrideThemeFonts", "mainFontFamily", "mainFontSize",
    "treeFontFamily", "treeFontSize", "detailFontFamily", "detailFontSize", "monospaceFontFamily",
    "monospaceFontSize", "monospaceLigaturesEnabled", "spellCheckEnabled", "spellCheckLanguageCode",
    "autoFixConsistencyIssues", "vimKeymapEnabled", "codeLineWrapEnabled", "codeLineNumbersEnabled",
    "transcriptionModel", "transcriptionKeepRecordings", "leftPaneWidth", "mobileLeftPaneWidth",
    "leftPaneVisible", "rightPaneWidth", "rightPaneVisible", "rightPaneCollapsedItems",
    "rightPaneSelectedTab", "presentationSidebarVisible", "nativeTitleBarVisible",
    "hideArchivedNotes_main", "debugModeEnabled", "treeDensity", "autoReadonlySizeText",
    "autoReadonlySizeCode", "dailyBackupEnabled", "weeklyBackupEnabled", "monthlyBackupEnabled",
    "customDbBackupDir", "backupEnableCompression", "backupEnableEncryption", "maxContentWidth",
    "centerContent", "disableTray", "closeToTray", "launchOnStartup", "hideOnAutoStart",
    "logRetentionDays", "codeNoteTheme", "codeNoteThemeMatchesApp", "codeNoteThemeLight",
    "codeNoteThemeDark", "motionEnabled", "shadowsEnabled", "backdropEffectsEnabled",
    "smoothScrollEnabled", "hardwareAccelerationEnabled",
    "codeBlockTheme", "codeBlockThemeMatchesApp",
    "codeBlockThemeLight", "codeBlockThemeDark", "textNoteScrollRailHighlightsEnabled",
    "textNoteStickyTableHeadersEnabled", "textNoteVimModeEnabled", "textNoteVimModeNoticeShown",
    "layoutOrientation", "noteTitleStyle", "backgroundEffects", "mcpEnabled"
] as const satisfies readonly OptionNames[];

/**
 * The device options, which sync refuses from a peer, each with the value that a start writes into
 * a row that a peer stored as synced. Each new device option needs an entry, which a spec checks,
 * because the default is not always the safe value. Keyboard shortcuts are device options too, and
 * are reset to their default.
 */
const DEVICE_OPTIONS: Record<string, PlantedOptionValue> = {
    // Created with each database, not from `defaultOptions`.
    documentId: "keep",
    documentSecret: "keep",
    dbVersion: "keep",
    initialized: () => "true",
    lastSyncedPull: () => "0",
    lastSyncedPush: () => "0",
    openNoteContexts: () => JSON.stringify([ { notePath: "root", active: true } ]),
    lastDailyBackupDate: () => dateUtils.utcNowDateTime(),
    lastWeeklyBackupDate: () => dateUtils.utcNowDateTime(),
    lastMonthlyBackupDate: () => dateUtils.utcNowDateTime(),
    theme: () => "next",
    syncServerHost: () => "",
    syncServerTimeout: () => "120",
    syncProxy: () => "",
    // A planted `false` would hide that the pulls after it can be missing.
    syncIncomplete: () => "true",
    // Its default function also writes `syncServerTimeout`.
    syncServerTimeoutTimeScale: () => "60",

    // The second factor. The default of `mfaMethod` would turn a configured OpenID login off.
    mfaMethod: getMfaMethodOfTheDevice,
    encryptedRecoveryCodes: (options) => options.recoveryCodesEncrypted ? "true" : "false",
    totpEncryptionSalt: "block-second-factor",
    totpEncryptedSecret: "block-second-factor",
    totpVerificationHash: "block-second-factor",
    recoveryCodeInitialVector: "block-second-factor",
    recoveryCodeSecurityKey: "block-second-factor",
    recoveryCodesEncrypted: "block-second-factor",
    totpLastUsedStep: () => "",

    // Written only by this device: sync refuses them, and migration 243 deleted every row of these
    // names.
    secondFactorState: "keep",
    totpWrongCodeCount: "keep",
    signInAttemptRecord: "keep",
    startupRepairRecord: "keep",
    clockAheadMarks: "keep",

    ...Object.fromEntries(DEVICE_OPTIONS_TAKING_THEIR_DEFAULT.map((name) => [ name, "default" ]))
};

/** Whether the option is a device option, which sync refuses from a peer. */
export function isDeviceOption(name: string): boolean {
    return Object.hasOwn(DEVICE_OPTIONS, name) || name.startsWith("keyboardShortcuts");
}

/**
 * Returns the device option names, for the spec that checks that {@link DEVICE_OPTIONS}
 * is complete.
 */
export function getDeviceOptionNames(): string[] {
    return Object.keys(DEVICE_OPTIONS);
}

/**
 * Initializes the options, by checking which options from {@link #allDefaultOptions()} are missing and registering them. It will also check some environment variables such as safe mode, to make any necessary adjustments.
 *
 * This method is called regardless of whether a new database is created, or an existing database is used.
 */
export function initStartupOptions() {
    const syncServerWasSet = syncOptions.isSyncSetup();
    const repaired = repairPlantedDeviceOptions();

    const optionsMap = optionService.getOptionMap();

    const allDefaultOptions = defaultOptions.concat(getKeyboardDefaultOptions());

    const log = getLog();
    for (const { name, value, isSynced } of allDefaultOptions) {
        if (!(name in optionsMap)) {
            let resolvedValue;
            if (typeof value === "function") {
                resolvedValue = value(optionsMap);
            } else {
                resolvedValue = value;
            }

            // A synced default dated now would overwrite the value of a device that
            // upgraded earlier.
            optionService.createOption(name, resolvedValue, isSynced, isSynced ? EPOCH : undefined);
            log.info(`Created option "${name}" with default value "${resolvedValue}"`);
        }
    }

    writeOptionsNoOwnerSets(repaired, syncServerWasSet);
    queueUnsyncedEntityChanges(repaired);
    addDeviceRecordEntries("startupRepairRecord", repaired);

    if (getPlatform().getEnv("TRILIUM_START_NOTE_ID") || getPlatform().getEnv("TRILIUM_SAFE_MODE")) {
        optionService.setOption(
            "openNoteContexts",
            JSON.stringify([
                {
                    notePath: getPlatform().getEnv("TRILIUM_START_NOTE_ID") || "root",
                    active: true
                }
            ])
        );
    }
}

/** The epoch as a UTC date time, older than every value a user writes. */
const EPOCH = "1970-01-01 00:00:00.000Z";

/**
 * Makes each device option whose row or entity change is marked synced local-only again, since only
 * a sync peer can have written that, and writes the value that {@link DEVICE_OPTIONS} gives it.
 *
 * @returns the names of the repaired options.
 */
function repairPlantedDeviceOptions(): string[] {
    const planted = getSql().getColumn<string>(/*sql*/`
        SELECT options.name
        FROM options
        LEFT JOIN entity_changes
            ON entity_changes.entityName = 'options' AND entity_changes.entityId = options.name
        WHERE options.isSynced = 1 OR entity_changes.isSynced = 1`).filter(isDeviceOption);
    const optionsMap = optionService.getOptionMap();
    const log = getLog();

    for (const name of planted) {
        const option = becca.getOption(name);
        /* v8 ignore next 3 -- becca loads every row of `options` before this runs */
        if (!option) {
            continue;
        }
        option.value = getPlantedOptionValue(name, optionsMap);
        option.isSynced = false;
        option.save();
        log.info(`Made option '${name}' local-only again: a peer had stored it as synced.`);
    }

    if (planted.some((name) => DEVICE_OPTIONS[name] === "block-second-factor")) {
        optionService.setOption("secondFactorState", "blocked");
        log.info("The second factor cannot be checked: a peer had stored a row of it.");
    }

    return planted;
}

function getPlantedOptionValue(name: string, options: OptionMap): string {
    const rule = Object.hasOwn(DEVICE_OPTIONS, name) ? DEVICE_OPTIONS[name] : "default";
    if (typeof rule === "function") {
        return rule(options);
    }

    const declared = rule === "default"
        ? defaultOptions.concat(getKeyboardDefaultOptions()).find((option) => option.name === name)
        : undefined;
    if (!declared) {
        return options[name as OptionNames];
    }
    return typeof declared.value === "function" ? declared.value(options) : declared.value;
}

/** Returns `oauth` when OpenID is configured and an account is enrolled, `totp` otherwise. */
function getMfaMethodOfTheDevice(): string {
    const openId = getConfig().MultiFactorAuthentication;
    const isOpenIdConfigured =
        !!(openId?.oauthBaseUrl && openId.oauthClientId && openId.oauthClientSecret);
    const hasAccount = !!getSql().getValue(/*sql*/`SELECT 1 FROM user_data
        WHERE userIDEncryptedDataKey IS NOT NULL AND userIDEncryptedDataKey != ''`);
    return isOpenIdConfigured && hasAccount ? "oauth" : "totp";
}

/**
 * Writes the device options that no owner sets with the value their readers need, whatever their
 * flags, since a sync peer can have planted them with both flags off.
 *
 * @param repaired the names repaired so far, which this adds to.
 * @param syncServerWasSet whether a sync server was set before the planted options were repaired.
 */
function writeOptionsNoOwnerSets(repaired: string[], syncServerWasSet: boolean) {
    // Every database that has been opened holds `true`.
    const isInitializedRewritten = writeChangedOption("initialized", "true", repaired)
        || repaired.includes("initialized");
    writeChangedOption("autoFixConsistencyIssues", "true", repaired);

    // The consistency checks would take notes that have not arrived yet for damage and push fixes.
    const hasSyncServer = syncOptions.isSyncSetup();
    const isSyncAddressEmptied = syncServerWasSet && !hasSyncServer;
    const isSyncIncompletePlanted = repaired.includes("syncIncomplete");
    if (isSyncAddressEmptied
        || (hasSyncServer && (isSyncIncompletePlanted || isInitializedRewritten))) {
        writeChangedOption("syncIncomplete", "true", repaired);
    } else if (!hasSyncServer && optionService.getOption("lastSyncedPull") === "0") {
        writeChangedOption("syncIncomplete", "false", repaired);
    }
}

/**
 * @returns whether a stored value changed, in which case `repaired` names the option. A missing
 *          option, which a database older than the option lacks, is created and not recorded.
 */
function writeChangedOption(name: "initialized" | "autoFixConsistencyIssues" | "syncIncomplete",
    value: string, repaired: string[]) {
    const current = optionService.getOptionOrNull(name);
    if (current === value) {
        return false;
    }

    optionService.setOption(name, value);
    if (current === null) {
        return false;
    }

    getLog().info(`Wrote option '${name}' as '${value}' at the start.`);
    if (!repaired.includes(name)) {
        repaired.push(name);
    }
    return true;
}

/**
 * Marks synced and queues again each entity change outside `options` that is marked not synced,
 * since only a sync peer can have written that, so that its row reaches every device and the hash
 * check.
 *
 * @param repaired the names repaired so far, which this adds the entity names to.
 */
function queueUnsyncedEntityChanges(repaired: string[]) {
    const entityChanges = getSql().getRows<EntityChange>(/*sql*/`
        SELECT * FROM entity_changes WHERE isSynced = 0 AND entityName != 'options'`);

    for (const entityChange of entityChanges) {
        entityChangesService.putEntityChangeForOtherInstances({ ...entityChange, isSynced: true });
        if (!repaired.includes(entityChange.entityName)) {
            repaired.push(entityChange.entityName);
        }
    }

    if (entityChanges.length > 0) {
        getLog().info(`Queued ${entityChanges.length} entity changes for sync: `
            + "a peer had stored them as not synced.");
    }
}

function getKeyboardDefaultOptions() {
    return (keyboardActions.getDefaultKeyboardActions().filter((ka) => "actionName" in ka) as KeyboardShortcutWithRequiredActionName[]).map((ka) => ({
        name: `keyboardShortcuts${ka.actionName.charAt(0).toUpperCase()}${ka.actionName.slice(1)}`,
        value: JSON.stringify(ka.defaultShortcuts),
        isSynced: false
    })) as DefaultOption[];
}

let syncedFlagByOption: Map<OptionNames, boolean> | null = null;

/**
 * Resolves the declared `isSynced` flag for one of the well-known default options.
 *
 * Returns `undefined` for names that are not part of {@link defaultOptions} (e.g. options created
 * directly in {@link initNotSyncedOptions}/{@link initDocumentOptions}, keyboard shortcuts, or unknown
 * names). Used by `setOption` so that auto-creating a missing default does not silently downgrade a
 * meant-to-be-synced option to local-only, which would otherwise produce an unreconcilable sync hash.
 *
 * The lookup is built lazily on first use to avoid evaluating the (cyclic) options module graph at
 * import time.
 */
export function getDefaultOptionSyncedFlag(name: OptionNames): boolean | undefined {
    if (!syncedFlagByOption) {
        syncedFlagByOption = new Map(defaultOptions.map((option) => [option.name, option.isSynced]));
    }

    return syncedFlagByOption.get(name);
}

