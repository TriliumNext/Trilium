import BAttribute from "../becca/entities/battribute.js";
import BBranch from "../becca/entities/bbranch.js";
import type { HiddenSubtreeItem } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import noteService from "./notes.js";
import log from "./log.js";
import migrationService from "./migration.js";
import { t } from "i18next";
import { cleanUpHelp, getHelpHiddenSubtreeData } from "./in_app_help.js";
import buildLaunchBarConfig from "./hidden_subtree_launcherbar.js";
import buildHiddenSubtreeTemplates from "./hidden_subtree_templates.js";

export const LBTPL_ROOT = "_lbTplRoot";
export const LBTPL_BASE = "_lbTplBase";
export const LBTPL_HEADER = "_lbTplHeader";
export const LBTPL_NOTE_LAUNCHER = "_lbTplLauncherNote";
export const LBTPL_WIDGET = "_lbTplLauncherWidget";
export const LBTPL_COMMAND = "_lbTplLauncherCommand";
export const LBTPL_SCRIPT = "_lbTplLauncherScript";
export const LBTPL_SPACER = "_lbTplSpacer";
export const LBTPL_CUSTOM_WIDGET = "_lbTplCustomWidget";

/*
 * Hidden subtree is generated as a "predictable structure" which means that it avoids generating random IDs to always
 * produce the same structure. This is needed because it is run on multiple instances in the sync cluster which might produce
 * duplicate subtrees. This way, all instances will generate the same structure with the same IDs.
 */

let hiddenSubtreeDefinition: HiddenSubtreeItem;

function buildHiddenSubtreeDefinition(helpSubtree: HiddenSubtreeItem[]): HiddenSubtreeItem {
    const launchbarConfig = buildLaunchBarConfig();

    return {
        id: "_hidden",
        title: t("hidden-subtree.root-title"),
        type: "doc",
        icon: "bx bx-hide",
        // we want to keep the hidden subtree always last, otherwise there will be problems with e.g., keyboard navigation
        // over tree when it's in the middle
        notePosition: 999_999_999,
        enforceAttributes: true,
        attributes: [
            { type: "label", name: "docName", value: "hidden" }
        ],
        children: [
            {
                id: "_search",
                title: t("hidden-subtree.search-history-title"),
                type: "doc"
            },
            {
                id: "_globalNoteMap",
                title: t("hidden-subtree.note-map-title"),
                type: "noteMap",
                attributes: [
                    { type: "label", name: "mapRootNoteId", value: "hoisted" },
                    { type: "label", name: "keepCurrentHoisting" }
                ]
            },
            {
                id: "_sqlConsole",
                title: t("hidden-subtree.sql-console-history-title"),
                type: "doc",
                icon: "bx-data"
            },
            {
                id: "_share",
                title: t("hidden-subtree.shared-notes-title"),
                type: "doc",
                attributes: [{ type: "label", name: "docName", value: "share" }]
            },
            {
                id: "_bulkAction",
                title: t("hidden-subtree.bulk-action-title"),
                type: "doc"
            },
            {
                id: "_backendLog",
                title: t("hidden-subtree.backend-log-title"),
                type: "contentWidget",
                icon: "bx-terminal",
                attributes: [
                    { type: "label", name: "keepCurrentHoisting" },
                    { type: "label", name: "fullContentWidth" }
                ]
            },
            {
                // place for user scripts hidden stuff (scripts should not create notes directly under hidden root)
                id: "_userHidden",
                title: t("hidden-subtree.user-hidden-title"),
                type: "doc",
                attributes: [{ type: "label", name: "docName", value: "user_hidden" }]
            },
            {
                id: LBTPL_ROOT,
                title: t("hidden-subtree.launch-bar-templates-title"),
                type: "doc",
                children: [
                    {
                        id: LBTPL_BASE,
                        title: t("hidden-subtree.base-abstract-launcher-title"),
                        type: "doc"
                    },
                    {
                        id: LBTPL_COMMAND,
                        title: t("hidden-subtree.command-launcher-title"),
                        type: "doc",
                        attributes: [
                            { type: "relation", name: "template", value: LBTPL_BASE },
                            { type: "label", name: "launcherType", value: "command" },
                            { type: "label", name: "docName", value: "launchbar_command_launcher" }
                        ]
                    },
                    {
                        id: LBTPL_NOTE_LAUNCHER,
                        title: t("hidden-subtree.note-launcher-title"),
                        type: "doc",
                        attributes: [
                            { type: "relation", name: "template", value: LBTPL_BASE },
                            { type: "label", name: "launcherType", value: "note" },
                            { type: "label", name: "relation:target", value: "promoted" },
                            { type: "label", name: "relation:hoistedNote", value: "promoted" },
                            { type: "label", name: "label:keyboardShortcut", value: "promoted,text" },
                            { type: "label", name: "docName", value: "launchbar_note_launcher" }
                        ]
                    },
                    {
                        id: LBTPL_SCRIPT,
                        title: t("hidden-subtree.script-launcher-title"),
                        type: "doc",
                        attributes: [
                            { type: "relation", name: "template", value: LBTPL_BASE },
                            { type: "label", name: "launcherType", value: "script" },
                            { type: "label", name: "relation:script", value: "promoted" },
                            { type: "label", name: "label:keyboardShortcut", value: "promoted,text" },
                            { type: "label", name: "docName", value: "launchbar_script_launcher" }
                        ]
                    },
                    {
                        id: LBTPL_WIDGET,
                        title: t("hidden-subtree.built-in-widget-title"),
                        type: "doc",
                        attributes: [
                            { type: "relation", name: "template", value: LBTPL_BASE },
                            { type: "label", name: "launcherType", value: "builtinWidget" }
                        ]
                    },
                    {
                        id: LBTPL_SPACER,
                        title: t("hidden-subtree.spacer-title"),
                        type: "doc",
                        icon: "bx-move-vertical",
                        attributes: [
                            { type: "relation", name: "template", value: LBTPL_WIDGET },
                            { type: "label", name: "builtinWidget", value: "spacer" },
                            { type: "label", name: "label:baseSize", value: "promoted,number" },
                            { type: "label", name: "label:growthFactor", value: "promoted,number" },
                            { type: "label", name: "docName", value: "launchbar_spacer" }
                        ]
                    },
                    {
                        id: LBTPL_CUSTOM_WIDGET,
                        title: t("hidden-subtree.custom-widget-title"),
                        type: "doc",
                        attributes: [
                            { type: "relation", name: "template", value: LBTPL_BASE },
                            { type: "label", name: "launcherType", value: "customWidget" },
                            { type: "label", name: "relation:widget", value: "promoted" },
                            { type: "label", name: "docName", value: "launchbar_widget_launcher" }
                        ]
                    }
                ]
            },
            {
                id: "_lbRoot",
                title: t("hidden-subtree.launch-bar-title"),
                type: "doc",
                icon: "bx-sidebar",
                isExpanded: true,
                attributes: [{ type: "label", name: "docName", value: "launchbar_intro" }],
                children: [
                    {
                        id: "_lbAvailableLaunchers",
                        title: t("hidden-subtree.available-launchers-title"),
                        type: "doc",
                        icon: "bx-hide",
                        isExpanded: true,
                        attributes: [{ type: "label", name: "docName", value: "launchbar_intro" }],
                        children: launchbarConfig.desktopAvailableLaunchers
                    },
                    {
                        id: "_lbVisibleLaunchers",
                        title: t("hidden-subtree.visible-launchers-title"),
                        type: "doc",
                        icon: "bx-show",
                        isExpanded: true,
                        attributes: [{ type: "label", name: "docName", value: "launchbar_intro" }],
                        children: launchbarConfig.desktopVisibleLaunchers
                    }
                ]
            },
            {
                id: "_lbMobileRoot",
                title: "Mobile Launch Bar",
                type: "doc",
                icon: "bx-mobile",
                isExpanded: true,
                attributes: [{ type: "label", name: "docName", value: "launchbar_intro" }],
                children: [
                    {
                        id: "_lbMobileAvailableLaunchers",
                        title: t("hidden-subtree.available-launchers-title"),
                        type: "doc",
                        icon: "bx-hide",
                        isExpanded: true,
                        attributes: [{ type: "label", name: "docName", value: "launchbar_intro" }],
                        children: launchbarConfig.mobileAvailableLaunchers
                    },
                    {
                        id: "_lbMobileVisibleLaunchers",
                        title: t("hidden-subtree.visible-launchers-title"),
                        type: "doc",
                        icon: "bx-show",
                        isExpanded: true,
                        attributes: [{ type: "label", name: "docName", value: "launchbar_intro" }],
                        children: launchbarConfig.mobileVisibleLaunchers
                    }
                ]
            },
            {
                id: "_options",
                title: t("hidden-subtree.options-title"),
                type: "book",
                icon: "bx-cog",
                children: [
                    { id: "_optionsAppearance", title: t("hidden-subtree.appearance-title"), type: "contentWidget", icon: "bx-layout" },
                    { id: "_optionsShortcuts", title: t("hidden-subtree.shortcuts-title"), type: "contentWidget", icon: "bxs-keyboard" },
                    { id: "_optionsTextNotes", title: t("hidden-subtree.text-notes"), type: "contentWidget", icon: "bx-text" },
                    { id: "_optionsCodeNotes", title: t("hidden-subtree.code-notes-title"), type: "contentWidget", icon: "bx-code" },
                    { id: "_optionsImages", title: t("hidden-subtree.images-title"), type: "contentWidget", icon: "bx-image" },
                    { id: "_optionsSpellcheck", title: t("hidden-subtree.spellcheck-title"), type: "contentWidget", icon: "bx-check-double" },
                    { id: "_optionsPassword", title: t("hidden-subtree.password-title"), type: "contentWidget", icon: "bx-lock" },
                    { id: '_optionsMFA', title: t('hidden-subtree.multi-factor-authentication-title'), type: 'contentWidget', icon: 'bx-lock ' },
                    { id: "_optionsEtapi", title: t("hidden-subtree.etapi-title"), type: "contentWidget", icon: "bx-extension" },
                    { id: "_optionsBackup", title: t("hidden-subtree.backup-title"), type: "contentWidget", icon: "bx-data" },
                    { id: "_optionsSync", title: t("hidden-subtree.sync-title"), type: "contentWidget", icon: "bx-wifi" },

                    { id: "_optionsOther", title: t("hidden-subtree.other"), type: "contentWidget", icon: "bx-dots-horizontal" },
                    { id: "_optionsLocalization", title: t("hidden-subtree.localization"), type: "contentWidget", icon: "bx-world" },
                    { id: "_optionsAdvanced", title: t("hidden-subtree.advanced-title"), type: "contentWidget" }
                ]
            },
            {
                id: "_help",
                title: t("hidden-subtree.user-guide"),
                type: "book",
                icon: "bx-help-circle",
                children: helpSubtree,
                isExpanded: true
            },
            buildHiddenSubtreeTemplates()
        ]
    };
}

interface CheckHiddenExtraOpts {
    restoreNames?: boolean;
}

function checkHiddenSubtree(force = false, extraOpts: CheckHiddenExtraOpts = {}) {
    if (!force && !migrationService.isDbUpToDate()) {
        // on-delete hook might get triggered during some future migration and cause havoc
        log.info("Will not check hidden subtree until migration is finished.");
        return;
    }

    const helpSubtree = getHelpHiddenSubtreeData();
    if (!hiddenSubtreeDefinition || force) {
        hiddenSubtreeDefinition = buildHiddenSubtreeDefinition(helpSubtree);
    }

    checkHiddenSubtreeRecursively("root", hiddenSubtreeDefinition, extraOpts);

    try {
        cleanUpHelp(helpSubtree);
    } catch (e) {
        // Non-critical operation should something go wrong.
        console.error(e);
    }
}

/**
 * Get all expected parent IDs for a given note ID from the hidden subtree definition
 */
function getExpectedParentIds(noteId: string, subtree: HiddenSubtreeItem): string[] {
    const expectedParents: string[] = [];

    function traverse(item: HiddenSubtreeItem, parentId: string) {
        if (item.id === noteId) {
            expectedParents.push(parentId);
        }

        if (item.children) {
            for (const child of item.children) {
                traverse(child, item.id);
            }
        }
    }

    // Start traversal from root
    if (subtree.id === noteId) {
        expectedParents.push("root");
    }

    if (subtree.children) {
        for (const child of subtree.children) {
            traverse(child, subtree.id);
        }
    }

    return expectedParents;
}

/**
 * Check if a note ID is within the hidden subtree structure
 */
function isWithinHiddenSubtree(noteId: string): boolean {
    // Consider a note to be within hidden subtree if it starts with underscore
    // This is the convention used for hidden subtree notes
    return noteId.startsWith("_") || noteId === "root";
}

function checkHiddenSubtreeRecursively(parentNoteId: string, item: HiddenSubtreeItem, extraOpts: CheckHiddenExtraOpts = {}) {
    if (!item.id || !item.type || !item.title) {
        throw new Error(`Item does not contain mandatory properties: ${JSON.stringify(item)}`);
    }

    if (item.id.charAt(0) !== "_") {
        throw new Error(`ID has to start with underscore, given '${item.id}'`);
    }

    let note = becca.notes[item.id];
    let branch;

    if (!note) {
        // Missing item, add it.
        ({ note, branch } = noteService.createNewNote({
            noteId: item.id,
            title: item.title,
            type: item.type,
            parentNoteId: parentNoteId,
            content: item.content ?? "",
            ignoreForbiddenParents: true
        }));
    } else {
        // Existing item, check if it's in the right state.
        branch = note.getParentBranches().find((branch) => branch.parentNoteId === parentNoteId);

        if (item.content && note.getContent() !== item.content) {
            log.info(`Updating content of ${item.id}.`);
            note.setContent(item.content);
        }

        // Clean up any branches that shouldn't exist according to the meta definition
        // For hidden subtree notes, we want to ensure they only exist in their designated locations
        if (item.enforceBranches || item.id.startsWith("_help")) {
            // If the note exists but doesn't have a branch in the expected parent,
            // create the missing branch to ensure it's in the correct location
            if (!branch) {
                log.info(`Creating missing branch for note ${item.id} under parent ${parentNoteId}.`);
                branch = new BBranch({
                    noteId: item.id,
                    parentNoteId: parentNoteId,
                    notePosition: item.notePosition !== undefined ? item.notePosition : undefined,
                    isExpanded: item.isExpanded !== undefined ? item.isExpanded : false
                }).save();
            }

            // Remove any branches that are not in the expected parent.
            const expectedParents = getExpectedParentIds(item.id, hiddenSubtreeDefinition);
            const currentBranches = note.getParentBranches();

            for (const currentBranch of currentBranches) {
                // Only delete branches that are not in the expected locations
                // and are within the hidden subtree structure (avoid touching user-created clones)
                if (!expectedParents.includes(currentBranch.parentNoteId) &&
                    isWithinHiddenSubtree(currentBranch.parentNoteId)) {
                    log.info(`Removing unexpected branch for note '${item.id}' from parent '${currentBranch.parentNoteId}'`);
                    currentBranch.markAsDeleted();
                }
            }
        }
    }

    const attrs = [...(item.attributes || [])];

    if (item.icon) {
        attrs.push({ type: "label", name: "iconClass", value: `bx ${item.icon}` });
    }

    if (item.type === "launcher") {
        if (item.command) {
            attrs.push({ type: "relation", name: "template", value: LBTPL_COMMAND });
            attrs.push({ type: "label", name: "command", value: item.command });
        } else if (item.builtinWidget) {
            if (item.builtinWidget === "spacer") {
                attrs.push({ type: "relation", name: "template", value: LBTPL_SPACER });
                attrs.push({ type: "label", name: "baseSize", value: item.baseSize });
                attrs.push({ type: "label", name: "growthFactor", value: item.growthFactor });
            } else {
                attrs.push({ type: "relation", name: "template", value: LBTPL_WIDGET });
            }

            attrs.push({ type: "label", name: "builtinWidget", value: item.builtinWidget });
        } else if (item.targetNoteId) {
            attrs.push({ type: "relation", name: "template", value: LBTPL_NOTE_LAUNCHER });
            attrs.push({ type: "relation", name: "target", value: item.targetNoteId });
        } else {
            throw new Error(`No action defined for launcher ${JSON.stringify(item)}`);
        }
    }

    const shouldRestoreNames = extraOpts.restoreNames || note.noteId.startsWith("_help") || item.id.startsWith("_lb") || item.id.startsWith("_template");
    if (shouldRestoreNames && note.title !== item.title) {
        note.title = item.title;
        note.save();
    }

    if (note.type !== item.type) {
        // enforce a correct note type
        note.type = item.type;
        note.save();
    }

    if (branch) {
        // in case of launchers the branch ID is not preserved and should not be relied upon - launchers which move between
        // visible and available will change branch since the branch's parent-child relationship is immutable
        if (item.notePosition !== undefined && branch.notePosition !== item.notePosition) {
            branch.notePosition = item.notePosition;
            branch.save();
        }

        if (item.isExpanded !== undefined && branch.isExpanded !== item.isExpanded) {
            branch.isExpanded = item.isExpanded;
            branch.save();
        }
    }

    // Enforce attribute structure if needed.
    if (item.enforceAttributes) {
        for (const attribute of note.getAttributes()) {
            // Remove unwanted attributes.
            const attrDef = attrs.find(a => a.name === attribute.name);
            if (!attrDef) {
                attribute.markAsDeleted();
                continue;
            }

            // Ensure value is consistent.
            if (attribute.value !== attrDef.value) {
                note.setAttributeValueById(attribute.attributeId, attrDef.value);
            }
        }
    }

    for (const attr of attrs) {
        const attrId = note.noteId + "_" + attr.type.charAt(0) + attr.name;

        const existingAttribute = note.getAttributes().find((attr) => attr.attributeId === attrId);

        if (!existingAttribute) {
            new BAttribute({
                attributeId: attrId,
                noteId: note.noteId,
                type: attr.type,
                name: attr.name,
                value: attr.value,
                isInheritable: attr.isInheritable
            }).save();
        } else if (attr.name === "docName" || (existingAttribute.noteId.startsWith("_help") && attr.name === "iconClass")) {
            if (existingAttribute.value !== attr.value) {
                log.info(`Updating attribute ${attrId} from "${existingAttribute.value}" to "${attr.value}"`);
                existingAttribute.value = attr.value ?? "";
                existingAttribute.save();
            }
        }
    }

    for (const child of item.children || []) {
        checkHiddenSubtreeRecursively(item.id, child, extraOpts);
    }
}

export default {
    checkHiddenSubtree
};
