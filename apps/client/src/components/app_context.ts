import type { CKTextEditor } from "@triliumnext/ckeditor5";
import type CodeMirror from "@triliumnext/codemirror";
import { SqlExecuteResponse } from "@triliumnext/commons";
import type { NativeImage, TouchBar } from "electron";
import { ColumnComponent } from "tabulator-tables";

import type { Attribute } from "../services/attribute_parser.js";
import froca from "../services/froca.js";
import { initLocale, t } from "../services/i18n.js";
import keyboardActionsService from "../services/keyboard_actions.js";
import linkService, { type ViewScope } from "../services/link.js";
import type LoadResults from "../services/load_results.js";
import type { CreateNoteOpts } from "../services/note_create.js";
import options from "../services/options.js";
import toast from "../services/toast.js";
import utils, { hasTouchBar } from "../services/utils.js";
import { ReactWrappedWidget } from "../widgets/basic_widget.js";
import type RootContainer from "../widgets/containers/root_container.js";
import { AddLinkOpts } from "../widgets/dialogs/add_link.jsx";
import type { ConfirmWithMessageOptions, ConfirmWithTitleOptions } from "../widgets/dialogs/confirm.js";
import type { ResolveOptions } from "../widgets/dialogs/delete_notes.js";
import { IncludeNoteOpts } from "../widgets/dialogs/include_note.jsx";
import type { InfoProps } from "../widgets/dialogs/info.jsx";
import type { MarkdownImportOpts } from "../widgets/dialogs/markdown_import.jsx";
import { ChooseNoteTypeCallback } from "../widgets/dialogs/note_type_chooser.jsx";
import type { PromptDialogOptions } from "../widgets/dialogs/prompt.js";
import type NoteTreeWidget from "../widgets/note_tree.js";
import Component from "./component.js";
import Entrypoints from "./entrypoints.js";
import MainTreeExecutors from "./main_tree_executors.js";
import MobileScreenSwitcherExecutor, { type Screen } from "./mobile_screen_switcher.js";
import type { default as NoteContext, GetTextEditorCallback } from "./note_context.js";
import RootCommandExecutor from "./root_command_executor.js";
import ShortcutComponent from "./shortcut_component.js";
import { StartupChecks } from "./startup_checks.js";
import TabManager from "./tab_manager.js";
import TouchBarComponent from "./touch_bar.js";
import zoomComponent from "./zoom.js";

interface Layout {
    getRootWidget: (appContext: AppContext) => RootContainer;
}

export interface BeforeUploadListener extends Component {
    beforeUnloadEvent(): boolean;
}

/**
 * Base interface for the data/arguments for a given command (see {@link CommandMappings}).
 */
export interface CommandData {
    ntxId?: string | null;
}

/**
 * Represents a set of commands that are triggered from the context menu, providing information such as the selected note.
 */
export interface ContextMenuCommandData extends CommandData {
    node: Fancytree.FancytreeNode;
    notePath?: string;
    noteId?: string;
    selectedOrActiveBranchIds: string[];
    selectedOrActiveNoteIds?: string[];
}

export interface NoteCommandData extends CommandData {
    notePath?: string | null;
    hoistedNoteId?: string | null;
    viewScope?: ViewScope;
}

export interface ExecuteCommandData<T> extends CommandData {
    resolve: (data: T) => void;
}

export interface NoteSwitchedContext {
    noteContext: NoteContext;
    notePath: string | null | undefined;
}

/**
 * The keys represent the different commands that can be triggered via {@link AppContext#triggerCommand} (first argument), and the values represent the data or arguments definition of the given command. All data for commands must extend {@link CommandData}.
 */
export type CommandMappings = {
    "api-log-messages": CommandData;
    focusTree: CommandData;
    focusOnTitle: CommandData;
    focusOnDetail: CommandData;
    searchNotes: CommandData & {
        searchString?: string;
        ancestorNoteId?: string | null;
    };
    closeTocCommand: CommandData;
    closeHlt: CommandData;
    showLaunchBarSubtree: CommandData;
    showHiddenSubtree: CommandData;
    showSQLConsoleHistory: CommandData;
    logout: CommandData;
    switchToMobileVersion: CommandData;
    switchToDesktopVersion: CommandData;
    showRevisions: CommandData & {
        noteId?: string | null;
    };
    showOptions: CommandData & {
        section: string;
    };
    showExportDialog: CommandData & {
        notePath: string;
        defaultType: "single" | "subtree";
    };
    showDeleteNotesDialog: CommandData & {
        branchIdsToDelete: string[];
        callback: (value: ResolveOptions) => void;
        forceDeleteAllClones: boolean;
    };
    showConfirmDeleteNoteBoxWithNoteDialog: ConfirmWithTitleOptions;
    openedFileUpdated: CommandData & {
        entityType: string;
        entityId: string;
        lastModifiedMs?: number;
        filePath: string;
    };
    focusAndSelectTitle: CommandData & {
        isNewNote?: boolean;
    };
    showPromptDialog: PromptDialogOptions;
    showInfoDialog: InfoProps;
    showConfirmDialog: ConfirmWithMessageOptions;
    showRecentChanges: CommandData & { ancestorNoteId: string };
    showImportDialog: CommandData & { noteId: string };
    openNewNoteSplit: NoteCommandData;
    openInWindow: NoteCommandData;
    openInPopup: CommandData & { noteIdOrPath: string; };
    openNoteInNewTab: CommandData;
    openNoteInNewSplit: CommandData;
    openNoteInNewWindow: CommandData;
    openAboutDialog: CommandData;
    hideFloatingButtons: {};
    hideLeftPane: CommandData;
    showCpuArchWarning: CommandData;
    showLeftPane: CommandData;
    showAttachments: CommandData;
    showSearchHistory: CommandData;
    showShareSubtree: CommandData;
    hoistNote: CommandData & { noteId: string };
    leaveProtectedSession: CommandData;
    enterProtectedSession: CommandData;
    noteContextReorder: CommandData & {
        ntxIdsInOrder: string[];
        oldMainNtxId?: string | null;
        newMainNtxId?: string | null;
    };
    openInTab: ContextMenuCommandData;
    openNoteInSplit: ContextMenuCommandData;
    openNoteInWindow: ContextMenuCommandData;
    openNoteInPopup: ContextMenuCommandData;
    toggleNoteHoisting: ContextMenuCommandData;
    insertNoteAfter: ContextMenuCommandData;
    insertChildNote: ContextMenuCommandData;
    delete: ContextMenuCommandData;
    editNoteTitle: {};
    protectSubtree: ContextMenuCommandData;
    unprotectSubtree: ContextMenuCommandData;
    openBulkActionsDialog:
    | ContextMenuCommandData
    | {
        selectedOrActiveNoteIds?: string[];
    };
    editBranchPrefix: ContextMenuCommandData;
    convertNoteToAttachment: ContextMenuCommandData;
    duplicateSubtree: ContextMenuCommandData;
    expandSubtree: ContextMenuCommandData;
    collapseSubtree: ContextMenuCommandData;
    sortChildNotes: ContextMenuCommandData;
    copyNotePathToClipboard: ContextMenuCommandData;
    recentChangesInSubtree: ContextMenuCommandData;
    cutNotesToClipboard: ContextMenuCommandData;
    copyNotesToClipboard: ContextMenuCommandData;
    pasteNotesFromClipboard: ContextMenuCommandData;
    pasteNotesAfterFromClipboard: ContextMenuCommandData;
    moveNotesTo: ContextMenuCommandData;
    cloneNotesTo: ContextMenuCommandData;
    deleteNotes: ContextMenuCommandData;
    importIntoNote: ContextMenuCommandData;
    exportNote: ContextMenuCommandData;
    searchInSubtree: CommandData & { notePath: string; };
    moveNoteUp: ContextMenuCommandData;
    moveNoteDown: ContextMenuCommandData;
    moveNoteUpInHierarchy: ContextMenuCommandData;
    moveNoteDownInHierarchy: ContextMenuCommandData;
    selectAllNotesInParent: ContextMenuCommandData;

    createNoteIntoInbox: CommandData;

    addNoteLauncher: ContextMenuCommandData;
    addScriptLauncher: ContextMenuCommandData;
    addWidgetLauncher: ContextMenuCommandData;
    addSpacerLauncher: ContextMenuCommandData;
    moveLauncherToVisible: ContextMenuCommandData;
    moveLauncherToAvailable: ContextMenuCommandData;
    resetLauncher: ContextMenuCommandData;

    executeInActiveNoteDetailWidget: CommandData & {
        callback: (value: ReactWrappedWidget) => void;
    };
    executeWithTextEditor: CommandData &
    ExecuteCommandData<CKTextEditor> & {
        callback?: GetTextEditorCallback;
    };
    executeWithCodeEditor: CommandData & ExecuteCommandData<CodeMirror>;
    /**
     * Called upon when attempting to retrieve the content element of a {@link NoteContext}.
     * Generally should not be invoked manually, as it is used by {@link NoteContext.getContentElement}.
     */
    executeWithContentElement: CommandData & ExecuteCommandData<JQuery<HTMLElement>>;
    executeWithTypeWidget: CommandData & ExecuteCommandData<ReactWrappedWidget | null>;
    addTextToActiveEditor: CommandData & {
        text: string;
    };
    /** Works only in the electron context menu. */
    replaceMisspelling: CommandData;

    showPasswordNotSet: CommandData;
    showProtectedSessionPasswordDialog: CommandData;
    showUploadAttachmentsDialog: CommandData & { noteId: string };
    showIncludeNoteDialog: CommandData & IncludeNoteOpts;
    showAddLinkDialog: CommandData & AddLinkOpts;
    showPasteMarkdownDialog: CommandData & MarkdownImportOpts;
    closeProtectedSessionPasswordDialog: CommandData;
    copyImageReferenceToClipboard: CommandData;
    copyImageToClipboard: CommandData;
    updateAttributesList: {
        attributes: Attribute[];
    };

    addNewLabel: CommandData;
    addNewRelation: CommandData;
    addNewLabelDefinition: CommandData;
    addNewRelationDefinition: CommandData;

    cloneNoteIdsTo: CommandData & {
        noteIds: string[];
    };
    moveBranchIdsTo: CommandData & {
        branchIds: string[];
    };
    /** Sets the active {@link Screen} (e.g. to toggle the tree sidebar). It triggers the {@link EventMappings.activeScreenChanged} event, but only if the provided <em>screen</em> is different than the current one. */
    setActiveScreen: CommandData & {
        screen: Screen;
    };
    closeTab: CommandData;
    closeToc: CommandData;
    closeOtherTabs: CommandData;
    closeRightTabs: CommandData;
    closeAllTabs: CommandData;
    reopenLastTab: CommandData;
    moveTabToNewWindow: CommandData;
    copyTabToNewWindow: CommandData;
    closeActiveTab: CommandData & {
        $el: JQuery<HTMLElement>;
    };
    setZoomFactorAndSave: {
        zoomFactor: string;
    };

    reEvaluateRightPaneVisibility: CommandData;
    runActiveNote: CommandData;
    scrollContainerTo: CommandData & {
        position: number;
    };
    scrollToEnd: CommandData;
    closeThisNoteSplit: CommandData;
    moveThisNoteSplit: CommandData & { isMovingLeft: boolean };
    jumpToNote: CommandData;
    openTodayNote: CommandData;
    commandPalette: CommandData;

    // Keyboard shortcuts
    backInNoteHistory: CommandData;
    forwardInNoteHistory: CommandData;
    forceSaveRevision: CommandData;
    scrollToActiveNote: CommandData;
    quickSearch: CommandData;
    collapseTree: CommandData;
    createNoteAfter: CommandData;
    createNoteInto: CommandData;
    addNoteAboveToSelection: CommandData;
    addNoteBelowToSelection: CommandData;
    openNewTab: CommandData;
    activateNextTab: CommandData;
    activatePreviousTab: CommandData;
    openNewWindow: CommandData;
    toggleTray: CommandData;
    firstTab: CommandData;
    secondTab: CommandData;
    thirdTab: CommandData;
    fourthTab: CommandData;
    fifthTab: CommandData;
    sixthTab: CommandData;
    seventhTab: CommandData;
    eigthTab: CommandData;
    ninthTab: CommandData;
    lastTab: CommandData;
    showNoteSource: CommandData;
    showSQLConsole: CommandData;
    showBackendLog: CommandData;
    showCheatsheet: CommandData;
    showHelp: CommandData;
    addLinkToText: CommandData;
    followLinkUnderCursor: CommandData;
    insertDateTimeToText: CommandData;
    pasteMarkdownIntoText: CommandData;
    cutIntoNote: CommandData;
    addIncludeNoteToText: CommandData;
    editReadOnlyNote: CommandData;
    toggleRibbonTabClassicEditor: CommandData;
    toggleRibbonTabBasicProperties: CommandData;
    toggleRibbonTabBookProperties: CommandData;
    toggleRibbonTabFileProperties: CommandData;
    toggleRibbonTabImageProperties: CommandData;
    toggleRibbonTabOwnedAttributes: CommandData;
    toggleRibbonTabInheritedAttributes: CommandData;
    toggleRibbonTabPromotedAttributes: CommandData;
    toggleRibbonTabNoteMap: CommandData;
    toggleRibbonTabNoteInfo: CommandData;
    toggleRibbonTabNotePaths: CommandData;
    toggleRibbonTabSimilarNotes: CommandData;
    toggleRightPane: CommandData;
    printActiveNote: CommandData;
    exportAsPdf: CommandData;
    openNoteExternally: CommandData;
    openNoteCustom: CommandData;
    openNoteOnServer: CommandData;
    renderActiveNote: CommandData;
    unhoist: CommandData;
    reloadFrontendApp: CommandData;
    openDevTools: CommandData;
    findInText: CommandData;
    toggleLeftPane: CommandData;
    toggleFullscreen: CommandData;
    zoomOut: CommandData;
    zoomIn: CommandData;
    zoomReset: CommandData;
    copyWithoutFormatting: CommandData;

    // Geomap
    deleteFromMap: { noteId: string };

    toggleZenMode: CommandData;

    updateAttributeList: CommandData & { attributes: Attribute[] };
    saveAttributes: CommandData;
    reloadAttributes: CommandData;
    refreshNoteList: CommandData & { noteId: string };

    refreshResults: {};
    refreshSearchDefinition: {};

    geoMapCreateChildNote: CommandData;

    // Table view
    addNewRow: CommandData & {
        customOpts: CreateNoteOpts;
        parentNotePath?: string;
    };
    addNewTableColumn: CommandData & {
        columnToEdit?: ColumnComponent;
        referenceColumn?: ColumnComponent;
        direction?: "before" | "after";
        type?: "label" | "relation";
    };
    deleteTableColumn: CommandData & {
        columnToDelete?: ColumnComponent;
    };

    buildTouchBar: CommandData & {
        TouchBar: typeof TouchBar;
        buildIcon(name: string): NativeImage;
    };
    refreshTouchBar: CommandData;
    reloadTextEditor: CommandData;
    chooseNoteType: CommandData & {
        callback: ChooseNoteTypeCallback
    };
    customDownload: CommandData;
};

type EventMappings = {
    initialRenderComplete: {};
    frocaReloaded: {};
    setLeftPaneVisibility: {
        leftPaneVisible: boolean | null;
    }
    protectedSessionStarted: {};
    notesReloaded: {
        noteIds: string[];
    };
    refreshIncludedNote: {
        noteId: string;
    };
    apiLogMessages: {
        noteId: string;
        messages: string[];
    };
    entitiesReloaded: {
        loadResults: LoadResults;
    };
    addNewLabel: CommandData;
    addNewRelation: CommandData;
    sqlQueryResults: CommandData & {
        response: SqlExecuteResponse;
    };
    readOnlyTemporarilyDisabled: {
        noteContext: NoteContext;
    };
    /** Triggered when the {@link CommandMappings.setActiveScreen} command is invoked. */
    activeScreenChanged: {
        activeScreen: Screen;
    };
    activeContextChanged: {
        noteContext: NoteContext;
    };
    beforeNoteSwitch: {
        noteContext: NoteContext;
    };
    beforeNoteContextRemove: {
        ntxIds: string[];
    };
    noteSwitched: NoteSwitchedContext;
    noteSwitchedAndActivated: NoteSwitchedContext;
    setNoteContext: {
        noteContext: NoteContext;
    };
    reEvaluateHighlightsListWidgetVisibility: {
        noteId: string | undefined;
    };
    reEvaluateTocWidgetVisibility: {
        noteId: string | undefined;
    };
    showHighlightsListWidget: {
        noteId: string;
    };
    showTocWidget: {
        noteId: string;
    };
    showSearchError: {
        error: string;
    };
    searchRefreshed: { ntxId?: string | null };
    textEditorRefreshed: { ntxId?: string | null, editor: CKTextEditor };
    contentElRefreshed: { ntxId?: string | null, contentEl: HTMLElement };
    hoistedNoteChanged: {
        noteId: string;
        ntxId: string | null;
    };
    contextsReopened: {
        ntxId?: string;
        mainNtxId: string | null;
        tabPosition: number;
        afterNtxId?: string;
    };
    noteDetailRefreshed: {
        ntxId?: string | null;
    };
    noteContextReorder: {
        oldMainNtxId: string;
        newMainNtxId: string;
        ntxIdsInOrder: string[];
    };
    newNoteContextCreated: {
        noteContext: NoteContext;
    };
    noteContextRemoved: {
        ntxIds: string[];
    };
    contextDataChanged: {
        noteContext: NoteContext;
        key: string;
        value: unknown;
    };
    exportSvg: { ntxId: string | null | undefined; };
    exportPng: { ntxId: string | null | undefined; };
    geoMapCreateChildNote: {
        ntxId: string | null | undefined; // TODO: deduplicate ntxId
    };
    tabReorder: {
        ntxIdsInOrder: string[];
    };
    refreshNoteList: {
        noteId: string;
    };
    noteTypeMimeChanged: { noteId: string };
    zenModeChanged: { isEnabled: boolean };
    relationMapCreateChildNote: { ntxId: string | null | undefined };
    relationMapResetPanZoom: { ntxId: string | null | undefined };
    relationMapResetZoomIn: { ntxId: string | null | undefined };
    relationMapResetZoomOut: { ntxId: string | null | undefined };
    activeNoteChanged: {ntxId: string | null | undefined};
    showAddLinkDialog: AddLinkOpts;
    showIncludeDialog: IncludeNoteOpts;
    openBulkActionsDialog: {
        selectedOrActiveNoteIds: string[];
    };
    cloneNoteIdsTo: {
        noteIds: string[];
    };
    refreshData: { ntxId: string | null | undefined };
    contentSafeMarginChanged: {
        top: number;
        noteContext: NoteContext;
    }
};

export type EventListener<T extends EventNames> = {
    [key in T as `${key}Event`]: (data: EventData<T>) => void;
};

export type CommandListener<T extends CommandNames> = {
    [key in T as `${key}Command`]: (data: CommandListenerData<T>) => void;
};

export type CommandListenerData<T extends CommandNames> = CommandMappings[T];

type CommandAndEventMappings = CommandMappings & EventMappings;
type EventOnlyNames = keyof EventMappings;
export type EventNames = CommandNames | EventOnlyNames;
export type EventData<T extends EventNames> = CommandAndEventMappings[T];

/**
 * This type is a discriminated union which contains all the possible commands that can be triggered via {@link AppContext.triggerCommand}.
 */
export type CommandNames = keyof CommandMappings;

type FilterByValueType<T, ValueType> = { [K in keyof T]: T[K] extends ValueType ? K : never }[keyof T];

/**
 * Generic which filters {@link CommandNames} to provide only those commands that take in as data the desired implementation of {@link CommandData}. Mostly useful for contextual menu, to enforce consistency in the commands.
 */
export type FilteredCommandNames<T extends CommandData> = keyof Pick<CommandMappings, FilterByValueType<CommandMappings, T>>;

export class AppContext extends Component {
    isMainWindow: boolean;
    components: Component[];
    beforeUnloadListeners: (WeakRef<BeforeUploadListener> | (() => boolean))[];
    tabManager!: TabManager;
    layout?: Layout;
    noteTreeWidget?: NoteTreeWidget;

    lastSearchString?: string;

    constructor(isMainWindow: boolean) {
        super();

        this.isMainWindow = isMainWindow;
        // non-widget/layout components needed for the application
        this.components = [];
        this.beforeUnloadListeners = [];
    }

    /**
     * Must be called as soon as possible, before the creation of any components since this method is in charge of initializing the locale. Any attempts to read translation before this method is called will result in `undefined`.
     */
    async earlyInit() {
        await options.initializedPromise;
        await initLocale();
    }

    setLayout(layout: Layout) {
        this.layout = layout;
    }

    async start() {
        this.initComponents();
        this.renderWidgets();

        await froca.initializedPromise;

        this.tabManager.loadTabs();

        const bundleService = (await import("../services/bundle.js")).default;
        setTimeout(() => bundleService.executeStartupBundles(), 2000);
    }

    initComponents() {
        this.tabManager = new TabManager();

        this.components = [
            this.tabManager,
            new RootCommandExecutor(),
            new Entrypoints(),
            new MainTreeExecutors(),
            new ShortcutComponent(),
            new StartupChecks()
        ];

        if (utils.isMobile()) {
            this.components.push(new MobileScreenSwitcherExecutor());
        }

        for (const component of this.components) {
            this.child(component);
        }

        if (utils.isElectron()) {
            this.child(zoomComponent);
        }

        if (hasTouchBar) {
            this.child(new TouchBarComponent());
        }
    }

    renderWidgets() {
        if (!this.layout) {
            throw new Error("Missing layout.");
        }

        const rootWidget = this.layout.getRootWidget(this);
        const $renderedWidget = rootWidget.render();

        keyboardActionsService.updateDisplayedShortcuts($renderedWidget);

        $("body").append($renderedWidget);

        $renderedWidget.on("click", "[data-trigger-command]", function () {
            if ($(this).hasClass("disabled")) {
                return;
            }

            const commandName = $(this).attr("data-trigger-command");
            const $component = $(this).closest(".component");
            const component = $component.prop("component");

            component.triggerCommand(commandName, { $el: $(this) });
        });

        this.child(rootWidget as Component);

        this.triggerEvent("initialRenderComplete", {});
    }

    triggerEvent<K extends EventNames>(name: K, data: EventData<K>) {
        return this.handleEvent(name, data);
    }

    triggerCommand<K extends CommandNames>(name: K, _data?: CommandMappings[K]) {
        const data = _data || {};
        for (const executor of this.components) {
            const fun = (executor as any)[`${name}Command`];

            if (fun) {
                return executor.callMethod(fun, data);
            }
        }

        // this might hint at error, but sometimes this is used by components which are at different places
        // in the component tree to communicate with each other
        console.debug(`Unhandled command ${name}, converting to event.`);

        return this.triggerEvent(name, data as CommandAndEventMappings[K]);
    }

    getComponentByEl(el: HTMLElement) {
        return $(el).closest("[data-component-id]").prop("component");
    }

    addBeforeUnloadListener(obj: BeforeUploadListener | (() => boolean)) {
        if (typeof WeakRef !== "function") {
            // older browsers don't support WeakRef
            return;
        }

        if (typeof obj === "object") {
            this.beforeUnloadListeners.push(new WeakRef<BeforeUploadListener>(obj));
        } else {
            this.beforeUnloadListeners.push(obj);
        }
    }

    removeBeforeUnloadListener(listener: (() => boolean)) {
        this.beforeUnloadListeners = this.beforeUnloadListeners.filter(l => l !== listener);
    }
}

const appContext = new AppContext(window.glob.isMainWindow);

// we should save all outstanding changes before the page/app is closed
$(window).on("beforeunload", () => {
    let allSaved = true;

    appContext.beforeUnloadListeners = appContext.beforeUnloadListeners.filter((wr) => typeof wr === "function" || !!wr.deref());

    for (const listener of appContext.beforeUnloadListeners) {
        if (typeof listener === "object") {
            const component = listener.deref();

            if (!component) {
                continue;
            }

            if (!component.beforeUnloadEvent()) {
                console.log(`Component ${component.componentId} is not finished saving its state.`);
                allSaved = false;
            }
        } else if (!listener()) {
            allSaved = false;
        }
    }

    if (!allSaved) {
        toast.showMessage(t("app_context.please_wait_for_save"), 10000);
        return "some string";
    }
});

$(window).on("hashchange", () => {
    const { notePath, ntxId, viewScope, searchString } = linkService.parseNavigationStateFromUrl(window.location.href);

    if (notePath || ntxId) {
        appContext.tabManager.switchToNoteContext(ntxId, notePath, viewScope);
    } else if (searchString) {
        appContext.triggerCommand("searchNotes", { searchString });
    }
});

export default appContext;
