const enum KeyboardActionNamesEnum {
    backInNoteHistory,
    forwardInNoteHistory,
    jumpToNote,
    commandPalette,
    scrollToActiveNote,
    quickSearch,
    searchInSubtree,
    expandSubtree,
    collapseTree,
    collapseSubtree,
    sortChildNotes,
    createNoteAfter,
    createNoteInto,
    createNoteIntoInbox,
    deleteNotes,
    moveNoteUp,
    moveNoteDown,
    moveNoteUpInHierarchy,
    moveNoteDownInHierarchy,
    editNoteTitle,
    editBranchPrefix,
    cloneNotesTo,
    moveNotesTo,
    copyNotesToClipboard,
    pasteNotesFromClipboard,
    cutNotesToClipboard,
    selectAllNotesInParent,
    addNoteAboveToSelection,
    addNoteBelowToSelection,
    duplicateSubtree,
    openNewTab,
    closeActiveTab,
    reopenLastTab,
    activateNextTab,
    activatePreviousTab,
    openNewWindow,
    openTodayNote,
    toggleTray,
    toggleZenMode,
    firstTab,
    secondTab,
    thirdTab,
    fourthTab,
    fifthTab,
    sixthTab,
    seventhTab,
    eigthTab,
    ninthTab,
    lastTab,
    showNoteSource,
    showOptions,
    showRevisions,
    showRecentChanges,
    showSQLConsole,
    showBackendLog,
    showCheatsheet,
    showHelp,
    addLinkToText,
    followLinkUnderCursor,
    insertDateTimeToText,
    pasteMarkdownIntoText,
    cutIntoNote,
    addIncludeNoteToText,
    editReadOnlyNote,
    addNewLabel,
    addNewRelation,
    toggleRibbonTabClassicEditor,
    toggleRibbonTabBasicProperties,
    toggleRibbonTabBookProperties,
    toggleRibbonTabFileProperties,
    toggleRibbonTabImageProperties,
    toggleRibbonTabOwnedAttributes,
    toggleRibbonTabInheritedAttributes,
    toggleRibbonTabPromotedAttributes,
    toggleRibbonTabNoteMap,
    toggleRibbonTabNoteInfo,
    toggleRibbonTabNotePaths,
    toggleRibbonTabSimilarNotes,
    toggleRightPane,
    printActiveNote,
    exportAsPdf,
    openNoteExternally,
    renderActiveNote,
    runActiveNote,
    toggleNoteHoisting,
    unhoist,
    reloadFrontendApp,
    openDevTools,
    findInText,
    toggleLeftPane,
    toggleFullscreen,
    zoomOut,
    zoomIn,
    zoomReset,
    copyWithoutFormatting,
    forceSaveRevision
}

export type KeyboardActionNames = keyof typeof KeyboardActionNamesEnum;

export interface KeyboardShortcutSeparator {
    separator: string;
}

export interface ActionKeyboardShortcut {
    actionName: KeyboardActionNames;
    friendlyName: string;
    description?: string;
    defaultShortcuts?: string[];
    effectiveShortcuts?: string[];
    /**
     * An icon describing the action.
     * This is currently only used in the command palette.
     */
    iconClass?: string;
    /**
     * Scope here means on which element the keyboard shortcuts are attached - this means that for the shortcut to work,
     * the focus has to be inside the element.
     *
     * So e.g. shortcuts with "note-tree" scope work only when the focus is in note tree.
     * This allows to have the same shortcut have different actions attached based on the context
     * e.g. CTRL-C in note tree does something a bit different from CTRL-C in the text editor.
     */
    scope?: "window" | "note-tree" | "text-detail" | "code-detail";
    /**
     * Whether the action is only available for the desktop application.
     * This is used to hide actions that are not available in the web version.
     */
    isElectronOnly?: boolean;
    /**
     * If set to true, the action will not be shown in the command palette.
     */
    ignoreFromCommandPalette?: boolean;
}

export type KeyboardShortcut = ActionKeyboardShortcut | KeyboardShortcutSeparator;

export interface KeyboardShortcutWithRequiredActionName extends ActionKeyboardShortcut {
    actionName: KeyboardActionNames;
}
