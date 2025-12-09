import Component from "./component.js";
import SpacedUpdate from "../services/spaced_update.js";
import server from "../services/server.js";
import options from "../services/options.js";
import froca from "../services/froca.js";
import treeService from "../services/tree.js";
import NoteContext from "./note_context.js";
import appContext from "./app_context.js";
import Mutex from "../utils/mutex.js";
import linkService from "../services/link.js";
import type { EventData } from "./app_context.js";
import type FNote from "../entities/fnote.js";

interface TabState {
    contexts: NoteContext[];
    position: number;
}

interface NoteContextState {
    ntxId: string;
    mainNtxId: string | null;
    notePath: string | null;
    hoistedNoteId: string;
    active: boolean;
    viewScope: Record<string, any>;
}

export default class TabManager extends Component {
    public children: NoteContext[];
    public mutex: Mutex;
    public activeNtxId: string | null;
    public recentlyClosedTabs: TabState[];
    public tabsUpdate: SpacedUpdate;

    constructor() {
        super();

        this.children = [];
        this.mutex = new Mutex();
        this.activeNtxId = null;
        this.recentlyClosedTabs = [];

        this.tabsUpdate = new SpacedUpdate(async () => {
            if (!appContext.isMainWindow) {
                return;
            }
            if (options.is("databaseReadonly")) {
                return;
            }

            const openNoteContexts = this.noteContexts
                .map((nc) => nc.getPojoState())
                .filter((t) => !!t);

            await server.put("options", {
                openNoteContexts: JSON.stringify(openNoteContexts)
            });
        });

        appContext.addBeforeUnloadListener(this);
    }

    get noteContexts(): NoteContext[] {
        return this.children;
    }

    get mainNoteContexts(): NoteContext[] {
        return this.noteContexts.filter((nc) => !nc.mainNtxId);
    }

    async loadTabs() {
        try {
            const noteContextsToOpen = (appContext.isMainWindow && options.getJson("openNoteContexts")) || [];

            // preload all notes at once
            await froca.getNotes([...noteContextsToOpen.flatMap((tab: NoteContextState) =>
                [treeService.getNoteIdFromUrl(tab.notePath), tab.hoistedNoteId])], true);

            const filteredNoteContexts = noteContextsToOpen.filter((openTab: NoteContextState) => {
                const noteId = treeService.getNoteIdFromUrl(openTab.notePath);
                if (!noteId || !(noteId in froca.notes)) {
                    // note doesn't exist so don't try to open tab for it
                    return false;
                }

                if (!(openTab.hoistedNoteId in froca.notes)) {
                    openTab.hoistedNoteId = "root";
                }

                return true;
            });

            // resolve before opened tabs can change this
            const parsedFromUrl = linkService.parseNavigationStateFromUrl(window.location.href);

            if (filteredNoteContexts.length === 0) {
                parsedFromUrl.ntxId = parsedFromUrl.ntxId || NoteContext.generateNtxId(); // generate already here, so that we later know which one to activate

                filteredNoteContexts.push({
                    notePath: parsedFromUrl.notePath || "root",
                    ntxId: parsedFromUrl.ntxId,
                    active: true,
                    hoistedNoteId: parsedFromUrl.hoistedNoteId || "root",
                    viewScope: parsedFromUrl.viewScope || {}
                });
            } else if (!filteredNoteContexts.find((tab: NoteContextState) => tab.active)) {
                filteredNoteContexts[0].active = true;
            }

            await this.tabsUpdate.allowUpdateWithoutChange(async () => {
                for (const tab of filteredNoteContexts) {
                    await this.openContextWithNote(tab.notePath, {
                        activate: tab.active,
                        ntxId: tab.ntxId,
                        mainNtxId: tab.mainNtxId,
                        hoistedNoteId: tab.hoistedNoteId,
                        viewScope: tab.viewScope
                    });
                }
            });

            // if there's a notePath in the URL, make sure it's open and active
            // (useful, for e.g., opening clipped notes from clipper or opening link in an extra window)
            if (parsedFromUrl.notePath) {
                await appContext.tabManager.switchToNoteContext(
                    parsedFromUrl.ntxId,
                    parsedFromUrl.notePath,
                    parsedFromUrl.viewScope,
                    parsedFromUrl.hoistedNoteId
                );
            } else if (parsedFromUrl.searchString) {
                await appContext.triggerCommand("searchNotes", {
                    searchString: parsedFromUrl.searchString
                });
            }
        } catch (e: unknown) {
            if (e instanceof Error) {
                logError(`Loading note contexts '${options.get("openNoteContexts")}' failed: ${e.message} ${e.stack}`);
            } else {
                logError(`Loading note contexts '${options.get("openNoteContexts")}' failed: ${String(e)}`);
            }

            // try to recover
            await this.openEmptyTab();
        }
    }

    noteSwitchedEvent({ noteContext }: EventData<"noteSwitched">) {
        if (noteContext.isActive()) {
            this.setCurrentNavigationStateToHash();
        }

        this.tabsUpdate.scheduleUpdate();
    }

    setCurrentNavigationStateToHash() {
        const calculatedHash = this.calculateHash();

        // update if it's the first history entry or there has been a change
        if (window.history.length === 0 || calculatedHash !== window.location?.hash) {
            // using pushState instead of directly modifying document.location because it does not trigger hashchange
            window.history.pushState(null, "", calculatedHash);
        }

        const activeNoteContext = this.getActiveContext();
        this.updateDocumentTitle(activeNoteContext);

        this.triggerEvent("activeNoteChanged", {ntxId:activeNoteContext?.ntxId}); // trigger this even in on popstate event
    }

    calculateHash(): string {
        const activeNoteContext = this.getActiveContext();
        if (!activeNoteContext) {
            return "";
        }

        return linkService.calculateHash({
            notePath: activeNoteContext.notePath,
            ntxId: activeNoteContext.ntxId,
            hoistedNoteId: activeNoteContext.hoistedNoteId,
            viewScope: activeNoteContext.viewScope
        });
    }

    getNoteContexts(): NoteContext[] {
        return this.noteContexts;
    }

    getMainNoteContexts(): NoteContext[] {
        return this.noteContexts.filter((nc) => nc.isMainContext());
    }

    getNoteContextById(ntxId: string | null): NoteContext {
        const noteContext = this.noteContexts.find((nc) => nc.ntxId === ntxId);

        if (!noteContext) {
            throw new Error(`Cannot find noteContext id='${ntxId}'`);
        }

        return noteContext;
    }

    getActiveContext(): NoteContext | null {
        return this.activeNtxId ? this.getNoteContextById(this.activeNtxId) : null;
    }

    getActiveMainContext(): NoteContext | null {
        return this.activeNtxId ? this.getNoteContextById(this.activeNtxId).getMainContext() : null;
    }

    getActiveContextNotePath(): string | null {
        const activeContext = this.getActiveContext();
        return activeContext?.notePath ?? null;
    }

    getActiveContextNote(): FNote | null {
        const activeContext = this.getActiveContext();
        return activeContext ? activeContext.note : null;
    }

    getActiveContextNoteId(): string | null {
        const activeNote = this.getActiveContextNote();
        return activeNote ? activeNote.noteId : null;
    }

    getActiveContextNoteType(): string | null {
        const activeNote = this.getActiveContextNote();
        return activeNote ? activeNote.type : null;
    }

    getActiveContextNoteMime(): string | null {
        const activeNote = this.getActiveContextNote();
        return activeNote ? activeNote.mime : null;
    }

    async switchToNoteContext(
        ntxId: string | null,
        notePath: string,
        viewScope: Record<string, any> = {},
        hoistedNoteId: string | null = null
    ) {
        const noteContext = this.noteContexts.find((nc) => nc.ntxId === ntxId) ||
            await this.openEmptyTab();

        await this.activateNoteContext(noteContext.ntxId);

        if (hoistedNoteId) {
            await noteContext.setHoistedNoteId(hoistedNoteId);
        }

        if (notePath) {
            await noteContext.setNote(notePath, { viewScope });
        }
    }

    async openAndActivateEmptyTab() {
        const noteContext = await this.openEmptyTab();
        await this.activateNoteContext(noteContext.ntxId);
        noteContext.setEmpty();
    }

    async openEmptyTab(
        ntxId: string | null = null,
        hoistedNoteId: string = "root",
        mainNtxId: string | null = null
    ): Promise<NoteContext> {
        const noteContext = new NoteContext(ntxId, hoistedNoteId, mainNtxId);
        noteContext.setEmpty();

        const existingNoteContext = this.children.find((nc) => nc.ntxId === noteContext.ntxId);

        if (existingNoteContext) {
            await existingNoteContext.setHoistedNoteId(hoistedNoteId);
            return existingNoteContext;
        }

        this.child(noteContext);

        await this.triggerEvent("newNoteContextCreated", { noteContext });

        return noteContext;
    }

    async openInNewTab(targetNoteId: string, hoistedNoteId: string | null = null, activate: boolean = false) {
        const noteContext = await this.openEmptyTab(null, hoistedNoteId || this.getActiveContext()?.hoistedNoteId);

        await noteContext.setNote(targetNoteId);

        if (activate && noteContext.notePath) {
            this.activateNoteContext(noteContext.ntxId, false);
            await this.triggerEvent("noteSwitchedAndActivated", {
                noteContext,
                notePath: noteContext.notePath
            });
        }
    }

    async openInSameTab(targetNoteId: string, hoistedNoteId: string | null = null) {
        const activeContext = this.getActiveContext();
        if (!activeContext) return;

        await activeContext.setHoistedNoteId(hoistedNoteId || activeContext.hoistedNoteId);
        await activeContext.setNote(targetNoteId);
    }

    async openTabWithNoteWithHoisting(
        notePath: string,
        opts: {
            activate?: boolean | null;
            ntxId?: string | null;
            mainNtxId?: string | null;
            hoistedNoteId?: string | null;
            viewScope?: Record<string, any> | null;
        } = {}
    ): Promise<NoteContext> {
        const noteContext = this.getActiveContext();
        let hoistedNoteId = "root";

        if (noteContext) {
            const resolvedNotePath = await treeService.resolveNotePath(notePath, noteContext.hoistedNoteId);

            if (resolvedNotePath?.includes(noteContext.hoistedNoteId) || resolvedNotePath?.includes("_hidden")) {
                hoistedNoteId = noteContext.hoistedNoteId;
            }
        }

        opts.hoistedNoteId = hoistedNoteId;

        return this.openContextWithNote(notePath, opts);
    }

    async openContextWithNote(
        notePath: string | null,
        opts: {
            activate?: boolean | null;
            ntxId?: string | null;
            mainNtxId?: string | null;
            hoistedNoteId?: string | null;
            viewScope?: Record<string, any> | null;
        } = {}
    ): Promise<NoteContext> {
        const activate = !!opts.activate;
        const ntxId = opts.ntxId || null;
        const mainNtxId = opts.mainNtxId || null;
        const hoistedNoteId = opts.hoistedNoteId || "root";
        const viewScope = opts.viewScope || { viewMode: "default" };

        const noteContext = await this.openEmptyTab(ntxId, hoistedNoteId, mainNtxId);
        if (notePath) {
            await noteContext.setNote(notePath, {
                // if activate is false, then send normal noteSwitched event
                triggerSwitchEvent: !activate,
                viewScope: viewScope
            });
        }

        if (activate && noteContext.notePath) {
            this.activateNoteContext(noteContext.ntxId, false);

            await this.triggerEvent("noteSwitchedAndActivated", {
                noteContext,
                notePath: noteContext.notePath // resolved note path
            });
        }

        return noteContext;
    }

    async activateOrOpenNote(noteId: string) {
        for (const noteContext of this.getNoteContexts()) {
            if (noteContext.note && noteContext.note.noteId === noteId) {
                this.activateNoteContext(noteContext.ntxId);
                return;
            }
        }

        // if no tab with this note has been found we'll create new tab
        await this.openContextWithNote(noteId, { activate: true });
    }

    async activateNoteContext(ntxId: string | null, triggerEvent: boolean = true) {
        if (!ntxId) {
            logError("activateNoteContext: ntxId is null");
            return;
        }

        if (ntxId === this.activeNtxId) {
            return;
        }

        this.activeNtxId = ntxId;

        if (triggerEvent) {
            await this.triggerEvent("activeContextChanged", {
                noteContext: this.getNoteContextById(ntxId)
            });
        }

        this.tabsUpdate.scheduleUpdate();

        this.setCurrentNavigationStateToHash();
    }

    async removeNoteContext(ntxId: string | null): Promise<boolean> {
        // removing note context is an async process which can take some time, if users presses CTRL-W quickly, two
        // close events could interleave which would then lead to attempting to activate already removed context.
        return await this.mutex.runExclusively(async (): Promise<boolean> => {
            let noteContextToRemove;

            try {
                noteContextToRemove = this.getNoteContextById(ntxId);
            } catch {
                // note context not found
                return false;
            }

            if (noteContextToRemove.isMainContext()) {
                const mainNoteContexts = this.getNoteContexts().filter((nc) => nc.isMainContext());

                if (mainNoteContexts.length === 1) {
                    if (noteContextToRemove.isEmpty()) {
                        // this is already the empty note context, no point in closing it and replacing with another
                        // empty tab
                        return false;
                    }

                    await this.openEmptyTab();
                }
            }

            // close dangling autocompletes after closing the tab
            const $autocompleteEl = $(".aa-input");
            if ("autocomplete" in $autocompleteEl) {
                $autocompleteEl.autocomplete("close");
            }

            // close dangling tooltips
            $("body > div.tooltip").remove();

            const noteContextsToRemove = noteContextToRemove.getSubContexts();
            const ntxIdsToRemove = noteContextsToRemove.map((nc) => nc.ntxId);

            await this.triggerEvent("beforeNoteContextRemove", { ntxIds: ntxIdsToRemove.filter((id) => id !== null) });

            if (!noteContextToRemove.isMainContext()) {
                const siblings = noteContextToRemove.getMainContext().getSubContexts();
                const idx = siblings.findIndex((nc) => nc.ntxId === noteContextToRemove.ntxId);
                const contextToActivateIdx = idx === siblings.length - 1 ? idx - 1 : idx + 1;
                const contextToActivate = siblings[contextToActivateIdx];

                await this.activateNoteContext(contextToActivate.ntxId);
            } else if (this.mainNoteContexts.length <= 1) {
                await this.openAndActivateEmptyTab();
            } else if (ntxIdsToRemove.includes(this.activeNtxId)) {
                const idx = this.mainNoteContexts.findIndex((nc) => nc.ntxId === noteContextToRemove.ntxId);

                if (idx === this.mainNoteContexts.length - 1) {
                    await this.activatePreviousTabCommand();
                } else {
                    await this.activateNextTabCommand();
                }
            }

            this.removeNoteContexts(noteContextsToRemove);
            return true;
        });
    }

    removeNoteContexts(noteContextsToRemove: NoteContext[]) {
        const ntxIdsToRemove = noteContextsToRemove.map((nc) => nc.ntxId);

        const position = this.noteContexts.findIndex((nc) => ntxIdsToRemove.includes(nc.ntxId));

        this.children = this.children.filter((nc) => !ntxIdsToRemove.includes(nc.ntxId));

        this.addToRecentlyClosedTabs(noteContextsToRemove, position);

        this.triggerEvent("noteContextRemoved", { ntxIds: ntxIdsToRemove.filter((id) => id !== null) });

        this.tabsUpdate.scheduleUpdate();
    }

    addToRecentlyClosedTabs(noteContexts: NoteContext[], position: number) {
        if (noteContexts.length === 1 && noteContexts[0].isEmpty()) {
            return;
        }

        this.recentlyClosedTabs.push({ contexts: noteContexts, position: position });
    }

    tabReorderEvent({ ntxIdsInOrder }: { ntxIdsInOrder: string[] }) {
        const order: Record<string, number> = {};

        let i = 0;

        for (const ntxId of ntxIdsInOrder) {
            for (const noteContext of this.getNoteContextById(ntxId).getSubContexts()) {
                if (noteContext.ntxId) {
                    order[noteContext.ntxId] = i++;
                }
            }
        }

        this.children.sort((a, b) => {
            if (!a.ntxId || !b.ntxId) return 0;
            return (order[a.ntxId] ?? 0) < (order[b.ntxId] ?? 0) ? -1 : 1;
        });

        this.tabsUpdate.scheduleUpdate();
    }

    noteContextReorderEvent({
        ntxIdsInOrder,
        oldMainNtxId,
        newMainNtxId
    }: {
        ntxIdsInOrder: string[];
        oldMainNtxId?: string;
        newMainNtxId?: string;
    }) {
        const order = Object.fromEntries(ntxIdsInOrder.map((v, i) => [v, i]));

        this.children.sort((a, b) => {
            if (!a.ntxId || !b.ntxId) return 0;
            return (order[a.ntxId] ?? 0) < (order[b.ntxId] ?? 0) ? -1 : 1;
        });

        if (oldMainNtxId && newMainNtxId) {
            this.children.forEach((c) => {
                if (c.ntxId === newMainNtxId) {
                    // new main context has null mainNtxId
                    c.mainNtxId = null;
                } else if (c.ntxId === oldMainNtxId || c.mainNtxId === oldMainNtxId) {
                    // old main context or subcontexts all have the new mainNtxId
                    c.mainNtxId = newMainNtxId;
                }
            });
        }

        this.tabsUpdate.scheduleUpdate();
    }

    async activateNextTabCommand() {
        const activeMainNtxId = this.getActiveMainContext()?.ntxId;
        if (!activeMainNtxId) return;

        const oldIdx = this.mainNoteContexts.findIndex((nc) => nc.ntxId === activeMainNtxId);
        const newActiveNtxId = this.mainNoteContexts[oldIdx === this.mainNoteContexts.length - 1 ? 0 : oldIdx + 1].ntxId;

        await this.activateNoteContext(newActiveNtxId);
    }

    async activatePreviousTabCommand() {
        const activeMainNtxId = this.getActiveMainContext()?.ntxId;
        if (!activeMainNtxId) return;

        const oldIdx = this.mainNoteContexts.findIndex((nc) => nc.ntxId === activeMainNtxId);
        const newActiveNtxId = this.mainNoteContexts[oldIdx === 0 ? this.mainNoteContexts.length - 1 : oldIdx - 1].ntxId;

        await this.activateNoteContext(newActiveNtxId);
    }

    async closeActiveTabCommand() {
        await this.removeNoteContext(this.activeNtxId);
    }

    beforeUnloadEvent(): boolean {
        this.tabsUpdate.updateNowIfNecessary();
        return true; // don't block closing the tab, this metadata is not that important
    }

    openNewTabCommand() {
        this.openAndActivateEmptyTab();
    }

    async closeAllTabsCommand() {
        for (const ntxIdToRemove of this.mainNoteContexts.map((nc) => nc.ntxId)) {
            await this.removeNoteContext(ntxIdToRemove);
        }
    }

    async closeOtherTabsCommand({ ntxId }: { ntxId: string }) {
        for (const ntxIdToRemove of this.mainNoteContexts.map((nc) => nc.ntxId)) {
            if (ntxIdToRemove !== ntxId) {
                await this.removeNoteContext(ntxIdToRemove);
            }
        }
    }

    async closeRightTabsCommand({ ntxId }: { ntxId: string }) {
        const ntxIds = this.mainNoteContexts.map((nc) => nc.ntxId);
        const index = ntxIds.indexOf(ntxId);

        if (index !== -1) {
            const idsToRemove = ntxIds.slice(index + 1);
            for (const ntxIdToRemove of idsToRemove) {
                await this.removeNoteContext(ntxIdToRemove);
            }
        }
    }

    async closeTabCommand({ ntxId }: { ntxId: string }) {
        await this.removeNoteContext(ntxId);
    }

    async moveTabToNewWindowCommand({ ntxId }: { ntxId: string }) {
        const { notePath, hoistedNoteId, viewScope } = this.getNoteContextById(ntxId);

        const removed = await this.removeNoteContext(ntxId);

        if (removed) {
            this.triggerCommand("openInWindow", { notePath, hoistedNoteId, viewScope });
        }
    }

    async copyTabToNewWindowCommand({ ntxId }: { ntxId: string }) {
        const { notePath, hoistedNoteId, viewScope } = this.getNoteContextById(ntxId);
        this.triggerCommand("openInWindow", { notePath, hoistedNoteId, viewScope });
    }

    async reopenLastTabCommand() {
        const closeLastEmptyTab: NoteContext | undefined = await this.mutex.runExclusively(async () => {
            let closeLastEmptyTab
            if (this.recentlyClosedTabs.length === 0) {
                return closeLastEmptyTab;
            }

            if (this.noteContexts.length === 1 && this.noteContexts[0].isEmpty()) {
                // new empty tab is created after closing the last tab, this reverses the empty tab creation
                closeLastEmptyTab = this.noteContexts[0];
            }

            const lastClosedTab = this.recentlyClosedTabs.pop();
            if (!lastClosedTab) return closeLastEmptyTab;

            const noteContexts = lastClosedTab.contexts;

            for (const noteContext of noteContexts) {
                this.child(noteContext);

                await this.triggerEvent("newNoteContextCreated", { noteContext });
            }

            //  restore last position of contexts stored in tab manager
            const ntxsInOrder = [
                ...this.noteContexts.slice(0, lastClosedTab.position),
                ...this.noteContexts.slice(-noteContexts.length),
                ...this.noteContexts.slice(lastClosedTab.position, -noteContexts.length)
            ];

            // Update mainNtxId if the restored pane is the main pane in the split pane
            const { oldMainNtxId, newMainNtxId } = (() => {
                if (noteContexts.length !== 1) {
                    return { oldMainNtxId: undefined, newMainNtxId: undefined };
                }

                const mainNtxId = noteContexts[0]?.mainNtxId;
                const index = this.noteContexts.findIndex(c => c.ntxId === mainNtxId);

                // No need to update if the restored position is after mainNtxId
                if (index === -1 || lastClosedTab.position > index) {
                    return { oldMainNtxId: undefined, newMainNtxId: undefined };
                }

                return {
                    oldMainNtxId: this.noteContexts[index].ntxId ?? undefined,
                    newMainNtxId: noteContexts[0]?.ntxId ?? undefined
                };
            })();

            this.triggerCommand("noteContextReorder", {
                ntxIdsInOrder: ntxsInOrder.map((nc) => nc.ntxId).filter((id) => id !== null),
                oldMainNtxId,
                newMainNtxId
            });

            let mainNtx = noteContexts.find((nc) => nc.isMainContext());
            if (mainNtx) {
                // reopened a tab, need to reorder new tab widget in tab row
                await this.triggerEvent("contextsReopened", {
                    mainNtxId: mainNtx.ntxId,
                    tabPosition: ntxsInOrder.filter((nc) => nc.isMainContext()).findIndex((nc) => nc.ntxId === mainNtx.ntxId)
                });
            } else {
                // reopened a single split, need to reorder the pane widget in split note container
                await this.triggerEvent("contextsReopened", {
                    mainNtxId: ntxsInOrder[lastClosedTab.position].ntxId,
                    // this is safe since lastClosedTab.position can never be 0 in this case
                    tabPosition: lastClosedTab.position - 1
                });
            }

            const noteContextToActivate = noteContexts.length === 1 ? noteContexts[0] : noteContexts.find((nc) => nc.isMainContext());
            if (!noteContextToActivate) return closeLastEmptyTab;

            await this.activateNoteContext(noteContextToActivate.ntxId);

            await this.triggerEvent("noteSwitched", {
                noteContext: noteContextToActivate,
                notePath: noteContextToActivate.notePath
            });
            return closeLastEmptyTab;
        });

        if (closeLastEmptyTab) {
            await this.removeNoteContext(closeLastEmptyTab.ntxId);
        }
    }

    hoistedNoteChangedEvent() {
        this.tabsUpdate.scheduleUpdate();
    }

    async updateDocumentTitle(activeNoteContext: NoteContext | null) {
        if (!activeNoteContext) return;

        const titleFragments = [
            // it helps to navigate in history if note title is included in the title
            await activeNoteContext.getNavigationTitle(),
            "Trilium Notes"
        ].filter(Boolean);

        document.title = titleFragments.join(" - ");
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        const activeContext = this.getActiveContext();

        if (activeContext && loadResults.isNoteReloaded(activeContext.noteId)) {
            await this.updateDocumentTitle(activeContext);
        }
    }

    async frocaReloadedEvent() {
        const activeContext = this.getActiveContext();
        if (activeContext) {
            await this.updateDocumentTitle(activeContext);
        }
    }
}
