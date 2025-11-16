import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { t } from "i18next";

export default function buildLaunchBarConfig() {
    const sharedLaunchers: Record<string, Omit<HiddenSubtreeItem, "id">> = {
        newNote: {
            title: t("hidden-subtree.new-note-title"),
            type: "launcher",
            command: "createNoteIntoInbox",
            icon: "bx bx-file-blank"
        },
        openToday: {
            title: t("hidden-subtree.open-today-journal-note-title"),
            type: "launcher",
            builtinWidget: "todayInJournal",
            icon: "bx bx-calendar-star"
        },
        backInHistory: {
            title: t("hidden-subtree.go-to-previous-note-title"),
            type: "launcher",
            builtinWidget: "backInHistoryButton",
            icon: "bx bxs-chevron-left",
            attributes: [{ type: "label", name: "docName", value: "launchbar_history_navigation" }]
        },
        forwardInHistory: {
            title: t("hidden-subtree.go-to-next-note-title"),
            type: "launcher",
            builtinWidget: "forwardInHistoryButton",
            icon: "bx bxs-chevron-right",
            attributes: [{ type: "label", name: "docName", value: "launchbar_history_navigation" }]
        },
        calendar: {
            title: t("hidden-subtree.calendar-title"),
            type: "launcher",
            builtinWidget: "calendar",
            icon: "bx bx-calendar"
        },
        recentChanges: {
            title: t("hidden-subtree.recent-changes-title"),
            type: "launcher",
            command: "showRecentChanges",
            icon: "bx bx-history"
        }
    };

    const desktopAvailableLaunchers: HiddenSubtreeItem[] = [
        {
            id: "_lbBackInHistory",
            ...sharedLaunchers.backInHistory
        },
        {   
            id: "_lbForwardInHistory",
            ...sharedLaunchers.forwardInHistory
        },
        {
            id: "_commandPalette",
            title: t("hidden-subtree.command-palette"),
            type: "launcher",
            command: "commandPalette",
            icon: "bx bx-chevron-right-square"
        },
        { 
            id: "_lbBackendLog",
            title: t("hidden-subtree.backend-log-title"),
            type: "launcher",
            targetNoteId: "_backendLog",
            icon: "bx bx-detail" 
        },
        {
            id: "_zenMode",
            title: t("hidden-subtree.zen-mode"),
            type: "launcher",
            command: "toggleZenMode",
            icon: "bx bxs-yin-yang"
        }
    ];

    const desktopVisibleLaunchers: HiddenSubtreeItem[] = [
        {
            id: "_lbNewNote",
            ...sharedLaunchers.newNote
        },
        {
            id: "_lbSearch",
            title: t("hidden-subtree.search-notes-title"),
            type: "launcher",
            command: "searchNotes",
            icon: "bx bx-search",
            attributes: [{ type: "label", name: "desktopOnly" }]
        },
        {
            id: "_lbJumpTo",
            title: t("hidden-subtree.jump-to-note-title"),
            type: "launcher",
            command: "jumpToNote",
            icon: "bx bx-send",
            attributes: [{ type: "label", name: "desktopOnly" }]
        },
        {   id: "_lbNoteMap",
            title: t("hidden-subtree.note-map-title"),
            type: "launcher",
            targetNoteId: "_globalNoteMap",
            icon: "bx bxs-network-chart"
        },
        {
            id: "_lbLlmChat",
            title: t("hidden-subtree.llm-chat-title"),
            type: "launcher",
            builtinWidget: "aiChatLauncher",
            icon: "bx bx-bot",
            attributes: [
                { type: "label", name: "desktopOnly" }
            ]
        },
        {
            id: "_lbCalendar",
            ...sharedLaunchers.calendar
        },
        {
            id: "_lbRecentChanges",
            ...sharedLaunchers.recentChanges
        },
        {
            id: "_lbSpacer1",
            title: t("hidden-subtree.spacer-title"),
            type: "launcher",
            builtinWidget: "spacer",
            baseSize: "50",
            growthFactor: "0"
        },
        {   
            id: "_lbBookmarks",
            title: t("hidden-subtree.bookmarks-title"),
            type: "launcher",
            builtinWidget: "bookmarks",
            icon: "bx bx-bookmark"
        },
        {
            id: "_lbToday",
            ...sharedLaunchers.openToday
        },
        {   
            id: "_lbSpacer2",
            title: t("hidden-subtree.spacer-title"),
            type: "launcher",
            builtinWidget: "spacer",
            baseSize: "0",
            growthFactor: "1"
        },
        {
            id: "_lbQuickSearch",
            title: t("hidden-subtree.quick-search-title"),
            type: "launcher",
            builtinWidget: "quickSearch",
            icon: "bx bx-rectangle",
            attributes: [{ type: "label", name: "docName", value: "launchbar_quick_search" }]
        },
        {
            id: "_lbProtectedSession",
            title: t("hidden-subtree.protected-session-title"),
            type: "launcher", builtinWidget: "protectedSession",
            icon: "bx bx bx-shield-quarter"
        },
        {
            id: "_lbSyncStatus",
            title: t("hidden-subtree.sync-status-title"),
            type: "launcher",
            builtinWidget: "syncStatus",
            icon: "bx bx-wifi"
        },
        {
            id: "_lbSettings",
            title: t("hidden-subtree.settings-title"),
            type: "launcher",
            command: "showOptions",
            icon: "bx bx-cog"
        }
    ];

    const mobileAvailableLaunchers: HiddenSubtreeItem[] = [
        { id: "_lbMobileNewNote", ...sharedLaunchers.newNote },
        { id: "_lbMobileToday", ...sharedLaunchers.openToday }
    ];

    const mobileVisibleLaunchers: HiddenSubtreeItem[] = [
        {
            id: "_lbMobileBackInHistory",
            ...sharedLaunchers.backInHistory
        },
        {
            id: "_lbMobileForwardInHistory",
            ...sharedLaunchers.forwardInHistory
        },
        {
            id: "_lbMobileJumpTo",
            title: t("hidden-subtree.jump-to-note-title"),
            type: "launcher",
            command: "jumpToNote",
            icon: "bx bx-plus-circle"
        },
        {
            id: "_lbMobileCalendar",
            ...sharedLaunchers.calendar
        },
        {
            id: "_lbMobileRecentChanges",
            ...sharedLaunchers.recentChanges
        }
    ];

    return {
        desktopAvailableLaunchers,
        desktopVisibleLaunchers,
        mobileAvailableLaunchers,
        mobileVisibleLaunchers
    };
}