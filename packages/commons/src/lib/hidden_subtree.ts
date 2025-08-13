type LauncherNoteType = "launcher" | "search" | "doc" | "noteMap" | "contentWidget" | "book" | "file" | "image" | "text" | "relationMap" | "render" | "canvas" | "mermaid" | "webView" | "code" | "mindMap";

enum Command {
    jumpToNote,
    searchNotes,
    createNoteIntoInbox,
    showRecentChanges,
    showOptions,
    createAiChat
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
        | "aiChatLauncher";
    command?: keyof typeof Command;
    /**
     * If set to true, then branches will be enforced to be in the correct place.
     * This is useful for ensuring that the launcher is always in the correct place, even if
     * the user moves it around.
     */
    enforceBranches?: boolean;
}
