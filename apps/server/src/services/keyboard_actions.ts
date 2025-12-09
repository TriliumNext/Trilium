"use strict";

import optionService from "./options.js";
import log from "./log.js";
import { isElectron, isMac } from "./utils.js";
import type { ActionKeyboardShortcut, KeyboardShortcut } from "@triliumnext/commons";
import { t } from "i18next";

function getDefaultKeyboardActions() {
    if (!t("keyboard_actions.note-navigation")) {
        throw new Error("Keyboard actions loaded before translations.");
    }

    const DEFAULT_KEYBOARD_ACTIONS: KeyboardShortcut[] = [
        {
            separator: t("keyboard_actions.note-navigation")
        },
        {
            actionName: "backInNoteHistory",
            friendlyName: t("keyboard_action_names.back-in-note-history"),
            iconClass: "bx bxs-chevron-left",
            // Mac has a different history navigation shortcuts - https://github.com/zadam/trilium/issues/376
            defaultShortcuts: isMac ? ["CommandOrControl+["] : ["Alt+Left"],
            description: t("keyboard_actions.back-in-note-history"),
            scope: "window"
        },
        {
            actionName: "forwardInNoteHistory",
            friendlyName: t("keyboard_action_names.forward-in-note-history"),
            iconClass: "bx bxs-chevron-right",
            // Mac has a different history navigation shortcuts - https://github.com/zadam/trilium/issues/376
            defaultShortcuts: isMac ? ["CommandOrControl+]"] : ["Alt+Right"],
            description: t("keyboard_actions.forward-in-note-history"),
            scope: "window"
        },
        {
            actionName: "jumpToNote",
            friendlyName: t("keyboard_action_names.jump-to-note"),
            defaultShortcuts: ["CommandOrControl+J"],
            description: t("keyboard_actions.open-jump-to-note-dialog"),
            scope: "window",
            ignoreFromCommandPalette: true
        },
        {
            actionName: "openTodayNote",
            friendlyName: t("hidden-subtree.open-today-journal-note-title"),
            iconClass: "bx bx-calendar",
            defaultShortcuts: [],
            description: t("hidden-subtree.open-today-journal-note-title"),
            scope: "window"
        },
        {
            actionName: "commandPalette",
            friendlyName: t("keyboard_action_names.command-palette"),
            defaultShortcuts: ["CommandOrControl+Shift+J"],
            description: t("keyboard_actions.open-command-palette"),
            scope: "window",
            ignoreFromCommandPalette: true
        },
        {
            actionName: "scrollToActiveNote",
            friendlyName: t("keyboard_action_names.scroll-to-active-note"),
            defaultShortcuts: ["CommandOrControl+."],
            iconClass: "bx bx-current-location",
            description: t("keyboard_actions.scroll-to-active-note"),
            scope: "window"
        },
        {
            actionName: "quickSearch",
            friendlyName: t("keyboard_action_names.quick-search"),
            iconClass: "bx bx-search",
            defaultShortcuts: ["CommandOrControl+S"],
            description: t("keyboard_actions.quick-search"),
            scope: "window"
        },
        {
            actionName: "searchInSubtree",
            friendlyName: t("keyboard_action_names.search-in-subtree"),
            defaultShortcuts: ["CommandOrControl+Shift+S"],
            iconClass: "bx bx-search-alt",
            description: t("keyboard_actions.search-in-subtree"),
            scope: "note-tree"
        },
        {
            actionName: "expandSubtree",
            friendlyName: t("keyboard_action_names.expand-subtree"),
            defaultShortcuts: [],
            iconClass: "bx bx-layer-plus",
            description: t("keyboard_actions.expand-subtree"),
            scope: "note-tree"
        },
        {
            actionName: "collapseTree",
            friendlyName: t("keyboard_action_names.collapse-tree"),
            defaultShortcuts: ["Alt+C"],
            iconClass: "bx bx-layer-minus",
            description: t("keyboard_actions.collapse-tree"),
            scope: "window"
        },
        {
            actionName: "collapseSubtree",
            friendlyName: t("keyboard_action_names.collapse-subtree"),
            iconClass: "bx bxs-layer-minus",
            defaultShortcuts: ["Alt+-"],
            description: t("keyboard_actions.collapse-subtree"),
            scope: "note-tree"
        },
        {
            actionName: "sortChildNotes",
            friendlyName: t("keyboard_action_names.sort-child-notes"),
            iconClass: "bx bx-sort-down",
            defaultShortcuts: ["Alt+S"],
            description: t("keyboard_actions.sort-child-notes"),
            scope: "note-tree"
        },

        {
            separator: t("keyboard_actions.creating-and-moving-notes")
        },
        {
            actionName: "createNoteAfter",
            friendlyName: t("keyboard_action_names.create-note-after"),
            iconClass: "bx bx-plus",
            defaultShortcuts: ["CommandOrControl+O"],
            description: t("keyboard_actions.create-note-after"),
            scope: "window"
        },
        {
            actionName: "createNoteInto",
            friendlyName: t("keyboard_action_names.create-note-into"),
            iconClass: "bx bx-plus",
            defaultShortcuts: ["CommandOrControl+P"],
            description: t("keyboard_actions.create-note-into"),
            scope: "window"
        },
        {
            actionName: "createNoteIntoInbox",
            friendlyName: t("keyboard_action_names.create-note-into-inbox"),
            iconClass: "bx bxs-inbox",
            defaultShortcuts: ["global:CommandOrControl+Alt+P"],
            description: t("keyboard_actions.create-note-into-inbox"),
            scope: "window"
        },
        {
            actionName: "deleteNotes",
            friendlyName: t("keyboard_action_names.delete-notes"),
            iconClass: "bx bx-trash",
            defaultShortcuts: ["Delete"],
            description: t("keyboard_actions.delete-note"),
            scope: "note-tree"
        },
        {
            actionName: "moveNoteUp",
            friendlyName: t("keyboard_action_names.move-note-up"),
            iconClass: "bx bx-up-arrow-alt",
            defaultShortcuts: isMac ? ["Alt+Up"] : ["CommandOrControl+Up"],
            description: t("keyboard_actions.move-note-up"),
            scope: "note-tree"
        },
        {
            actionName: "moveNoteDown",
            friendlyName: t("keyboard_action_names.move-note-down"),
            iconClass: "bx bx-down-arrow-alt",
            defaultShortcuts: isMac ? ["Alt+Down"] : ["CommandOrControl+Down"],
            description: t("keyboard_actions.move-note-down"),
            scope: "note-tree"
        },
        {
            actionName: "moveNoteUpInHierarchy",
            friendlyName: t("keyboard_action_names.move-note-up-in-hierarchy"),
            iconClass: "bx bx-arrow-from-bottom",
            defaultShortcuts: isMac ? ["Alt+Left"] : ["CommandOrControl+Left"],
            description: t("keyboard_actions.move-note-up-in-hierarchy"),
            scope: "note-tree"
        },
        {
            actionName: "moveNoteDownInHierarchy",
            friendlyName: t("keyboard_action_names.move-note-down-in-hierarchy"),
            iconClass: "bx bx-arrow-from-top",
            defaultShortcuts: isMac ? ["Alt+Right"] : ["CommandOrControl+Right"],
            description: t("keyboard_actions.move-note-down-in-hierarchy"),
            scope: "note-tree"
        },
        {
            actionName: "editNoteTitle",
            friendlyName: t("keyboard_action_names.edit-note-title"),
            iconClass: "bx bx-rename",
            defaultShortcuts: ["Enter"],
            description: t("keyboard_actions.edit-note-title"),
            scope: "note-tree"
        },
        {
            actionName: "editBranchPrefix",
            friendlyName: t("keyboard_action_names.edit-branch-prefix"),
            iconClass: "bx bx-rename",
            defaultShortcuts: ["F2"],
            description: t("keyboard_actions.edit-branch-prefix"),
            scope: "note-tree"
        },
        {
            actionName: "cloneNotesTo",
            friendlyName: t("keyboard_action_names.clone-notes-to"),
            iconClass: "bx bx-duplicate",
            defaultShortcuts: ["CommandOrControl+Shift+C"],
            description: t("keyboard_actions.clone-notes-to"),
            scope: "window"
        },
        {
            actionName: "moveNotesTo",
            friendlyName: t("keyboard_action_names.move-notes-to"),
            iconClass: "bx bx-transfer",
            defaultShortcuts: ["CommandOrControl+Shift+X"],
            description: t("keyboard_actions.move-notes-to"),
            scope: "window"
        },

        {
            separator: t("keyboard_actions.note-clipboard")
        },

        {
            actionName: "copyNotesToClipboard",
            friendlyName: t("keyboard_action_names.copy-notes-to-clipboard"),
            iconClass: "bx bx-copy",
            defaultShortcuts: ["CommandOrControl+C"],
            description: t("keyboard_actions.copy-notes-to-clipboard"),
            scope: "note-tree"
        },
        {
            actionName: "pasteNotesFromClipboard",
            friendlyName: t("keyboard_action_names.paste-notes-from-clipboard"),
            iconClass: "bx bx-paste",
            defaultShortcuts: ["CommandOrControl+V"],
            description: t("keyboard_actions.paste-notes-from-clipboard"),
            scope: "note-tree"
        },
        {
            actionName: "cutNotesToClipboard",
            friendlyName: t("keyboard_action_names.cut-notes-to-clipboard"),
            iconClass: "bx bx-cut",
            defaultShortcuts: ["CommandOrControl+X"],
            description: t("keyboard_actions.cut-notes-to-clipboard"),
            scope: "note-tree"
        },
        {
            actionName: "selectAllNotesInParent",
            friendlyName: t("keyboard_action_names.select-all-notes-in-parent"),
            iconClass: "bx bx-select-multiple",
            defaultShortcuts: ["CommandOrControl+A"],
            description: t("keyboard_actions.select-all-notes-in-parent"),
            scope: "note-tree"
        },
        {
            actionName: "addNoteAboveToSelection",
            friendlyName: t("keyboard_action_names.add-note-above-to-selection"),
            defaultShortcuts: ["Shift+Up"],
            description: t("keyboard_actions.add-note-above-to-the-selection"),
            scope: "note-tree",
            ignoreFromCommandPalette: true
        },
        {
            actionName: "addNoteBelowToSelection",
            friendlyName: t("keyboard_action_names.add-note-below-to-selection"),
            defaultShortcuts: ["Shift+Down"],
            description: t("keyboard_actions.add-note-below-to-selection"),
            scope: "note-tree",
            ignoreFromCommandPalette: true
        },
        {
            actionName: "duplicateSubtree",
            friendlyName: t("keyboard_action_names.duplicate-subtree"),
            iconClass: "bx bx-outline",
            defaultShortcuts: [],
            description: t("keyboard_actions.duplicate-subtree"),
            scope: "note-tree"
        },

        {
            separator: t("keyboard_actions.tabs-and-windows")
        },
        {
            actionName: "openNewTab",
            friendlyName: t("keyboard_action_names.open-new-tab"),
            iconClass: "bx bx-plus",
            defaultShortcuts: isElectron ? ["CommandOrControl+T"] : [],
            description: t("keyboard_actions.open-new-tab"),
            scope: "window"
        },
        {
            actionName: "closeActiveTab",
            friendlyName: t("keyboard_action_names.close-active-tab"),
            iconClass: "bx bx-minus",
            defaultShortcuts: isElectron ? ["CommandOrControl+W"] : [],
            description: t("keyboard_actions.close-active-tab"),
            scope: "window"
        },
        {
            actionName: "reopenLastTab",
            friendlyName: t("keyboard_action_names.reopen-last-tab"),
            iconClass: "bx bx-undo",
            defaultShortcuts: isElectron ? ["CommandOrControl+Shift+T"] : [],
            isElectronOnly: true,
            description: t("keyboard_actions.reopen-last-tab"),
            scope: "window"
        },
        {
            actionName: "activateNextTab",
            friendlyName: t("keyboard_action_names.activate-next-tab"),
            iconClass: "bx bx-skip-next",
            defaultShortcuts: isElectron ? ["CommandOrControl+Tab", "CommandOrControl+PageDown"] : [],
            description: t("keyboard_actions.activate-next-tab"),
            scope: "window"
        },
        {
            actionName: "activatePreviousTab",
            friendlyName: t("keyboard_action_names.activate-previous-tab"),
            iconClass: "bx bx-skip-previous",
            defaultShortcuts: isElectron ? ["CommandOrControl+Shift+Tab", "CommandOrControl+PageUp"] : [],
            description: t("keyboard_actions.activate-previous-tab"),
            scope: "window"
        },
        {
            actionName: "openNewWindow",
            friendlyName: t("keyboard_action_names.open-new-window"),
            iconClass: "bx bx-window-open",
            defaultShortcuts: [],
            description: t("keyboard_actions.open-new-window"),
            scope: "window"
        },
        {
            actionName: "toggleTray",
            friendlyName: t("keyboard_action_names.toggle-system-tray-icon"),
            iconClass: "bx bx-show",
            defaultShortcuts: [],
            isElectronOnly: true,
            description: t("keyboard_actions.toggle-tray"),
            scope: "window"
        },
        {
            actionName: "toggleZenMode",
            friendlyName: t("keyboard_action_names.toggle-zen-mode"),
            iconClass: "bx bxs-yin-yang",
            defaultShortcuts: ["F9"],
            description: t("keyboard_actions.toggle-zen-mode"),
            scope: "window"
        },
        {
            actionName: "firstTab",
            friendlyName: t("keyboard_action_names.switch-to-first-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+1"],
            description: t("keyboard_actions.first-tab"),
            scope: "window"
        },
        {
            actionName: "secondTab",
            friendlyName: t("keyboard_action_names.switch-to-second-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+2"],
            description: t("keyboard_actions.second-tab"),
            scope: "window"
        },
        {
            actionName: "thirdTab",
            friendlyName: t("keyboard_action_names.switch-to-third-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+3"],
            description: t("keyboard_actions.third-tab"),
            scope: "window"
        },
        {
            actionName: "fourthTab",
            friendlyName: t("keyboard_action_names.switch-to-fourth-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+4"],
            description: t("keyboard_actions.fourth-tab"),
            scope: "window"
        },
        {
            actionName: "fifthTab",
            friendlyName: t("keyboard_action_names.switch-to-fifth-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+5"],
            description: t("keyboard_actions.fifth-tab"),
            scope: "window"
        },
        {
            actionName: "sixthTab",
            friendlyName: t("keyboard_action_names.switch-to-sixth-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+6"],
            description: t("keyboard_actions.sixth-tab"),
            scope: "window"
        },
        {
            actionName: "seventhTab",
            friendlyName: t("keyboard_action_names.switch-to-seventh-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+7"],
            description: t("keyboard_actions.seventh-tab"),
            scope: "window"
        },
        {
            actionName: "eigthTab",
            friendlyName: t("keyboard_action_names.switch-to-eighth-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+8"],
            description: t("keyboard_actions.eight-tab"),
            scope: "window"
        },
        {
            actionName: "ninthTab",
            friendlyName: t("keyboard_action_names.switch-to-ninth-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+9"],
            description: t("keyboard_actions.ninth-tab"),
            scope: "window"
        },
        {
            actionName: "lastTab",
            friendlyName: t("keyboard_action_names.switch-to-last-tab"),
            iconClass: "bx bx-rectangle",
            defaultShortcuts: ["CommandOrControl+0"],
            description: t("keyboard_actions.last-tab"),
            scope: "window"
        },

        {
            separator: t("keyboard_actions.dialogs")
        },
        {
            friendlyName: t("keyboard_action_names.show-note-source"),
            actionName: "showNoteSource",
            iconClass: "bx bx-code",
            defaultShortcuts: [],
            description: t("keyboard_actions.show-note-source"),
            scope: "window"
        },
        {
            friendlyName: t("keyboard_action_names.show-options"),
            actionName: "showOptions",
            iconClass: "bx bx-cog",
            defaultShortcuts: [],
            description: t("keyboard_actions.show-options"),
            scope: "window"
        },
        {
            friendlyName: t("keyboard_action_names.show-revisions"),
            actionName: "showRevisions",
            iconClass: "bx bx-history",
            defaultShortcuts: [],
            description: t("keyboard_actions.show-revisions"),
            scope: "window"
        },
        {
            friendlyName: t("keyboard_action_names.show-recent-changes"),
            actionName: "showRecentChanges",
            iconClass: "bx bx-history",
            defaultShortcuts: [],
            description: t("keyboard_actions.show-recent-changes"),
            scope: "window"
        },
        {
            friendlyName: t("keyboard_action_names.show-sql-console"),
            actionName: "showSQLConsole",
            iconClass: "bx bx-data",
            defaultShortcuts: ["Alt+O"],
            description: t("keyboard_actions.show-sql-console"),
            scope: "window"
        },
        {
            friendlyName: t("keyboard_action_names.show-backend-log"),
            actionName: "showBackendLog",
            iconClass: "bx bx-detail",
            defaultShortcuts: [],
            description: t("keyboard_actions.show-backend-log"),
            scope: "window"
        },
        {
            friendlyName: t("keyboard_action_names.show-help"),
            actionName: "showHelp",
            iconClass: "bx bx-help-circle",
            defaultShortcuts: ["F1"],
            description: t("keyboard_actions.show-help"),
            scope: "window"
        },
        {
            friendlyName: t("keyboard_action_names.show-cheatsheet"),
            actionName: "showCheatsheet",
            iconClass: "bx bxs-keyboard",
            defaultShortcuts: ["Shift+F1"],
            description: t("keyboard_actions.show-cheatsheet"),
            scope: "window"
        },

        {
            separator: t("keyboard_actions.text-note-operations")
        },

        {
            friendlyName: t("keyboard_action_names.add-link-to-text"),
            actionName: "addLinkToText",
            iconClass: "bx bx-link",
            defaultShortcuts: ["CommandOrControl+L"],
            description: t("keyboard_actions.add-link-to-text"),
            scope: "text-detail"
        },
        {
            friendlyName: t("keyboard_action_names.follow-link-under-cursor"),
            actionName: "followLinkUnderCursor",
            iconClass: "bx bx-link-external",
            defaultShortcuts: ["CommandOrControl+Enter"],
            description: t("keyboard_actions.follow-link-under-cursor"),
            scope: "text-detail"
        },
        {
            friendlyName: t("keyboard_action_names.insert-date-and-time-to-text"),
            actionName: "insertDateTimeToText",
            iconClass: "bx bx-calendar-event",
            defaultShortcuts: ["Alt+T"],
            description: t("keyboard_actions.insert-date-and-time-to-text"),
            scope: "text-detail"
        },
        {
            friendlyName: t("keyboard_action_names.paste-markdown-into-text"),
            actionName: "pasteMarkdownIntoText",
            iconClass: "bx bxl-markdown",
            defaultShortcuts: [],
            description: t("keyboard_actions.paste-markdown-into-text"),
            scope: "text-detail"
        },
        {
            friendlyName: t("keyboard_action_names.cut-into-note"),
            actionName: "cutIntoNote",
            iconClass: "bx bx-cut",
            defaultShortcuts: [],
            description: t("keyboard_actions.cut-into-note"),
            scope: "text-detail"
        },
        {
            friendlyName: t("keyboard_action_names.add-include-note-to-text"),
            actionName: "addIncludeNoteToText",
            iconClass: "bx bx-note",
            defaultShortcuts: [],
            description: t("keyboard_actions.add-include-note-to-text"),
            scope: "text-detail"
        },
        {
            friendlyName: t("keyboard_action_names.edit-read-only-note"),
            actionName: "editReadOnlyNote",
            iconClass: "bx bx-edit-alt",
            defaultShortcuts: [],
            description: t("keyboard_actions.edit-readonly-note"),
            scope: "window"
        },

        {
            separator: t("keyboard_actions.attributes-labels-and-relations")
        },

        {
            friendlyName: t("keyboard_action_names.add-new-label"),
            actionName: "addNewLabel",
            iconClass: "bx bx-hash",
            defaultShortcuts: ["Alt+L"],
            description: t("keyboard_actions.add-new-label"),
            scope: "window"
        },
        {
            friendlyName: t("keyboard_action_names.add-new-relation"),
            actionName: "addNewRelation",
            iconClass: "bx bx-transfer",
            defaultShortcuts: ["Alt+R"],
            description: t("keyboard_actions.create-new-relation"),
            scope: "window"
        },

        {
            separator: t("keyboard_actions.ribbon-tabs")
        },

        {
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-classic-editor"),
            actionName: "toggleRibbonTabClassicEditor",
            iconClass: "bx bx-text",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-classic-editor-toolbar"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabBasicProperties",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-basic-properties"),
            iconClass: "bx bx-slider",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-basic-properties"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabBookProperties",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-book-properties"),
            iconClass: "bx bx-book",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-book-properties"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabFileProperties",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-file-properties"),
            iconClass: "bx bx-file",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-file-properties"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabImageProperties",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-image-properties"),
            iconClass: "bx bx-image",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-image-properties"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabOwnedAttributes",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-owned-attributes"),
            iconClass: "bx bx-list-check",
            defaultShortcuts: ["Alt+A"],
            description: t("keyboard_actions.toggle-owned-attributes"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabInheritedAttributes",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-inherited-attributes"),
            iconClass: "bx bx-list-plus",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-inherited-attributes"),
            scope: "window"
        },
        // TODO: Remove or change since promoted attributes have been changed.
        {
            actionName: "toggleRibbonTabPromotedAttributes",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-promoted-attributes"),
            iconClass: "bx bx-star",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-promoted-attributes"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabNoteMap",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-note-map"),
            iconClass: "bx bxs-network-chart",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-link-map"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabNoteInfo",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-note-info"),
            iconClass: "bx bx-info-circle",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-note-info"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabNotePaths",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-note-paths"),
            iconClass: "bx bx-collection",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-note-paths"),
            scope: "window"
        },
        {
            actionName: "toggleRibbonTabSimilarNotes",
            friendlyName: t("keyboard_action_names.toggle-ribbon-tab-similar-notes"),
            iconClass: "bx bx-bar-chart",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-similar-notes"),
            scope: "window"
        },

        {
            separator: t("keyboard_actions.other")
        },

        {
            actionName: "toggleRightPane",
            friendlyName: t("keyboard_action_names.toggle-right-pane"),
            iconClass: "bx bx-dock-right",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-right-pane"),
            scope: "window"
        },
        {
            actionName: "printActiveNote",
            friendlyName: t("keyboard_action_names.print-active-note"),
            iconClass: "bx bx-printer",
            defaultShortcuts: [],
            description: t("keyboard_actions.print-active-note"),
            scope: "window"
        },
        {
            actionName: "exportAsPdf",
            friendlyName: t("keyboard_action_names.export-active-note-as-pdf"),
            iconClass: "bx bxs-file-pdf",
            defaultShortcuts: [],
            description: t("keyboard_actions.export-as-pdf"),
            scope: "window"
        },
        {
            actionName: "openNoteExternally",
            friendlyName: t("keyboard_action_names.open-note-externally"),
            iconClass: "bx bx-file-find",
            defaultShortcuts: [],
            description: t("keyboard_actions.open-note-externally"),
            scope: "window"
        },
        {
            actionName: "renderActiveNote",
            friendlyName: t("keyboard_action_names.render-active-note"),
            iconClass: "bx bx-refresh",
            defaultShortcuts: [],
            description: t("keyboard_actions.render-active-note"),
            scope: "window"
        },
        {
            actionName: "runActiveNote",
            friendlyName: t("keyboard_action_names.run-active-note"),
            iconClass: "bx bx-play",
            defaultShortcuts: ["CommandOrControl+Enter"],
            description: t("keyboard_actions.run-active-note"),
            scope: "code-detail"
        },
        {
            actionName: "toggleNoteHoisting",
            friendlyName: t("keyboard_action_names.toggle-note-hoisting"),
            iconClass: "bx bx-chevrons-up",
            defaultShortcuts: ["Alt+H"],
            description: t("keyboard_actions.toggle-note-hoisting"),
            scope: "window"
        },
        {
            actionName: "unhoist",
            friendlyName: t("keyboard_action_names.unhoist-note"),
            iconClass: "bx bx-door-open",
            defaultShortcuts: ["Alt+U"],
            description: t("keyboard_actions.unhoist"),
            scope: "window"
        },
        {
            actionName: "reloadFrontendApp",
            friendlyName: t("keyboard_action_names.reload-frontend-app"),
            iconClass: "bx bx-refresh",
            defaultShortcuts: ["F5", "CommandOrControl+R"],
            description: t("keyboard_actions.reload-frontend-app"),
            scope: "window"
        },
        {
            actionName: "openDevTools",
            friendlyName: t("keyboard_action_names.open-developer-tools"),
            iconClass: "bx bx-bug-alt",
            defaultShortcuts: isElectron ? ["CommandOrControl+Shift+I"] : [],
            isElectronOnly: true,
            description: t("keyboard_actions.open-dev-tools"),
            scope: "window"
        },
        {
            actionName: "findInText",
            friendlyName: t("keyboard_action_names.find-in-text"),
            iconClass: "bx bx-search",
            defaultShortcuts: isElectron ? ["CommandOrControl+F"] : [],
            description: t("keyboard_actions.find-in-text"),
            scope: "window"
        },
        {
            actionName: "toggleLeftPane",
            friendlyName: t("keyboard_action_names.toggle-left-pane"),
            iconClass: "bx bx-sidebar",
            defaultShortcuts: [],
            description: t("keyboard_actions.toggle-left-note-tree-panel"),
            scope: "window"
        },
        {
            actionName: "toggleFullscreen",
            friendlyName: t("keyboard_action_names.toggle-full-screen"),
            iconClass: "bx bx-fullscreen",
            defaultShortcuts: ["F11"],
            description: t("keyboard_actions.toggle-full-screen"),
            scope: "window"
        },
        {
            actionName: "zoomOut",
            friendlyName: t("keyboard_action_names.zoom-out"),
            iconClass: "bx bx-zoom-out",
            defaultShortcuts: isElectron ? ["CommandOrControl+-"] : [],
            isElectronOnly: true,
            description: t("keyboard_actions.zoom-out"),
            scope: "window"
        },
        {
            actionName: "zoomIn",
            friendlyName: t("keyboard_action_names.zoom-in"),
            iconClass: "bx bx-zoom-in",
            description: t("keyboard_actions.zoom-in"),
            defaultShortcuts: isElectron ? ["CommandOrControl+="] : [],
            isElectronOnly: true,
            scope: "window"
        },
        {
            actionName: "zoomReset",
            friendlyName: t("keyboard_action_names.reset-zoom-level"),
            iconClass: "bx bx-search-alt",
            description: t("keyboard_actions.reset-zoom-level"),
            defaultShortcuts: isElectron ? ["CommandOrControl+0"] : [],
            isElectronOnly: true,
            scope: "window"
        },
        {
            actionName: "copyWithoutFormatting",
            friendlyName: t("keyboard_action_names.copy-without-formatting"),
            iconClass: "bx bx-copy-alt",
            defaultShortcuts: ["CommandOrControl+Alt+C"],
            description: t("keyboard_actions.copy-without-formatting"),
            scope: "text-detail"
        },
        {
            actionName: "forceSaveRevision",
            friendlyName: t("keyboard_action_names.force-save-revision"),
            iconClass: "bx bx-save",
            defaultShortcuts: [],
            description: t("keyboard_actions.force-save-revision"),
            scope: "window"
        }
    ];

    /*
     * Apply macOS-specific tweaks.
     */
    const platformModifier = isMac ? "Meta" : "Ctrl";

    for (const action of DEFAULT_KEYBOARD_ACTIONS) {
        if ("defaultShortcuts" in action && action.defaultShortcuts) {
            action.defaultShortcuts = action.defaultShortcuts.map((shortcut) => shortcut.replace("CommandOrControl", platformModifier));
        }
    }

    return DEFAULT_KEYBOARD_ACTIONS;
}

function getKeyboardActions() {
    const actions: KeyboardShortcut[] = JSON.parse(JSON.stringify(getDefaultKeyboardActions()));

    for (const action of actions) {
        if ("effectiveShortcuts" in action && action.effectiveShortcuts) {
            action.effectiveShortcuts = action.defaultShortcuts ? action.defaultShortcuts.slice() : [];
        }
    }

    for (const option of optionService.getOptions()) {
        if (option.name.startsWith("keyboardShortcuts")) {
            let actionName = option.name.substring(17);
            actionName = actionName.charAt(0).toLowerCase() + actionName.slice(1);

            const action = actions.find((ea) => "actionName" in ea && ea.actionName === actionName) as ActionKeyboardShortcut;

            if (action) {
                try {
                    action.effectiveShortcuts = JSON.parse(option.value);
                } catch (e) {
                    log.error(`Could not parse shortcuts for action ${actionName}`);
                }
            } else {
                log.info(`Keyboard action ${actionName} found in database, but not in action definition.`);
            }
        }
    }

    return actions;
}

export default {
    getDefaultKeyboardActions,
    getKeyboardActions
};
