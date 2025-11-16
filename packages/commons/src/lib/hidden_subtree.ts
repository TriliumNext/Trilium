type LauncherNoteType = "launcher" | "search" | "doc" | "noteMap" | "contentWidget" | "book" | "file" | "image" | "text" | "relationMap" | "render" | "canvas" | "mermaid" | "webView" | "code" | "mindMap";

enum Command {
    jumpToNote,
    searchNotes,
    createNoteIntoInbox,
    showRecentChanges,
    showOptions,
    createAiChat,
    commandPalette,
    toggleZenMode
}

export interface HiddenSubtreeAttribute {
    type: "label" | "relation";
    name: string;
    isInheritable?: boolean;
    value?: string;
}

export interface HiddenSubtreeItem {
    notePosition?: number;
    id: string;
    title: string;
    type: LauncherNoteType;
    /**
     * The icon to use for this item, in the format "bx-icon-name" (e.g., `bx-file-blank`), *without* the leading `bx `.
     */
    icon?: string;
    attributes?: HiddenSubtreeAttribute[];
    children?: HiddenSubtreeItem[];
    isExpanded?: boolean;
    baseSize?: string;
    growthFactor?: string;
    targetNoteId?: "_backendLog" | "_globalNoteMap";
    builtinWidget?:
        | "todayInJournal"
        | "bookmarks"
        | "spacer"
        | "backInHistoryButton"
        | "forwardInHistoryButton"
        | "syncStatus"
        | "protectedSession"
        | "calendar"
        | "quickSearch"
        | "aiChatLauncher"
        | "commandPalette"
        | "toggleZenMode";
    command?: keyof typeof Command;
    /**
     * If set to true, then branches will be enforced to be in the correct place.
     * This is useful for ensuring that the launcher is always in the correct place, even if
     * the user moves it around.
     */
    enforceBranches?: boolean;
    /**
     * If set to true, then the attributes of this note will be checked. Any owned attribute that does not match the
     * definitions will be removed.
     */
    enforceAttributes?: boolean;
    /**
     * Optionally, a content to be set in the hidden note. If undefined, an empty string will be set instead.
     *
     * The value is also checked at every startup to ensure that it's kept up to date according to the definition.
     */
    content?: string;
}
