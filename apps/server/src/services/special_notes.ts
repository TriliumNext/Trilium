import attributeService from "./attributes.js";
import dateNoteService from "./date_notes.js";
import becca from "../becca/becca.js";
import noteService from "./notes.js";
import dateUtils from "./date_utils.js";
import log from "./log.js";
import hoistedNoteService from "./hoisted_note.js";
import searchService from "./search/services/search.js";
import SearchContext from "./search/search_context.js";
import { LBTPL_NOTE_LAUNCHER, LBTPL_CUSTOM_WIDGET, LBTPL_SPACER, LBTPL_SCRIPT } from "./hidden_subtree.js";
import { t } from "i18next";
import BNote from '../becca/entities/bnote.js';
import { SaveSearchNoteResponse, SaveSqlConsoleResponse, SaveLlmChatResponse } from "@triliumnext/commons";

function getInboxNote(date: string) {
    const workspaceNote = hoistedNoteService.getWorkspaceNote();
    if (!workspaceNote) {
        throw new Error("Unable to find workspace note");
    }

    let inbox: BNote;

    if (!workspaceNote.isRoot()) {
        inbox = workspaceNote.searchNoteInSubtree("#workspaceInbox");

        if (!inbox) {
            inbox = workspaceNote.searchNoteInSubtree("#inbox");
        }

        if (!inbox) {
            inbox = workspaceNote;
        }
    } else {
        inbox = attributeService.getNoteWithLabel("inbox") || dateNoteService.getDayNote(date);
    }

    return inbox;
}

function createSqlConsole() {
    const { note } = noteService.createNewNote({
        parentNoteId: getMonthlyParentNoteId("_sqlConsole", "sqlConsole"),
        title: "SQL Console - " + dateUtils.localNowDate(),
        content: "SELECT title, isDeleted, isProtected FROM notes WHERE noteId = ''\n\n\n\n",
        type: "code",
        mime: "text/x-sqlite;schema=trilium"
    });

    note.setLabel("iconClass", "bx bx-data");
    note.setLabel("keepCurrentHoisting");

    return note;
}

async function saveSqlConsole(sqlConsoleNoteId: string) {
    const sqlConsoleNote = becca.getNote(sqlConsoleNoteId);
    if (!sqlConsoleNote) throw new Error(`Unable to find SQL console note ID: ${sqlConsoleNoteId}`);
    const today = dateUtils.localNowDate();

    const sqlConsoleHome = attributeService.getNoteWithLabel("sqlConsoleHome") || await dateNoteService.getDayNote(today);

    const result = sqlConsoleNote.cloneTo(sqlConsoleHome.noteId);

    for (const parentBranch of sqlConsoleNote.getParentBranches()) {
        if (parentBranch.parentNote?.hasAncestor("_hidden")) {
            parentBranch.markAsDeleted();
        }
    }

    return result satisfies SaveSqlConsoleResponse;
}

function createSearchNote(searchString: string, ancestorNoteId: string) {
    const { note } = noteService.createNewNote({
        parentNoteId: getMonthlyParentNoteId("_search", "search"),
        title: `${t("special_notes.search_prefix")} ${searchString}`,
        content: "",
        type: "search",
        mime: "application/json"
    });

    note.setLabel("searchString", searchString);
    note.setLabel("keepCurrentHoisting");

    if (ancestorNoteId) {
        note.setRelation("ancestor", ancestorNoteId);
    }

    return note;
}

function getSearchHome() {
    const workspaceNote = hoistedNoteService.getWorkspaceNote();
    if (!workspaceNote) {
        throw new Error("Unable to find workspace note");
    }

    if (!workspaceNote.isRoot()) {
        return workspaceNote.searchNoteInSubtree("#workspaceSearchHome") || workspaceNote.searchNoteInSubtree("#searchHome") || workspaceNote;
    } else {
        const today = dateUtils.localNowDate();

        return workspaceNote.searchNoteInSubtree("#searchHome") || dateNoteService.getDayNote(today);
    }
}

function saveSearchNote(searchNoteId: string) {
    const searchNote = becca.getNote(searchNoteId);
    if (!searchNote) {
        throw new Error("Unable to find search note");
    }

    const searchHome = getSearchHome();

    const result = searchNote.cloneTo(searchHome.noteId);

    for (const parentBranch of searchNote.getParentBranches()) {
        if (parentBranch.parentNote?.hasAncestor("_hidden")) {
            parentBranch.markAsDeleted();
        }
    }

    return result satisfies SaveSearchNoteResponse;
}

function createLlmChat() {
    const { note } = noteService.createNewNote({
        parentNoteId: getMonthlyParentNoteId("_llmChat", "llmChat"),
        title: `${t("special_notes.llm_chat_prefix")} ${dateUtils.localNowDateTime()}`,
        content: JSON.stringify({
            version: 1,
            messages: []
        }),
        type: "llmChat",
        mime: "application/json"
    });

    note.setLabel("iconClass", "bx bx-message-square-dots");
    note.setLabel("keepCurrentHoisting");

    return note;
}

/**
 * Gets the most recently modified LLM chat note.
 * Used by sidebar chat to persist conversation across page refreshes.
 * Returns null if no chat exists.
 */
function getMostRecentLlmChat() {
    // Search for all llmChat notes and return the most recently modified
    const results = searchService.searchNotes(
        "note.type = llmChat",
        new SearchContext({
            ancestorNoteId: "_llmChat",
            limit: 1,
            orderBy: "utcDateModified",
            orderDirection: "desc"
        })
    );

    return results.length > 0 ? results[0] : null;
}

/**
 * Gets the most recent LLM chat or creates a new one if none exists.
 * Used by sidebar chat for persistent conversations.
 */
function getOrCreateLlmChat() {
    const existingChat = getMostRecentLlmChat();

    if (existingChat) {
        return existingChat;
    }

    return createLlmChat();
}

/**
 * Gets a list of recent LLM chat notes.
 * Used by sidebar chat history popup.
 */
function getRecentLlmChats(limit: number = 10) {
    const results = searchService.searchNotes(
        "note.type = llmChat",
        new SearchContext({
            ancestorNoteId: "_llmChat",
            limit,
            orderBy: "utcDateModified",
            orderDirection: "desc"
        })
    );

    return results.map(note => ({
        noteId: note.noteId,
        title: note.title,
        dateModified: note.utcDateModified
    }));
}

function getLlmChatHome() {
    const workspaceNote = hoistedNoteService.getWorkspaceNote();
    if (!workspaceNote) {
        throw new Error("Unable to find workspace note");
    }

    if (!workspaceNote.isRoot()) {
        return workspaceNote.searchNoteInSubtree("#workspaceLlmChatHome") || workspaceNote.searchNoteInSubtree("#llmChatHome") || workspaceNote;
    } else {
        const today = dateUtils.localNowDate();

        return workspaceNote.searchNoteInSubtree("#llmChatHome") || dateNoteService.getDayNote(today);
    }
}

function saveLlmChat(llmChatNoteId: string) {
    const llmChatNote = becca.getNote(llmChatNoteId);
    if (!llmChatNote) {
        throw new Error(`Unable to find LLM chat note ID: ${llmChatNoteId}`);
    }

    const llmChatHome = getLlmChatHome();

    const result = llmChatNote.cloneTo(llmChatHome.noteId);

    for (const parentBranch of llmChatNote.getParentBranches()) {
        if (parentBranch.parentNote?.hasAncestor("_hidden")) {
            parentBranch.markAsDeleted();
        }
    }

    return result satisfies SaveLlmChatResponse;
}

function getMonthlyParentNoteId(rootNoteId: string, prefix: string) {
    const month = dateUtils.localNowDate().substring(0, 7);
    const labelName = `${prefix}MonthNote`;

    let monthNote = searchService.findFirstNoteWithQuery(`#${labelName}="${month}"`, new SearchContext({ ancestorNoteId: rootNoteId }));

    if (!monthNote) {
        monthNote = noteService.createNewNote({
            parentNoteId: rootNoteId,
            title: month,
            content: "",
            isProtected: false,
            type: "book"
        }).note;

        monthNote.addLabel(labelName, month);
    }

    return monthNote.noteId;
}

function createScriptLauncher(parentNoteId: string, forceNoteId?: string) {
    const note = noteService.createNewNote({
        noteId: forceNoteId,
        title: "Script Launcher",
        type: "launcher",
        content: "",
        parentNoteId: parentNoteId
    }).note;

    note.addRelation("template", LBTPL_SCRIPT);
    return note;
}

export type LauncherType = "launcher" | "note" | "script" | "customWidget" | "spacer";

interface LauncherConfig {
    parentNoteId: string;
    launcherType: LauncherType;
    noteId?: string;
}

function createLauncher({ parentNoteId, launcherType, noteId }: LauncherConfig) {
    let note;

    if (launcherType === "note") {
        note = noteService.createNewNote({
            noteId: noteId,
            title: "Note Launcher",
            type: "launcher",
            content: "",
            parentNoteId: parentNoteId
        }).note;

        note.addRelation("template", LBTPL_NOTE_LAUNCHER);
    } else if (launcherType === "script") {
        note = createScriptLauncher(parentNoteId, noteId);
    } else if (launcherType === "customWidget") {
        note = noteService.createNewNote({
            noteId: noteId,
            title: "Widget Launcher",
            type: "launcher",
            content: "",
            parentNoteId: parentNoteId
        }).note;

        note.addRelation("template", LBTPL_CUSTOM_WIDGET);
    } else if (launcherType === "spacer") {
        note = noteService.createNewNote({
            noteId: noteId,
            branchId: noteId,
            title: "Spacer",
            type: "launcher",
            content: "",
            parentNoteId: parentNoteId
        }).note;

        note.addRelation("template", LBTPL_SPACER);
    } else {
        throw new Error(`Unrecognized launcher type '${launcherType}'`);
    }

    return {
        success: true,
        note
    };
}

function resetLauncher(noteId: string) {
    const note = becca.getNote(noteId);

    if (note?.isLaunchBarConfig()) {
        if (note) {
            if (noteId === "_lbRoot" || noteId === "_lbMobileRoot") {
                // deleting hoisted notes are not allowed, so we just reset the children
                for (const childNote of note.getChildNotes()) {
                    childNote.deleteNote();
                }
            } else {
                note.deleteNote();
            }
        } else {
            log.info(`Note ${noteId} has not been found and cannot be reset.`);
        }
    } else {
        log.info(`Note ${noteId} is not a resettable launcher note.`);
    }

    // the re-building deleted launchers will be done in handlers
}

/**
 * This exists to ease transition into the new launchbar, but it's not meant to be a permanent functionality.
 * Previously, the launchbar was fixed and the only way to add buttons was through this API, so a lot of buttons have been
 * created just to fill this user hole.
 *
 * Another use case was for script-packages (e.g. demo Task manager) which could this way register automatically/easily
 * into the launchbar - for this it's recommended to use backend API's createOrUpdateLauncher()
 */
function createOrUpdateScriptLauncherFromApi(opts: { id: string; title: string; action: string; icon?: string; shortcut?: string }) {
    if (opts.id && !/^[a-z0-9]+$/i.test(opts.id)) {
        throw new Error(`Launcher ID can be alphanumeric only, '${opts.id}' given`);
    }

    const launcherId = opts.id || `tb_${opts.title.toLowerCase().replace(/[^[a-z0-9]/gi, "")}`;

    if (!opts.title) {
        throw new Error("Title is mandatory property to create or update a launcher.");
    }

    const launcherNote = becca.getNote(launcherId) || createScriptLauncher("_lbVisibleLaunchers", launcherId);

    launcherNote.title = opts.title;
    launcherNote.setContent(`(${opts.action})()`);
    launcherNote.setLabel("scriptInLauncherContent"); // there's no target note, the script is in the launcher's content
    launcherNote.mime = "application/javascript;env=frontend";
    launcherNote.save();

    if (opts.shortcut) {
        launcherNote.setLabel("keyboardShortcut", opts.shortcut);
    } else {
        launcherNote.removeLabel("keyboardShortcut");
    }

    if (opts.icon) {
        launcherNote.setLabel("iconClass", `bx bx-${opts.icon}`);
    } else {
        launcherNote.removeLabel("iconClass");
    }

    return launcherNote;
}

export default {
    getInboxNote,
    createSqlConsole,
    saveSqlConsole,
    createSearchNote,
    saveSearchNote,
    createLlmChat,
    getMostRecentLlmChat,
    getOrCreateLlmChat,
    getRecentLlmChats,
    saveLlmChat,
    createLauncher,
    resetLauncher,
    createOrUpdateScriptLauncherFromApi
};
