import { CreateChildrenResponse, SqlExecuteResponse } from "@triliumnext/commons";

import bundleService from "../services/bundle.js";
import dateNoteService from "../services/date_notes.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import linkService from "../services/link.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import server from "../services/server.js";
import toastService from "../services/toast.js";
import utils from "../services/utils.js";
import ws from "../services/ws.js";
import appContext, { type NoteCommandData } from "./app_context.js";
import Component from "./component.js";

export default class Entrypoints extends Component {
    constructor() {
        super();
    }

    openDevToolsCommand() {
        if (utils.isElectron()) {
            utils.dynamicRequire("@electron/remote").getCurrentWindow().webContents.toggleDevTools();
        }
    }

    async createNoteIntoInboxCommand() {
        const inboxNote = await dateNoteService.getInboxNote();
        if (!inboxNote) {
            console.warn("Missing inbox note.");
            return;
        }

        const { note } = await server.post<CreateChildrenResponse>(`notes/${inboxNote.noteId}/children?target=into`, {
            content: "",
            type: "text",
            isProtected: inboxNote.isProtected && protectedSessionHolder.isProtectedSessionAvailable()
        });

        await ws.waitForMaxKnownEntityChangeId();

        await appContext.tabManager.openTabWithNoteWithHoisting(note.noteId, { activate: true });

        appContext.triggerEvent("focusAndSelectTitle", { isNewNote: true });
    }

    async toggleNoteHoistingCommand({ noteId = appContext.tabManager.getActiveContextNoteId() }) {
        const activeNoteContext = appContext.tabManager.getActiveContext();

        if (!activeNoteContext || !noteId) {
            return;
        }

        const noteToHoist = await froca.getNote(noteId);

        if (noteToHoist?.noteId === activeNoteContext.hoistedNoteId) {
            await activeNoteContext.unhoist();
        } else if (noteToHoist?.type !== "search") {
            await activeNoteContext.setHoistedNoteId(noteId);
        }
    }

    async hoistNoteCommand({ noteId }: { noteId: string }) {
        const noteContext = appContext.tabManager.getActiveContext();

        if (!noteContext) {
            logError("hoistNoteCommand: noteContext is null");
            return;
        }

        if (noteContext.hoistedNoteId !== noteId) {
            await noteContext.setHoistedNoteId(noteId);
        }
    }

    async unhoistCommand() {
        const activeNoteContext = appContext.tabManager.getActiveContext();

        if (activeNoteContext) {
            activeNoteContext.unhoist();
        }
    }

    copyWithoutFormattingCommand() {
        utils.copySelectionToClipboard();
    }

    toggleFullscreenCommand() {
        if (utils.isElectron()) {
            const win = utils.dynamicRequire("@electron/remote").getCurrentWindow();

            if (win.isFullScreenable()) {
                win.setFullScreen(!win.isFullScreen());
            }
        } else {
            document.documentElement.requestFullscreen();
        }
    }

    reloadFrontendAppCommand() {
        utils.reloadFrontendApp();
    }

    async logoutCommand() {
        await server.post("../logout");
        window.location.replace(`/login`);
    }

    backInNoteHistoryCommand() {
        if (utils.isElectron()) {
            // standard JS version does not work completely correctly in electron
            const webContents = utils.dynamicRequire("@electron/remote").getCurrentWebContents();
            const activeIndex = webContents.navigationHistory.getActiveIndex();

            webContents.goToIndex(activeIndex - 1);
        } else {
            window.history.back();
        }
    }

    forwardInNoteHistoryCommand() {
        if (utils.isElectron()) {
            // standard JS version does not work completely correctly in electron
            const webContents = utils.dynamicRequire("@electron/remote").getCurrentWebContents();
            const activeIndex = webContents.navigationHistory.getActiveIndex();

            webContents.goToIndex(activeIndex + 1);
        } else {
            window.history.forward();
        }
    }

    async switchToDesktopVersionCommand() {
        utils.setCookie("trilium-device", "desktop");

        utils.reloadFrontendApp("Switching to desktop version");
    }

    async switchToMobileVersionCommand() {
        utils.setCookie("trilium-device", "mobile");

        utils.reloadFrontendApp("Switching to mobile version");
    }

    async openInWindowCommand({ notePath, hoistedNoteId, viewScope }: NoteCommandData) {
        const extraWindowHash = linkService.calculateHash({ notePath, hoistedNoteId, viewScope });

        if (utils.isElectron()) {
            const { ipcRenderer } = utils.dynamicRequire("electron");

            ipcRenderer.send("create-extra-window", { extraWindowHash });
        } else {
            const url = `${window.location.protocol}//${window.location.host}${window.location.pathname}?extraWindow=1${extraWindowHash}`;

            window.open(url, "", "width=1000,height=800");
        }
    }

    async openNewWindowCommand() {
        this.openInWindowCommand({ notePath: "", hoistedNoteId: "root" });
    }

    async openTodayNoteCommand() {
        const todayNote = await dateNoteService.getTodayNote();
        if (!todayNote) {
            console.warn("Missing today note.");
            return;
        }

        await appContext.tabManager.openInSameTab(todayNote.noteId);
    }

    async runActiveNoteCommand() {
        const noteContext = appContext.tabManager.getActiveContext();
        if (!noteContext) {
            return;
        }
        const { ntxId, note } = noteContext;

        // ctrl+enter is also used elsewhere, so make sure we're running only when appropriate
        if (!note || note.type !== "code") {
            return;
        }

        // TODO: use note.executeScript()
        if (note.mime.endsWith("env=frontend")) {
            await bundleService.getAndExecuteBundle(note.noteId);
        } else if (note.mime.endsWith("env=backend")) {
            await server.post(`script/run/${note.noteId}`);
        } else if (note.mime === "text/x-sqlite;schema=trilium") {
            const response = await server.post<SqlExecuteResponse>(`sql/execute/${note.noteId}`);
            await appContext.triggerEvent("sqlQueryResults", { ntxId, response });
        }

        toastService.showMessage(t("entrypoints.note-executed"));
    }

    hideAllPopups() {
        if (utils.isDesktop()) {
            $(".aa-input").autocomplete("close");
        }
    }

    noteSwitchedEvent() {
        this.hideAllPopups();
    }

    activeContextChangedEvent() {
        this.hideAllPopups();
    }

    async forceSaveRevisionCommand() {
        const noteId = appContext.tabManager.getActiveContextNoteId();

        await server.post(`notes/${noteId}/revision`);

        toastService.showMessage(t("entrypoints.note-revision-created"));
    }
}
