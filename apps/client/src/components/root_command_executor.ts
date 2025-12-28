import dateNoteService from "../services/date_notes.js";
import froca from "../services/froca.js";
import noteCreateService from "../services/note_create.js";
import openService from "../services/open.js";
import options from "../services/options.js";
import protectedSessionService from "../services/protected_session.js";
import toastService from "../services/toast.js";
import treeService from "../services/tree.js";
import utils, { openInReusableSplit } from "../services/utils.js";
import appContext, { type CommandListenerData } from "./app_context.js";
import Component from "./component.js";

export default class RootCommandExecutor extends Component {
    editReadOnlyNoteCommand() {
        const noteContext = appContext.tabManager.getActiveContext();
        if (noteContext?.viewScope) {
            noteContext.viewScope.readOnlyTemporarilyDisabled = true;
            appContext.triggerEvent("readOnlyTemporarilyDisabled", { noteContext });
        }
    }

    async showSQLConsoleCommand() {
        const sqlConsoleNote = await dateNoteService.createSqlConsole();
        if (!sqlConsoleNote) {
            return;
        }

        const noteContext = await appContext.tabManager.openTabWithNoteWithHoisting(sqlConsoleNote.noteId, { activate: true });

        appContext.triggerEvent("focusOnDetail", { ntxId: noteContext.ntxId });
    }

    async searchNotesCommand({ searchString, ancestorNoteId }: CommandListenerData<"searchNotes">) {
        const searchNote = await dateNoteService.createSearchNote({ searchString, ancestorNoteId });
        if (!searchNote) {
            return;
        }

        // force immediate search
        await froca.loadSearchNote(searchNote.noteId);

        const noteContext = await appContext.tabManager.openTabWithNoteWithHoisting(searchNote.noteId, {
            activate: true
        });
    }

    async searchInSubtreeCommand({ notePath }: CommandListenerData<"searchInSubtree">) {
        const noteId = treeService.getNoteIdFromUrl(notePath);

        this.searchNotesCommand({ ancestorNoteId: noteId });
    }

    openNoteExternallyCommand() {
        const noteId = appContext.tabManager.getActiveContextNoteId();
        const mime = appContext.tabManager.getActiveContextNoteMime();
        if (noteId) {
            openService.openNoteExternally(noteId, mime || "");
        }
    }

    openNoteCustomCommand() {
        const noteId = appContext.tabManager.getActiveContextNoteId();
        const mime = appContext.tabManager.getActiveContextNoteMime();
        if (noteId) {
            openService.openNoteCustom(noteId, mime || "");
        }
    }

    openNoteOnServerCommand() {
        const noteId = appContext.tabManager.getActiveContextNoteId();
        if (noteId) {
            openService.openNoteOnServer(noteId);
        }
    }

    enterProtectedSessionCommand() {
        protectedSessionService.enterProtectedSession();
    }

    leaveProtectedSessionCommand() {
        protectedSessionService.leaveProtectedSession();
    }

    hideLeftPaneCommand() {
        appContext.triggerEvent("setLeftPaneVisibility", { leftPaneVisible: false });
    }

    showLeftPaneCommand() {
        appContext.triggerEvent("setLeftPaneVisibility", { leftPaneVisible: true });
    }

    toggleLeftPaneCommand() {
        appContext.triggerEvent("setLeftPaneVisibility", { leftPaneVisible: null });
    }

    async showBackendLogCommand() {
        await appContext.tabManager.openTabWithNoteWithHoisting("_backendLog", { activate: true });
    }

    async showHelpCommand() {
        await this.showAndHoistSubtree("_help");
    }

    async showLaunchBarSubtreeCommand() {
        const rootNote = utils.isMobile() ? "_lbMobileRoot" : "_lbRoot";
        await this.showAndHoistSubtree(rootNote);
        this.showLeftPaneCommand();
    }

    async showShareSubtreeCommand() {
        await this.showAndHoistSubtree("_share");
    }

    async showHiddenSubtreeCommand() {
        await this.showAndHoistSubtree("_hidden");
    }

    async showOptionsCommand({ section }: CommandListenerData<"showOptions">) {
        await appContext.tabManager.openContextWithNote(section || "_options", {
            activate: true,
            hoistedNoteId: "_options"
        });
    }

    async showSQLConsoleHistoryCommand() {
        await this.showAndHoistSubtree("_sqlConsole");
    }

    async showSearchHistoryCommand() {
        await this.showAndHoistSubtree("_search");
    }

    async showAndHoistSubtree(subtreeNoteId: string) {
        await appContext.tabManager.openContextWithNote(subtreeNoteId, {
            activate: true,
            hoistedNoteId: subtreeNoteId
        });
    }

    async showNoteSourceCommand() {
        const notePath = appContext.tabManager.getActiveContextNotePath();

        if (notePath) {
            await appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                activate: true,
                viewScope: {
                    viewMode: "source"
                }
            });
        }
    }

    async showAttachmentsCommand() {
        const notePath = appContext.tabManager.getActiveContextNotePath();

        if (notePath) {
            await appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                activate: true,
                viewScope: {
                    viewMode: "attachments"
                }
            });
        }
    }

    async showAttachmentDetailCommand() {
        const notePath = appContext.tabManager.getActiveContextNotePath();

        if (notePath) {
            await appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                activate: true,
                viewScope: {
                    viewMode: "attachments"
                }
            });
        }
    }

    toggleTrayCommand() {
        if (!utils.isElectron() || options.is("disableTray")) return;

        const { BrowserWindow } = utils.dynamicRequire("@electron/remote");
        const windows = BrowserWindow.getAllWindows() as Electron.BaseWindow[];
        const isVisible = windows.every((w) => w.isVisible());
        const action = isVisible ? "hide" : "show";
        for (const window of windows) window[action]();
    }

    toggleZenModeCommand() {
        const $body = $("body");
        $body.toggleClass("zen");
        const isEnabled = $body.hasClass("zen");
        appContext.triggerEvent("zenModeChanged", { isEnabled });
    }

    async toggleRibbonTabNoteMapCommand(data: CommandListenerData<"toggleRibbonTabNoteMap">) {
        const { isExperimentalFeatureEnabled } = await import("../services/experimental_features.js");
        const isNewLayout = isExperimentalFeatureEnabled("new-layout");
        if (!isNewLayout) {
            this.triggerEvent("toggleRibbonTabNoteMap", data);
            return;
        }

        const activeContext = appContext.tabManager.getActiveContext();
        if (!activeContext?.notePath) return;
        openInReusableSplit(activeContext.notePath, "note-map");
    }

    firstTabCommand() {
        this.#goToTab(1);
    }
    secondTabCommand() {
        this.#goToTab(2);
    }
    thirdTabCommand() {
        this.#goToTab(3);
    }
    fourthTabCommand() {
        this.#goToTab(4);
    }
    fifthTabCommand() {
        this.#goToTab(5);
    }
    sixthTabCommand() {
        this.#goToTab(6);
    }
    seventhTabCommand() {
        this.#goToTab(7);
    }
    eigthTabCommand() {
        this.#goToTab(8);
    }
    ninthTabCommand() {
        this.#goToTab(9);
    }
    lastTabCommand() {
        this.#goToTab(Number.POSITIVE_INFINITY);
    }

    #goToTab(tabNumber: number) {
        const mainNoteContexts = appContext.tabManager.getMainNoteContexts();

        const index = tabNumber === Number.POSITIVE_INFINITY ? mainNoteContexts.length - 1 : tabNumber - 1;
        const tab = mainNoteContexts[index];

        if (tab) {
            appContext.tabManager.activateNoteContext(tab.ntxId);
        }
    }

    async createAiChatCommand() {
        try {
            // Create a new AI Chat note at the root level
            const rootNoteId = "root";

            const result = await noteCreateService.createNote(rootNoteId, {
                title: "New AI Chat",
                type: "aiChat",
                content: JSON.stringify({
                    messages: [],
                    title: "New AI Chat"
                })
            });

            if (!result.note) {
                toastService.showError("Failed to create AI Chat note");
                return;
            }

            await appContext.tabManager.openTabWithNoteWithHoisting(result.note.noteId, {
                activate: true
            });

            toastService.showMessage("Created new AI Chat note");
        }
        catch (e) {
            console.error("Error creating AI Chat note:", e);
            toastService.showError(`Failed to create AI Chat note: ${(e as Error).message}`);
        }
    }
}
