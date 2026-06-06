

import type { OptionNames } from "@triliumnext/commons";
import type { Request } from "express";

import attributeService from "../../services/attributes.js";
import config from "../../services/config.js";
import { changeLanguage } from "../../services/i18n.js";
import { getLog } from "../../services/log.js";
import optionService from "../../services/options.js";
import searchService from "../../services/search/services/search.js";
import { getSql } from "../../services/sql/index.js";
import { ValidationError } from "../../errors.js";

interface UserTheme {
    val: string; // value of the theme, used in the URL
    title: string; // title of the theme, displayed in the UI
    noteId: string; // ID of the note containing the theme
    icon: string; // icon class of the note
}

// options allowed to be updated directly in the Options dialog
const ALLOWED_OPTIONS = new Set<OptionNames>([
    "eraseEntitiesAfterTimeInSeconds",
    "eraseEntitiesAfterTimeScale",
    "protectedSessionTimeout",
    "protectedSessionTimeoutTimeScale",
    "revisionSnapshotTimeInterval",
    "revisionSnapshotTimeIntervalTimeScale",
    "revisionSnapshotNumberLimit",
    "zoomFactor",
    "theme",
    "codeBlockTheme",
    "codeBlockThemeMatchesApp",
    "codeBlockThemeLight",
    "codeBlockThemeDark",
    "codeBlockWordWrap",
    "codeBlockTabWidth",
    "codeNoteTheme",
    "codeNoteThemeMatchesApp",
    "codeNoteThemeLight",
    "codeNoteThemeDark",
    "codeNoteTabWidth",
    "codeNoteIndentWithTabs",
    "syncServerHost",
    "syncServerTimeout",
    "syncServerTimeoutTimeScale",
    "syncProxy",
    "hoistedNoteId",
    "mainFontSize",
    "mainFontFamily",
    "treeFontSize",
    "treeFontFamily",
    "detailFontSize",
    "detailFontFamily",
    "monospaceFontSize",
    "monospaceFontFamily",
    "openNoteContexts",
    "vimKeymapEnabled",
    "codeLineWrapEnabled",
    "codeNotesMimeTypes",
    "spellCheckEnabled",
    "spellCheckLanguageCode",
    "imageMaxWidthHeight",
    "imageJpegQuality",
    "leftPaneWidth",
    "leftPaneVisible",
    "rightPaneWidth",
    "rightPaneCollapsedItems",
    "rightPaneVisible",
    "nativeTitleBarVisible",
    "headingStyle",
    "autoCollapseNoteTree",
    "autoReadonlySizeText",
    "customDateTimeFormat",
    "autoReadonlySizeCode",
    "overrideThemeFonts",
    "dailyBackupEnabled",
    "weeklyBackupEnabled",
    "monthlyBackupEnabled",
    "motionEnabled",
    "shadowsEnabled",
    "smoothScrollEnabled",
    "backdropEffectsEnabled",
    "maxContentWidth",
    "centerContent",
    "compressImages",
    "downloadImagesAutomatically",
    "minTocHeadings",
    "highlightsList",
    "checkForUpdates",
    "disableTray",
    "eraseUnusedAttachmentsAfterSeconds",
    "eraseUnusedAttachmentsAfterTimeScale",
    "disableTray",
    "customSearchEngineName",
    "customSearchEngineUrl",
    "editedNotesOpenInRibbon",
    "locale",
    "formattingLocale",
    "firstDayOfWeek",
    "firstWeekOfYear",
    "minDaysInFirstWeek",
    "languages",
    "textNoteEditorType",
    "textNoteEditorMultilineToolbar",
    "textNoteEmojiCompletionEnabled",
    "textNoteCompletionEnabled",
    "textNoteSlashCommandsEnabled",
    "mathFieldEnabled",
    "includeNoteDefaultBoxSize",
    "layoutOrientation",
    "backgroundEffects",
    "allowedHtmlTags",
    "searchEnableFuzzyMatching",
    "searchAutocompleteFuzzy",
    "redirectBareDomain",
    "showLoginInShareTheme",
    "splitEditorOrientation",
    "seenCallToActions",
    "experimentalFeatures",
    "newLayout",
    "mfaEnabled",
    "mfaMethod",
    // LLM options
    "llmProviders",
    "mcpEnabled",
    // OCR options
    "ocrAutoProcessImages",
    "ocrMinConfidence"
]);

// Options that contain secrets (API keys, tokens, etc.).
// These can be written by the client but are never sent back in GET responses.
const WRITE_ONLY_OPTIONS = new Set<string>([
    "openaiApiKey",
    "anthropicApiKey"
]);

function getOptions() {
    const optionMap = optionService.getOptionMap();
    const resultMap: Record<string, string> = {};

    for (const optionName in optionMap) {
        if (isReadable(optionName)) {
            resultMap[optionName] = optionMap[optionName as OptionNames];
        }
    }

    resultMap["isPasswordSet"] = optionMap["passwordVerificationHash"] ? "true" : "false";

    // Expose boolean flags for write-only (secret) options so the client
    // knows whether a value has been configured without revealing the value.
    for (const secretOption of WRITE_ONLY_OPTIONS) {
        resultMap[`is${secretOption.charAt(0).toUpperCase()}${secretOption.slice(1)}Set`] =
            optionMap[secretOption] ? "true" : "false";
    }
    // Expose scripting config (read-only, from config.ini / env vars)
    resultMap["backendScriptingEnabled"] = config.Security.backendScriptingEnabled ? "true" : "false";
    resultMap["sqlConsoleEnabled"] = config.Security.sqlConsoleEnabled ? "true" : "false";

    // Detect if the user has any backend scripts with #run labels (backendStartup, hourly, daily).
    // Filter by MIME type since #run can also appear on frontend scripts.
    const hasUserBackendScripts = attributeService.getNotesWithLabel("run")
        .some((note) => note.mime === "application/javascript;env=backend");
    resultMap["hasUserBackendScripts"] = hasUserBackendScripts ? "true" : "false";

    // if database is read-only, disable editing in UI by setting 0 here
    if (config.General.readOnly) {
        resultMap["autoReadonlySizeText"] = "0";
        resultMap["autoReadonlySizeCode"] = "0";
        resultMap["databaseReadonly"] = "true";
    }

    return resultMap;
}

async function updateOption(req: Request<{ name: string; value: string }>) {
    const { name, value } = req.params;

    if (!update(name, value)) {
        throw new ValidationError("not allowed option to change");
    }

    if (name === "locale") {
        await changeLanguage(value);
    }
}

async function updateOptions(req: Request) {
    // The route is registered with asyncApiRoute (no automatic transaction wrapping) because the
    // synchronous sql.transactional() cannot await promises — the transaction would commit at the
    // first await and changeLanguage() would run outside it. Wrap the option-setting loop manually
    // so a failure mid-batch still rolls back earlier options in the same request.
    getSql().transactional(() => {
        for (const optionName in req.body) {
            if (!update(optionName, req.body[optionName])) {
                // this should be improved
                // it should return 400 instead of current 500, but at least it now rollbacks transaction
                throw new Error(`Option '${optionName}' is not allowed to be changed`);
            }
        }
    });

    if ("locale" in req.body) {
        await changeLanguage(req.body["locale"]);
    }
}

function update(name: string, value: string) {
    if (!isAllowed(name)) {
        return false;
    }

    if (name !== "openNoteContexts") {
        const logValue = (WRITE_ONLY_OPTIONS as Set<string>).has(name)
            ? "[redacted]"
            : value;
        getLog().info(`Updating option '${name}' to '${logValue}'`);
    }

    optionService.setOption(name as OptionNames, value);

    return true;
}

function getUserThemes() {
    const notes = searchService.searchNotes("#appTheme", { ignoreHoistedNote: true });
    const ret: UserTheme[] = [];

    for (const note of notes) {
        const title = note.getTitleOrProtected();
        let value = note.getOwnedLabelValue("appTheme");

        if (!value) {
            value = title.toLowerCase().replace(/[^a-z0-9]/gi, "-");
        }

        ret.push({
            val: value,
            title,
            noteId: note.noteId,
            icon: note.getIcon()
        });
    }

    return ret;
}

/** Check if an option can be read by the client (GET responses). */
function isReadable(name: string) {
    return (ALLOWED_OPTIONS as Set<string>).has(name)
        || name.startsWith("keyboardShortcuts")
        || name.endsWith("Collapsed")
        || name.startsWith("hideArchivedNotes");
}

/** Check if an option can be written by the client (PUT requests). */
function isAllowed(name: string) {
    return isReadable(name)
        || (WRITE_ONLY_OPTIONS as Set<string>).has(name);
}

export default {
    getOptions,
    updateOption,
    updateOptions,
    getUserThemes
};
