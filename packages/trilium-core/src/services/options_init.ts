import { type KeyboardShortcutWithRequiredActionName, type OptionMap, type OptionNames, SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";

import appInfo from "./app_info.js";
import { getPlatform } from "./platform.js";
import dateUtils from "./utils/date.js";
import keyboardActions from "./keyboard_actions.js";
import { getLog } from "./log.js";
import optionService from "./options.js";
import { isLinux, isWindows, randomSecureToken } from "./utils/index.js";

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
 * @param initialized `true` if the database has been fully initialized (i.e. a new database was created), or `false` if the database is created for sync.
 * @param opts additional options to be initialized, for example the sync configuration.
 */
export async function initNotSyncedOptions(initialized: boolean, opts: NotSyncedOpts = {}) {
    optionService.createOption(
        "openNoteContexts",
        JSON.stringify([
            {
                notePath: "root",
                active: true
            }
        ]),
        false
    );

    optionService.createOption("lastDailyBackupDate", dateUtils.utcNowDateTime(), false);
    optionService.createOption("lastWeeklyBackupDate", dateUtils.utcNowDateTime(), false);
    optionService.createOption("lastMonthlyBackupDate", dateUtils.utcNowDateTime(), false);
    optionService.createOption("dbVersion", appInfo.dbVersion.toString(), false);

    optionService.createOption("initialized", initialized ? "true" : "false", false);

    optionService.createOption("lastSyncedPull", "0", false);
    optionService.createOption("lastSyncedPush", "0", false);

    optionService.createOption("theme", "next", false);
    optionService.createOption("textNoteEditorType", "ckeditor-classic", true);

    optionService.createOption("syncServerHost", opts.syncServerHost || "", false);
    optionService.createOption("syncServerTimeout", "120", false); // 120 seconds (2 minutes)
    optionService.createOption("syncProxy", opts.syncProxy || "", false);
    optionService.createOption("syncIncomplete", "false", false);
    // Per-device blob size limit (bytes) for sync pulls; 0 = disabled. Set to a non-zero value only
    // on memory-constrained clients (mobile), so this is not synced across the cluster.
    optionService.createOption("syncMaxBlobContentSize", (opts.syncMaxBlobContentSize ?? 0).toString(), false);
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
    { name: "spellCheckEnabled", value: "true", isSynced: false },
    { name: "spellCheckLanguageCode", value: "en-US", isSynced: false },
    { name: "imageMaxWidthHeight", value: "2000", isSynced: true },
    { name: "imageJpegQuality", value: "75", isSynced: true },
    { name: "autoFixConsistencyIssues", value: "true", isSynced: false },
    { name: "vimKeymapEnabled", value: "false", isSynced: false },
    { name: "codeLineWrapEnabled", value: "true", isSynced: false },
    { name: "codeNoteTabWidth", value: "4", isSynced: true },
    { name: "codeNoteIndentWithTabs", value: "false", isSynced: true },
    {
        name: "codeNotesMimeTypes",
        value: '["text/x-csrc","text/x-c++src","text/x-csharp","text/css","text/x-elixir","text/x-go","text/x-groovy","text/x-haskell","text/html","message/http","text/x-java","text/javascript","application/javascript;env=frontend","application/javascript;env=backend","application/json","text/x-kotlin","text/x-markdown","text/x-perl","text/x-php","text/x-python","text/x-ruby",null,"text/x-sql","text/x-sqlite;schema=trilium","text/x-swift","text/xml","text/x-yaml","text/x-sh","application/typescript"]',
        isSynced: true
    },
    { name: "leftPaneWidth", value: "25", isSynced: false },
    { name: "leftPaneVisible", value: "true", isSynced: false },
    { name: "rightPaneWidth", value: "25", isSynced: false },
    { name: "rightPaneVisible", value: "true", isSynced: false },
    { name: "rightPaneCollapsedItems", value: "[]", isSynced: false },
    // On Linux a native title bar integrates better with the rest of the system, so default it on there.
    // This only applies to fresh installs — existing databases already have the option set and are left untouched.
    { name: "nativeTitleBarVisible", value: () => isLinux() ? "true" : "false", isSynced: false },
    { name: "eraseEntitiesAfterTimeInSeconds", value: "604800", isSynced: true }, // default is 7 days
    { name: "eraseEntitiesAfterTimeScale", value: "86400", isSynced: true }, // default 86400 seconds = Day
    { name: "hideArchivedNotes_main", value: "false", isSynced: false },
    { name: "debugModeEnabled", value: "false", isSynced: false },
    { name: "headingStyle", value: "underline", isSynced: true },
    { name: "autoCollapseNoteTree", value: "true", isSynced: true },
    { name: "treeScrollFollowNavigation", value: "true", isSynced: true },
    { name: "autoReadonlySizeText", value: "32000", isSynced: false },
    { name: "autoReadonlySizeCode", value: "64000", isSynced: false },
    { name: "dailyBackupEnabled", value: "true", isSynced: false },
    { name: "weeklyBackupEnabled", value: "true", isSynced: false },
    { name: "monthlyBackupEnabled", value: "true", isSynced: false },
    { name: "maxContentWidth", value: "1200", isSynced: false },
    { name: "centerContent", value: "false", isSynced: false },
    { name: "compressImages", value: "true", isSynced: true },
    { name: "downloadImagesAutomatically", value: "true", isSynced: true },
    { name: "minTocHeadings", value: "5", isSynced: true },
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

    { name: "editedNotesOpenInRibbon", value: "true", isSynced: true },
    { name: "mfaMethod", value: "totp", isSynced: false },
    { name: "encryptedRecoveryCodes", value: "false", isSynced: false },

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
    { name: "newLayout", value: "true", isSynced: true },

    // Internationalization
    { name: "locale", value: "en", isSynced: true },
    { name: "formattingLocale", value: "", isSynced: true }, // no value means auto-detect
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
    { name: "textNoteEmojiCompletionEnabled", value: "true", isSynced: true },
    { name: "textNoteCompletionEnabled", value: "true", isSynced: true },
    { name: "textNoteSlashCommandsEnabled", value: "true", isSynced: true },
    { name: "textNoteAutoCapitalizeEnabled", value: "false", isSynced: true },
    { name: "includeNoteDefaultBoxSize", value: "medium", isSynced: true },

    // HTML import configuration
    { name: "layoutOrientation", value: "vertical", isSynced: false },
    { name: "backgroundEffects", value: "true", isSynced: false },
    {
        name: "allowedHtmlTags",
        value: JSON.stringify(SANITIZER_DEFAULT_ALLOWED_TAGS),
        isSynced: true
    },

    // Share settings
    { name: "redirectBareDomain", value: "false", isSynced: true },
    { name: "showLoginInShareTheme", value: "false", isSynced: true },

    {
        name: "seenCallToActions",
        value: JSON.stringify([
            "new_layout", "background_effects", "next_theme"
        ]),
        isSynced: true
    },
    { name: "experimentalFeatures", value: "[]", isSynced: true },

    // AI / LLM
    // Was previously the "llm" experimental feature; inherit the value from there for existing users.
    { name: "aiEnabled", value: (optionsMap) => optionsMap.experimentalFeatures?.includes('"llm"') ? "true" : "false", isSynced: true },
    { name: "llmProviders", value: "[]", isSynced: true },
    { name: "mcpEnabled", value: "false", isSynced: false },

    // OCR options
    { name: "ocrAutoProcessImages", value: "false", isSynced: true },
    { name: "ocrMinConfidence", value: "0.75", isSynced: true },
];

/**
 * Initializes the options, by checking which options from {@link #allDefaultOptions()} are missing and registering them. It will also check some environment variables such as safe mode, to make any necessary adjustments.
 *
 * This method is called regardless of whether a new database is created, or an existing database is used.
 */
export function initStartupOptions() {
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

            optionService.createOption(name, resolvedValue, isSynced);
            log.info(`Created option "${name}" with default value "${resolvedValue}"`);
        }
    }

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

