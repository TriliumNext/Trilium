import { type KeyboardShortcutWithRequiredActionName, type OptionMap, type OptionNames, SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";

import appInfo from "./app_info.js";
import dateUtils from "./date_utils.js";
import keyboardActions from "./keyboard_actions.js";
import log from "./log.js";
import optionService from "./options.js";
import { isWindows, randomSecureToken } from "./utils.js";

function initDocumentOptions() {
    optionService.createOption("documentId", randomSecureToken(16), false);
    optionService.createOption("documentSecret", randomSecureToken(16), false);
}

/**
 * Contains additional options to be initialized for a new database, containing the information entered by the user.
 */
interface NotSyncedOpts {
    syncServerHost?: string;
    syncProxy?: string;
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
async function initNotSyncedOptions(initialized: boolean, opts: NotSyncedOpts = {}) {
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
    optionService.createOption("syncServerTimeout", "120000", false);
    optionService.createOption("syncProxy", opts.syncProxy || "", false);
}

/**
 * Contains all the default options that must be initialized on new and existing databases (at startup). The value can also be determined based on other options, provided they have already been initialized.
 */
const defaultOptions: DefaultOption[] = [
    { name: "revisionSnapshotTimeInterval", value: "600", isSynced: true },
    { name: "revisionSnapshotTimeIntervalTimeScale", value: "60", isSynced: true }, // default to Minutes
    { name: "revisionSnapshotNumberLimit", value: "-1", isSynced: true },
    { name: "protectedSessionTimeout", value: "600", isSynced: true },
    { name: "protectedSessionTimeoutTimeScale", value: "60", isSynced: true },
    { name: "zoomFactor", value: isWindows ? "0.9" : "1.0", isSynced: false },
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
    {
        name: "codeNotesMimeTypes",
        value: '["text/x-csrc","text/x-c++src","text/x-csharp","text/css","text/x-elixir","text/x-go","text/x-groovy","text/x-haskell","text/html","message/http","text/x-java","application/javascript;env=frontend","application/javascript;env=backend","application/json","text/x-kotlin","text/x-markdown","text/x-perl","text/x-php","text/x-python","text/x-ruby",null,"text/x-sql","text/x-sqlite;schema=trilium","text/x-swift","text/xml","text/x-yaml","text/x-sh","application/typescript"]',
        isSynced: true
    },
    { name: "leftPaneWidth", value: "25", isSynced: false },
    { name: "leftPaneVisible", value: "true", isSynced: false },
    { name: "rightPaneWidth", value: "25", isSynced: false },
    { name: "rightPaneVisible", value: "true", isSynced: false },
    { name: "rightPaneCollapsedItems", value: "[]", isSynced: false },
    { name: "nativeTitleBarVisible", value: "false", isSynced: false },
    { name: "eraseEntitiesAfterTimeInSeconds", value: "604800", isSynced: true }, // default is 7 days
    { name: "eraseEntitiesAfterTimeScale", value: "86400", isSynced: true }, // default 86400 seconds = Day
    { name: "hideArchivedNotes_main", value: "false", isSynced: false },
    { name: "debugModeEnabled", value: "false", isSynced: false },
    { name: "headingStyle", value: "underline", isSynced: true },
    { name: "autoCollapseNoteTree", value: "true", isSynced: true },
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
    { name: "eraseUnusedAttachmentsAfterSeconds", value: "2592000", isSynced: true }, // default 30 days
    { name: "eraseUnusedAttachmentsAfterTimeScale", value: "86400", isSynced: true }, // default 86400 seconds = Day
    { name: "logRetentionDays", value: "90", isSynced: false }, // default 90 days
    { name: "customSearchEngineName", value: "DuckDuckGo", isSynced: true },
    { name: "customSearchEngineUrl", value: "https://duckduckgo.com/?q={keyword}", isSynced: true },
    { name: "editedNotesOpenInRibbon", value: "true", isSynced: true },
    { name: "mfaEnabled", value: "false", isSynced: false },
    { name: "mfaMethod", value: "totp", isSynced: false },
    { name: "encryptedRecoveryCodes", value: "false", isSynced: false },
    { name: "userSubjectIdentifierSaved", value: "false", isSynced: false },

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
    { name: "codeBlockWordWrap", value: "false", isSynced: true },

    // Text note configuration
    { name: "textNoteEditorType", value: "ckeditor-balloon", isSynced: true },
    { name: "textNoteEditorMultilineToolbar", value: "false", isSynced: true },
    { name: "textNoteEmojiCompletionEnabled", value: "true", isSynced: true },
    { name: "textNoteCompletionEnabled", value: "true", isSynced: true },
    { name: "textNoteSlashCommandsEnabled", value: "true", isSynced: true },

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

    // AI Options
    { name: "aiEnabled", value: "false", isSynced: true },
    { name: "openaiApiKey", value: "", isSynced: false },
    { name: "openaiDefaultModel", value: "", isSynced: true },
    { name: "openaiBaseUrl", value: "https://api.openai.com/v1", isSynced: true },
    { name: "anthropicApiKey", value: "", isSynced: false },
    { name: "anthropicDefaultModel", value: "", isSynced: true },
    { name: "voyageApiKey", value: "", isSynced: false },
    { name: "anthropicBaseUrl", value: "https://api.anthropic.com/v1", isSynced: true },
    { name: "ollamaEnabled", value: "false", isSynced: true },
    { name: "ollamaDefaultModel", value: "", isSynced: true },
    { name: "ollamaBaseUrl", value: "http://localhost:11434", isSynced: true },
    { name: "aiTemperature", value: "0.7", isSynced: true },
    { name: "aiSystemPrompt", value: "", isSynced: true },
    { name: "aiSelectedProvider", value: "openai", isSynced: true },

    {
        name: "seenCallToActions",
        value: JSON.stringify([
            "new_layout", "background_effects", "next_theme"
        ]),
        isSynced: true
    },
    { name: "experimentalFeatures", value: "[]", isSynced: true }
];

/**
 * Initializes the options, by checking which options from {@link #allDefaultOptions()} are missing and registering them. It will also check some environment variables such as safe mode, to make any necessary adjustments.
 *
 * This method is called regardless of whether a new database is created, or an existing database is used.
 */
function initStartupOptions() {
    const optionsMap = optionService.getOptionMap();

    const allDefaultOptions = defaultOptions.concat(getKeyboardDefaultOptions());

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

    if (process.env.TRILIUM_START_NOTE_ID || process.env.TRILIUM_SAFE_MODE) {
        optionService.setOption(
            "openNoteContexts",
            JSON.stringify([
                {
                    notePath: process.env.TRILIUM_START_NOTE_ID || "root",
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

export default {
    initDocumentOptions,
    initNotSyncedOptions,
    initStartupOptions
};
