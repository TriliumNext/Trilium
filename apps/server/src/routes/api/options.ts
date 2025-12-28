

import type { OptionNames } from "@triliumnext/commons";
import type { Request } from "express";

import ValidationError from "../../errors/validation_error.js";
import config from "../../services/config.js";
import { changeLanguage, getLocales } from "../../services/i18n.js";
import log from "../../services/log.js";
import optionService from "../../services/options.js";
import searchService from "../../services/search/services/search.js";

interface UserTheme {
    val: string; // value of the theme, used in the URL
    title: string; // title of the theme, displayed in the UI
    noteId: string; // ID of the note containing the theme
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
    "codeBlockWordWrap",
    "codeNoteTheme",
    "syncServerHost",
    "syncServerTimeout",
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
    "layoutOrientation",
    "backgroundEffects",
    "allowedHtmlTags",
    "redirectBareDomain",
    "showLoginInShareTheme",
    "splitEditorOrientation",
    "seenCallToActions",
    "experimentalFeatures",
    "newLayout",

    // AI/LLM integration options
    "aiEnabled",
    "aiTemperature",
    "aiSystemPrompt",
    "aiSelectedProvider",
    "openaiApiKey",
    "openaiBaseUrl",
    "openaiDefaultModel",
    "anthropicApiKey",
    "anthropicBaseUrl",
    "anthropicDefaultModel",
    "ollamaBaseUrl",
    "ollamaDefaultModel",
    "mfaEnabled",
    "mfaMethod"
]);

function getOptions() {
    const optionMap = optionService.getOptionMap();
    const resultMap: Record<string, string> = {};

    for (const optionName in optionMap) {
        if (isAllowed(optionName)) {
            resultMap[optionName] = optionMap[optionName as OptionNames];
        }
    }

    resultMap["isPasswordSet"] = optionMap["passwordVerificationHash"] ? "true" : "false";
    // if database is read-only, disable editing in UI by setting 0 here
    if (config.General.readOnly) {
        resultMap["autoReadonlySizeText"] = "0";
        resultMap["autoReadonlySizeCode"] = "0";
        resultMap["databaseReadonly"] = "true";
    }

    return resultMap;
}

function updateOption(req: Request) {
    const { name, value } = req.params;

    if (!update(name, value)) {
        throw new ValidationError("not allowed option to change");
    }
}

function updateOptions(req: Request) {
    for (const optionName in req.body) {
        if (!update(optionName, req.body[optionName])) {
            // this should be improved
            // it should return 400 instead of current 500, but at least it now rollbacks transaction
            throw new Error(`Option '${optionName}' is not allowed to be changed`);
        }
    }
}

function update(name: string, value: string) {
    if (!isAllowed(name)) {
        return false;
    }

    if (name !== "openNoteContexts") {
        log.info(`Updating option '${name}' to '${value}'`);
    }

    optionService.setOption(name as OptionNames, value);

    if (name === "locale") {
        // This runs asynchronously, so it's not perfect, but it does the trick for now.
        changeLanguage(value);
    }

    return true;
}

function getUserThemes() {
    const notes = searchService.searchNotes("#appTheme", { ignoreHoistedNote: true });
    const ret: UserTheme[] = [];

    for (const note of notes) {
        let value = note.getOwnedLabelValue("appTheme");

        if (!value) {
            value = note.title.toLowerCase().replace(/[^a-z0-9]/gi, "-");
        }

        ret.push({
            val: value,
            title: note.title,
            noteId: note.noteId
        });
    }

    return ret;
}

function getSupportedLocales() {
    return getLocales();
}

function isAllowed(name: string) {
    return (ALLOWED_OPTIONS as Set<string>).has(name)
        || name.startsWith("keyboardShortcuts")
        || name.endsWith("Collapsed")
        || name.startsWith("hideArchivedNotes");
}

export default {
    getOptions,
    updateOption,
    updateOptions,
    getUserThemes,
    getSupportedLocales
};
