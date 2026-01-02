import "jquery.fancytree";
import "jquery.fancytree/dist/modules/jquery.fancytree.dnd5.js";
import "jquery.fancytree/dist/modules/jquery.fancytree.clones.js";
import "jquery.fancytree/dist/modules/jquery.fancytree.filter.js";
import "../stylesheets/tree.css";

import appContext, { type CommandListenerData, type EventData } from "../components/app_context.js";
import type { SetNoteOpts } from "../components/note_context.js";
import type { TouchBarItem } from "../components/touch_bar.js";
import type FBranch from "../entities/fbranch.js";
import type FNote from "../entities/fnote.js";
import type { NoteType } from "../entities/fnote.js";
import contextMenu from "../menus/context_menu.js";
import type { TreeCommandNames } from "../menus/tree_context_menu.js";
import branchService from "../services/branches.js";
import clipboard from "../services/clipboard.js";
import dialogService from "../services/dialog.js";
import froca from "../services/froca.js";
import hoistedNoteService from "../services/hoisted_note.js";
import { t } from "../services/i18n.js";
import keyboardActionsService from "../services/keyboard_actions.js";
import linkService from "../services/link.js";
import type LoadResults from "../services/load_results.js";
import type { AttributeRow, BranchRow } from "../services/load_results.js";
import noteCreateService from "../services/note_create.js";
import options from "../services/options.js";
import protectedSessionService from "../services/protected_session.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import server from "../services/server.js";
import shortcutService from "../services/shortcuts.js";
import toastService from "../services/toast.js";
import treeService from "../services/tree.js";
import utils from "../services/utils.js";
import ws from "../services/ws.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";

const TPL = /*html*/`
<div class="tree-wrapper">
    <style>
    .tree-wrapper {
        flex-grow: 1;
        flex-shrink: 1;
        flex-basis: 60%;
        font-family: var(--tree-font-family);
        font-size: var(--tree-font-size);
        position: relative;
        min-height: 0;
    }

    .tree {
        height: 100%;
        overflow: auto;
        padding-bottom: 35px;
        padding-top: 5px;
    }

    .tree-actions {
        background-color: var(--launcher-pane-background-color);
        z-index: 100;
        position: absolute;
        bottom: 0;
        display: flex;
        align-items: flex-end;
        justify-content: flex-end;
        inset-inline-end: 17px;
        border-radius: 7px;
        border: 1px solid var(--main-border-color);
    }

    button.tree-floating-button {
        margin: 1px;
        font-size: 1.5em;
        padding: 5px;
        max-height: 34px;
        color: var(--launcher-pane-text-color);
        background-color: var(--button-background-color);
        border-radius: var(--button-border-radius);
        border: 1px solid transparent;
    }

    button.tree-floating-button:hover {
        border: 1px solid var(--button-border-color);
    }

    .collapse-tree-button {
        inset-inline-end: 100px;
    }

    .scroll-to-active-note-button {
        inset-inline-end: 55px;
    }

    .tree-settings-button {
        inset-inline-end: 10px;
    }

    .tree-settings-popup {
        display: none;
        position: absolute;
        background-color: var(--accented-background-color);
        border: 1px solid var(--main-border-color);
        padding: 20px;
        z-index: 1000;
        width: 340px;
        border-radius: 10px;
    }

    .tree .hidden-node-is-hidden {
        display: none;
    }
    </style>

    <div class="tree"></div>

    <div class="tree-actions">
        <button class="tree-floating-button bx bx-layer-minus collapse-tree-button"
                title="${t("note_tree.collapse-title")}"
                data-trigger-command="collapseTree"></button>

        <button class="tree-floating-button bx bx-crosshair scroll-to-active-note-button"
                title="${t("note_tree.scroll-active-title")}"
                data-trigger-command="scrollToActiveNote"></button>

        <button class="tree-floating-button bx bxs-tree tree-settings-button"
                title="${t("note_tree.tree-settings-title")}"></button>
    </div>


    <div class="tree-settings-popup">
        <h4>${t("note_tree.tree-settings-title")}</h4>
        <div class="form-check">
            <label class="form-check-label tn-checkbox">
                <input class="form-check-input hide-archived-notes" type="checkbox" value="">
                ${t("note_tree.hide-archived-notes")}
            </label>
        </div>
        <div class="form-check">
            <label class="form-check-label tn-checkbox">
                <input class="form-check-input auto-collapse-note-tree" type="checkbox" value="">
                ${t("note_tree.automatically-collapse-notes")}
                <span class="bx bx-info-circle"
                      title="${t("note_tree.automatically-collapse-notes-title")}"></span>
            </label>
        </div>

        <br/>

        <button class="btn btn-sm btn-primary save-tree-settings-button" type="submit">${t("note_tree.save-changes")}</button>
    </div>
</div>
`;

const MAX_SEARCH_RESULTS_IN_TREE = 100;

// this has to be hanged on the actual elements to effectively intercept and stop click event
const cancelClickPropagation: (e: JQuery.ClickEvent) => void = (e) => e.stopPropagation();

// TODO: Fix once we remove Node.js API from public
type Timeout = NodeJS.Timeout | string | number | undefined;

// TODO: Deduplicate with server special_notes
type LauncherType = "launcher" | "note" | "script" | "customWidget" | "spacer";

// TODO: Deduplicate with the server
interface CreateLauncherResponse {
    success: boolean;
    message: string;
    note: {
        noteId: string;
    };
}

interface ExpandedSubtreeResponse {
    branchIds: string[];
}

interface RefreshContext {
    noteIdsToUpdate: Set<string>;
    noteIdsToReload: Set<string>;
}

/**
 * The information contained within a drag event.
 */
export interface DragData {
    noteId: string;
    branchId: string;
    title: string;
}

export const TREE_CLIPBOARD_TYPE = "application/x-fancytree-node";

export default class NoteTreeWidget extends NoteContextAwareWidget {
    private $tree!: JQuery<HTMLElement>;
    private $treeActions!: JQuery<HTMLElement>;
    private $treeSettingsButton!: JQuery<HTMLElement>;
    private $treeSettingsPopup!: JQuery<HTMLElement>;
    private $saveTreeSettingsButton!: JQuery<HTMLElement>;
    private $hideArchivedNotesCheckbox!: JQuery<HTMLElement>;
    private $autoCollapseNoteTree!: JQuery<HTMLElement>;
    private treeName: "main";
    private autoCollapseTimeoutId?: Timeout;
    private lastFilteredHoistedNotePath?: string | null;
    private tree!: Fancytree.Fancytree;

    constructor() {
        super();

        this.treeName = "main"; // legacy value
    }

    doRender() {
        this.$widget = $(TPL);
        this.$tree = this.$widget.find(".tree");
        this.$treeActions = this.$widget.find(".tree-actions");

        this.$tree.on("mousedown", (e: JQuery.MouseDownEvent) => {
            const target = e.target as HTMLElement;
            if (e.button !== 0) return;

            if (target.classList.contains("unhoist-button")) {
                hoistedNoteService.unhoist();
            } else if (target.classList.contains("refresh-search-button")) {
                this.refreshSearch(e);
            } else if (target.classList.contains("add-note-button")) {
                const node = $.ui.fancytree.getNode(e as unknown as Event);
                const parentNotePath = treeService.getNotePath(node);
                noteCreateService.createNote(parentNotePath, { isProtected: node.data.isProtected });
            } else if (target.classList.contains("enter-workspace-button")) {
                const node = $.ui.fancytree.getNode(e as unknown as Event);
                this.triggerCommand("hoistNote", { noteId: node.data.noteId });
            }
        });

        // fancytree doesn't support middle click, so this is a way to support it
        this.$tree.on("mousedown", ".fancytree-title", (e) => {
            if (e.which === 2) {
                const node = $.ui.fancytree.getNode(e as unknown as Event);
                const notePath = treeService.getNotePath(node);

                if (notePath) {
                    e.stopPropagation();
                    e.preventDefault();

                    appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                        activate: !!e.shiftKey
                    });
                }
            }
        });
        this.$tree.on("mouseup", ".fancytree-title", (e) => {
            // Prevent middle click from pasting in the editor.
            if (e.which === 2) {
                e.stopPropagation();
                e.preventDefault();
            }
        });

        this.$treeSettingsPopup = this.$widget.find(".tree-settings-popup");
        this.$hideArchivedNotesCheckbox = this.$treeSettingsPopup.find(".hide-archived-notes");
        this.$autoCollapseNoteTree = this.$treeSettingsPopup.find(".auto-collapse-note-tree");

        this.$treeSettingsButton = this.$widget.find(".tree-settings-button");
        this.$treeSettingsButton.on("click", (e) => {
            if (this.$treeSettingsPopup.is(":visible")) {
                this.$treeSettingsPopup.hide();
                return;
            }

            this.$hideArchivedNotesCheckbox.prop("checked", this.hideArchivedNotes);
            this.$autoCollapseNoteTree.prop("checked", this.autoCollapseNoteTree);

            const top = this.$treeActions[0].offsetTop - (this.$treeSettingsPopup.outerHeight() ?? 0);
            const left = Math.max(0, this.$treeActions[0].offsetLeft - (this.$treeSettingsPopup.outerWidth() ?? 0) + (this.$treeActions.outerWidth() ?? 0));

            this.$treeSettingsPopup
                .css({
                    top,
                    left
                })
                .show();

            return false;
        });

        this.$treeSettingsPopup.on("click", (e) => {
            e.stopPropagation();
        });

        $(document).on("click", () => this.$treeSettingsPopup.hide());

        this.$saveTreeSettingsButton = this.$treeSettingsPopup.find(".save-tree-settings-button");
        this.$saveTreeSettingsButton.on("click", async () => {
            await this.setHideArchivedNotes(this.$hideArchivedNotesCheckbox.prop("checked"));
            await this.setAutoCollapseNoteTree(this.$autoCollapseNoteTree.prop("checked"));

            this.$treeSettingsPopup.hide();

            this.reloadTreeFromCache();
        });

        // note tree starts initializing already during render which is atypical
        Promise.all([options.initializedPromise, froca.initializedPromise]).then(() => this.initFancyTree());

        this.setupNoteTitleTooltip();
    }

    setupNoteTitleTooltip() {
        // the following will dynamically set tree item's tooltip if the whole item's text is not currently visible
        // if the whole text is visible then no tooltip is show since that's unnecessarily distracting
        // see https://github.com/zadam/trilium/pull/1120 for discussion

        // code inspired by https://gist.github.com/jtsternberg/c272d7de5b967cec2d3d
        const isEnclosing = ($container: JQuery<HTMLElement>, $sub: JQuery<HTMLElement>) => {
            const conOffset = $container.offset();
            const conDistanceFromTop = (conOffset?.top ?? 0) + ($container.outerHeight(true) ?? 0);
            const conDistanceFromLeft = (conOffset?.left ?? 0) + ($container.outerWidth(true) ?? 0);

            const subOffset = $sub.offset();
            const subDistanceFromTop = (subOffset?.top ?? 0) + ($sub.outerHeight(true) ?? 0);
            const subDistanceFromLeft = (subOffset?.left ?? 0) + ($sub.outerWidth(true) ?? 0);

            return conDistanceFromTop > subDistanceFromTop
                && (conOffset?.top ?? 0) < (subOffset?.top ?? 0)
                && conDistanceFromLeft > subDistanceFromLeft
                && (conOffset?.left ?? 0) < (subOffset?.left ?? 0);
        };

        this.$tree.on("mouseenter", "span.fancytree-title", (e) => {
            e.currentTarget.title = isEnclosing(this.$tree, $(e.currentTarget)) ? "" : e.currentTarget.innerText;
        });
    }

    get hideArchivedNotes() {
        return options.is(`hideArchivedNotes_${this.treeName}`);
    }

    async setHideArchivedNotes(val: string) {
        await options.save(`hideArchivedNotes_${this.treeName}`, val.toString());
    }

    get autoCollapseNoteTree() {
        return options.is("autoCollapseNoteTree");
    }

    async setAutoCollapseNoteTree(val: string) {
        await options.save("autoCollapseNoteTree", val.toString());
    }

    initFancyTree() {
        const treeData = [this.prepareRootNode()];

        this.$tree.fancytree({
            titlesTabbable: true,
            keyboard: true,
            extensions: ["dnd5", "clones", "filter"],
            source: treeData,
            scrollOfs: {
                top: 100,
                bottom: 100
            },
            scrollParent: this.$tree,
            minExpandLevel: 2, // root can't be collapsed
            click: (event, data): boolean => {
                this.activityDetected();

                const targetType = data.targetType;
                const node = data.node;
                const ctrlKey = utils.isCtrlKey(event);

                if (node.isSelected() && targetType === "icon") {
                    this.triggerCommand("openBulkActionsDialog", {
                        selectedOrActiveNoteIds: this.getSelectedOrActiveNoteIds(node)
                    });

                    return false;
                } else if (targetType === "title" || targetType === "icon") {
                    if (event.shiftKey && !ctrlKey) {
                        const activeNode = this.getActiveNode();

                        if (activeNode?.getParent() !== node.getParent()) {
                            return true;
                        }

                        this.clearSelectedNodes();

                        function selectInBetween(first: Fancytree.FancytreeNode, second: Fancytree.FancytreeNode) {
                            for (let i = 0; first && first !== second && i < 10000; i++) {
                                first.setSelected(true);
                                first = first.getNextSibling();
                            }

                            second.setSelected();
                        }

                        if (activeNode.getIndex() < node.getIndex()) {
                            selectInBetween(activeNode, node);
                        } else {
                            selectInBetween(node, activeNode);
                        }

                        node.setFocus(true);
                    } else if (ctrlKey) {
                        const notePath = treeService.getNotePath(node);
                        appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                            activate: !!event.shiftKey
                        });
                    } else if (event.altKey) {
                        node.setSelected(!node.isSelected());
                        node.setFocus(true);
                    } else if (data.node.isActive()) {
                        // this is important for single column mobile view, otherwise it's not possible to see again previously displayed note
                        this.tree.reactivate();
                    } else {
                        node.setActive();
                    }

                    return false;
                }

                return true;
            },
            beforeActivate: (event, { node }) => {
                // hidden subtree is hidden hackily - we want it to be present in the tree so that we can switch to it
                // without reloading the whole tree, but we want it to be hidden when hoisted to root. FancyTree allows
                // filtering the display only by ascendant - i.e. if the root is visible, all the descendants are as well.
                // We solve it by hiding the hidden subtree via CSS (class "hidden-node-is-hidden"),
                // but then we need to prevent activating it, e.g. by keyboard

                if (hoistedNoteService.getHoistedNoteId() === "_hidden") {
                    // if we're hoisted in hidden subtree, we want to avoid crossing to "visible" tree,
                    // which could happen via UP key from hidden root

                    return node.data.noteId !== "root";
                }

                // we're not hoisted to hidden subtree, the only way to cross is via DOWN key to the hidden root
                return node.data.noteId !== "_hidden";
            },
            activate: async (event, data) => {
                // click event won't propagate so let's close context menu manually
                contextMenu.hide();

                // hide all dropdowns, fix calendar widget dropdown doesn't close when click on a note
                $('.dropdown-menu').parent('.dropdown').find('[data-bs-toggle="dropdown"]').dropdown('hide');

                this.clearSelectedNodes();

                const notePath = treeService.getNotePath(data.node);

                const activeNoteContext = appContext.tabManager.getActiveContext();
                const opts: SetNoteOpts = {};
                if (activeNoteContext?.viewScope?.viewMode === "contextual-help") {
                    opts.viewScope = activeNoteContext.viewScope;
                }
                await activeNoteContext?.setNote(notePath, opts);
            },
            expand: (event, data) => this.setExpanded(data.node.data.branchId, true),
            collapse: (event, data) => this.setExpanded(data.node.data.branchId, false),
            filter: {
                counter: false,
                mode: "hide",
                autoExpand: true
            },
            dnd5: {
                autoExpandMS: 600,
                preventLazyParents: false,
                dragStart: (node, data) => {
                    if (node.data.noteId === "root" || utils.isLaunchBarConfig(node.data.noteId) || node.data.noteId.startsWith("_options")) {
                        return false;
                    }

                    const notes = this.getSelectedOrActiveNodes(node).map((node) => ({
                        noteId: node.data.noteId,
                        branchId: node.data.branchId,
                        title: node.title
                    }));

                    if (notes.length === 1) {
                        linkService.createLink(notes[0].noteId, { referenceLink: true, autoConvertToImage: true }).then(($link) => data.dataTransfer.setData("text/html", $link[0].outerHTML));
                    } else {
                        Promise.all(notes.map((note) => linkService.createLink(note.noteId, { referenceLink: true, autoConvertToImage: true }))).then((links) => {
                            const $list = $("<ul>").append(...links.map(($link) => $("<li>").append($link)));

                            data.dataTransfer.setData("text/html", $list[0].outerHTML);
                        });
                    }

                    data.dataTransfer.setData("text", JSON.stringify(notes));
                    return true; // allow dragging to start
                },
                dragEnter: (node, data) => {
                    if (node.data.noteType === "search") {
                        return false;
                    } else if (node.data.noteId === "_lbRoot") {
                        return false;
                    } else if (node.data.noteId.startsWith("_options")) {
                        return false;
                    } else if (node.data.noteType === "launcher") {
                        return ["before", "after"];
                    } else if (["_lbAvailableLaunchers", "_lbVisibleLaunchers"].includes(node.data.noteId)) {
                        return ["over"];
                    }
                    return true;

                },
                dragDrop: async (node, data) => {
                    if (
                        (data.hitMode === "over" && node.data.noteType === "search") ||
                        (["after", "before"].includes(data.hitMode) && (node.data.noteId === hoistedNoteService.getHoistedNoteId() || node.getParent().data.noteType === "search"))
                    ) {
                        await dialogService.info(t("note_tree.dropping-not-allowed"));

                        return;
                    }

                    const dataTransfer = data.dataTransfer;

                    if (dataTransfer && dataTransfer.files && dataTransfer.files.length > 0) {
                        const files = [...dataTransfer.files]; // chrome has issue that dataTransfer.files empties after async operation

                        const importService = await import("../services/import.js");

                        importService.uploadFiles("notes", node.data.noteId, files, {
                            safeImport: true,
                            shrinkImages: true,
                            textImportedAsText: true,
                            codeImportedAsCode: true,
                            explodeArchives: true,
                            replaceUnderscoresWithSpaces: true
                        });
                    } else {
                        const jsonStr = dataTransfer.getData("text");
                        let notes: BranchRow[];

                        try {
                            notes = JSON.parse(jsonStr);
                        } catch (e) {
                            logError(`Cannot parse JSON '${jsonStr}' into notes for drop`);
                            return;
                        }

                        // This function MUST be defined to enable dropping of items on the tree.
                        // data.hitMode is 'before', 'after', or 'over'.

                        const selectedBranchIds = notes
                            .map((note) => note.branchId)
                            .filter((branchId) => branchId) as string[];

                        if (data.hitMode === "before") {
                            branchService.moveBeforeBranch(selectedBranchIds, node.data.branchId);
                        } else if (data.hitMode === "after") {
                            branchService.moveAfterBranch(selectedBranchIds, node.data.branchId);
                        } else if (data.hitMode === "over") {
                            branchService.moveToParentNote(selectedBranchIds, node.data.branchId);
                        } else {
                            throw new Error(`Unknown hitMode '${data.hitMode}'`);
                        }
                    }
                }
            },
            lazyLoad: (event, data) => {
                const { noteId, noteType } = data.node.data;

                if (noteType === "search") {
                    const notePath = treeService.getNotePath(data.node.getParent());

                    // this is a search cycle (search note is a descendant of its own search result)
                    if (notePath.includes(noteId)) {
                        data.result = [];
                        return;
                    }

                    data.result = froca
                        .loadSearchNote(noteId)
                        .then(() => {
                            const note = froca.getNoteFromCache(noteId);
                            if (!note) return [];

                            let childNoteIds = note.getChildNoteIds();

                            if (note.type === "search" && childNoteIds.length > MAX_SEARCH_RESULTS_IN_TREE) {
                                childNoteIds = childNoteIds.slice(0, MAX_SEARCH_RESULTS_IN_TREE);
                            }

                            return froca.getNotes(childNoteIds);
                        })
                        .then(() => {
                            const note = froca.getNoteFromCache(noteId);
                            if (!note) return [];

                            return this.prepareChildren(note);
                        });
                } else {
                    data.result = froca.loadSubTree(noteId).then((note) => this.prepareChildren(note));
                }
            },
            clones: {
                highlightActiveClones: true
            },
            async enhanceTitle (
                event: Event,
                data: {
                    node: Fancytree.FancytreeNode;
                    noteId: string;
                }
            ) {
                const node = data.node;

                if (!node.data.noteId) {
                    // if there's "non-note" node, then don't enhance
                    // this can happen for e.g. "Load error!" node
                    return;
                }

                const note = await froca.getNote(node.data.noteId, true);

                if (!note) {
                    return;
                }

                const activeNoteContext = appContext.tabManager.getActiveContext();

                const $span = $(node.span);

                $span.find(".tree-item-button").remove();
                $span.find(".note-indicator-icon").remove();

                const isHoistedNote = activeNoteContext && activeNoteContext.hoistedNoteId === note.noteId && note.noteId !== "root";

                if (note.hasLabel("workspace") && !isHoistedNote) {
                    const $enterWorkspaceButton = $(`<span class="tree-item-button tn-icon enter-workspace-button bx bx-door-open" title="${t("note_tree.hoist-this-note-workspace")}"></span>`).on(
                        "click",
                        cancelClickPropagation
                    );

                    $span.append($enterWorkspaceButton);
                }

                if (note.type === "search") {
                    const $refreshSearchButton = $(`<span class="tree-item-button tn-icon refresh-search-button bx bx-refresh" title="${t("note_tree.refresh-saved-search-results")}"></span>`).on(
                        "click",
                        cancelClickPropagation
                    );

                    $span.append($refreshSearchButton);
                }

                // TODO: Deduplicate with server's notes.ts#getAndValidateParent
                if (!["search", "launcher"].includes(note.type)
                    && !note.isOptions()
                    && !note.isLaunchBarConfig()
                    && !note.noteId.startsWith("_help")
                ) {
                    const $createChildNoteButton = $(`<span class="tree-item-button tn-icon add-note-button bx bx-plus" title="${t("note_tree.create-child-note")}"></span>`).on(
                        "click",
                        cancelClickPropagation
                    );

                    $span.append($createChildNoteButton);
                }

                if (isHoistedNote) {
                    const $unhoistButton = $(`<span class="tree-item-button tn-icon unhoist-button bx bx-door-open" title="${t("note_tree.unhoist")}"></span>`).on("click", cancelClickPropagation);

                    $span.append($unhoistButton);
                }

                // Add clone indicator with tooltip if note has multiple parents
                const parentNotes = note.getParentNotes();
                const realParents = parentNotes.filter(
                    (parent) => !["_share", "_lbBookmarks"].includes(parent.noteId) && parent.type !== "search"
                );

                if (realParents.length > 1) {
                    const parentTitles = realParents.map((p) => p.title).join(", ");
                    const tooltipText = realParents.length === 2
                        ? t("note_tree.clone-indicator-tooltip-single", { parent: realParents[1].title })
                        : t("note_tree.clone-indicator-tooltip", { count: realParents.length, parents: parentTitles });

                    const $cloneIndicator = $(`<span class="note-indicator-icon clone-indicator"></span>`);
                    $cloneIndicator.attr("title", tooltipText);
                    $span.find(".fancytree-title").append($cloneIndicator);
                }

                // Add shared indicator with tooltip if note is shared
                if (note.isShared()) {
                    const shareId = note.getOwnedLabelValue("shareAlias") || note.noteId;
                    const shareUrl = `${location.origin}${location.pathname}share/${shareId}`;
                    const tooltipText = t("note_tree.shared-indicator-tooltip-with-url", { url: shareUrl });

                    const $sharedIndicator = $(`<span class="note-indicator-icon shared-indicator"></span>`);
                    $sharedIndicator.attr("title", tooltipText);
                    $span.find(".fancytree-title").append($sharedIndicator);
                }
            },
            // this is done to automatically lazy load all expanded notes after tree load
            loadChildren: (event, data) => {
                data.node.visit((subNode) => {
                    // Load all lazy/unloaded child nodes
                    // (which will trigger `loadChildren` recursively)
                    if (subNode.isUndefined() && subNode.isExpanded()) {
                        subNode.load();
                    }
                });
            },
            select: (event, { node }) => {
                if (hoistedNoteService.getHoistedNoteId() === "root" && node.data.noteId === "_hidden" && node.isSelected()) {
                    // hidden is hackily hidden from the tree via CSS when root is hoisted
                    // make sure it's not selected by mistake, it could be e.g. deleted by mistake otherwise
                    node.setSelected(false);

                    return;
                }

                $(node.span)
                    .find(".fancytree-custom-icon")
                    .attr("title", node.isSelected() ? "Apply bulk actions on selected notes" : "");
            }
        });

        const isMobile = utils.isMobile();

        if (isMobile) {
            let showTimeout: Timeout;

            this.$tree.on("touchstart", ".fancytree-node", (e) => {
                touchStart = new Date().getTime();
                showTimeout = setTimeout(() => {
                    this.showContextMenu(e);
                }, 300);
            });

            this.$tree.on("touchmove", ".fancytree-node", (e) => {
                clearTimeout(showTimeout);
            });

            this.$tree.on("touchend", ".fancytree-node", (e) => {
                clearTimeout(showTimeout);
            });
        } else {
            this.$tree.on("contextmenu", ".fancytree-node", (e) => {
                if (!utils.isCtrlKey(e)) {
                    this.showContextMenu(e);
                } else {
                    const node = $.ui.fancytree.getNode(e as unknown as Event);
                    const notePath = treeService.getNotePath(node);
                    appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
                }
                return false; // blocks default browser right click menu
            });

            this.getHotKeys().then((hotKeys) => {
                for (const key in hotKeys) {
                    const handler = hotKeys[key];

                    shortcutService.bindElShortcut($(this.tree.$container), key, () => {
                        const node = this.tree.getActiveNode();
                        return node && handler(node, {} as JQuery.KeyDownEvent);
                        // return false from the handler will stop default handling.
                    });
                }
            });
        }

        let touchStart;

        this.tree = $.ui.fancytree.getTree(this.$tree);
    }

    showContextMenu(e: PointerEvent | JQuery.TouchStartEvent | JQuery.ContextMenuEvent) {
        const node = $.ui.fancytree.getNode(e as unknown as Event);
        const note = froca.getNoteFromCache(node.data.noteId);

        if (note?.isLaunchBarConfig()) {
            import("../menus/launcher_context_menu.js").then(({ default: LauncherContextMenu }) => {
                const launcherContextMenu = new LauncherContextMenu(this, node);
                launcherContextMenu.show(e);
            });
        } else {
            import("../menus/tree_context_menu.js").then(({ default: TreeContextMenu }) => {
                const treeContextMenu = new TreeContextMenu(this, node);
                treeContextMenu.show(e);
            });
        }
    }

    prepareRootNode() {
        const branch = froca.getBranch("none_root");
        return branch && this.prepareNode(branch);
    }

    prepareChildren(parentNote: FNote) {
        utils.assertArguments(parentNote);

        const noteList: Fancytree.FancytreeNewNode[] = [];

        const hideArchivedNotes = this.hideArchivedNotes;

        let childBranches = parentNote.getFilteredChildBranches();

        if (parentNote.type === "search" && childBranches.length > MAX_SEARCH_RESULTS_IN_TREE) {
            childBranches = childBranches.slice(0, MAX_SEARCH_RESULTS_IN_TREE);
        }

        for (const branch of childBranches) {
            if (hideArchivedNotes) {
                const note = branch.getNoteFromCache();

                if (!note || note.hasLabel("archived")) {
                    continue;
                }
            }

            const node = this.prepareNode(branch);
            if (node) {
                noteList.push(node);
            }
        }

        return noteList;
    }

    async updateNode(node: Fancytree.FancytreeNode) {
        const note = froca.getNoteFromCache(node.data.noteId);
        const branch = froca.getBranch(node.data.branchId);

        if (!note) {
            console.log(`Node update not possible because note '${node.data.noteId}' was not found.`);
            return;
        } else if (!branch) {
            console.log(`Node update not possible because branch '${node.data.branchId}' was not found.`);
            return;
        }

        const title = `${branch.prefix ? `${branch.prefix} - ` : ""}${note.title}`;

        node.data.isProtected = note.isProtected;
        node.data.noteType = note.type;
        node.folder = note.isFolder();
        node.icon = note.getIcon();
        node.extraClasses = this.getExtraClasses(note);
        node.title = utils.escapeHtml(title);

        if (node.isExpanded() !== branch.isExpanded) {
            await node.setExpanded(branch.isExpanded, { noEvents: true, noAnimation: true });
        }

        node.renderTitle();
    }

    prepareNode(branch: FBranch, forceLazy = false) {
        const note = branch.getNoteFromCache();

        if (!note) {
            console.warn(`Branch '${branch.branchId}' has no child note '${branch.noteId}'`);
            return null;
        }

        const title = `${branch.prefix ? `${branch.prefix} - ` : ""}${note.title}`;

        const isFolder = note.isFolder();

        const node: Fancytree.FancytreeNewNode = {
            noteId: note.noteId,
            parentNoteId: branch.parentNoteId,
            branchId: branch.branchId,
            isProtected: note.isProtected,
            noteType: note.type,
            title: utils.escapeHtml(title),
            extraClasses: this.getExtraClasses(note),
            icon: note.getIcon(),
            refKey: note.noteId,
            lazy: true,
            folder: isFolder,
            expanded: !!branch.isExpanded && note.type !== "search",
            key: utils.randomString(12) // this should prevent some "duplicate key" errors
        };

        if (isFolder && node.expanded && !forceLazy) {
            node.children = this.prepareChildren(note);
        }

        return node;
    }

    getExtraClasses(note: FNote) {
        utils.assertArguments(note);

        const extraClasses: string[] = [];

        if (note.isProtected) {
            extraClasses.push("protected");
        }

        if (note.isShared()) {
            extraClasses.push("shared");
        }

        if (note.getParentNoteIds().length > 1) {
            const realClones = note
                .getParentNoteIds()
                .map((noteId: string) => froca.notes[noteId])
                .filter((note: FNote) => !!note)
                .filter((note: FNote) => !["_share", "_lbBookmarks"].includes(note.noteId) && note.type !== "search");

            if (realClones.length > 1) {
                extraClasses.push("multiple-parents");
            }
        }

        const cssClass = note.getCssClass();

        if (cssClass) {
            extraClasses.push(cssClass);
        }

        extraClasses.push(utils.getNoteTypeClass(note.type));

        if (note.mime) {
            // some notes should not have mime type (e.g. render)
            extraClasses.push(utils.getMimeTypeClass(note.mime));
        }

        if (note.hasLabel("archived")) {
            extraClasses.push("archived");
        }

        const colorClass = note.getColorClass();

        if (colorClass) {
            extraClasses.push(...["tinted", colorClass]);
        }

        return extraClasses.join(" ");
    }

    getSelectedNodes(stopOnParents = false) {
        return this.tree.getSelectedNodes(stopOnParents);
    }

    getSelectedOrActiveNodes(node: Fancytree.FancytreeNode | null = null) {
        const nodes = this.getSelectedNodes(true);

        // the node you start dragging should be included even if not selected
        if (node && !nodes.find((n) => n.key === node.key)) {
            nodes.push(node);
        }

        const activeNode = this.getActiveNode();
        if (nodes.length === 0 && activeNode) {
            nodes.push(activeNode);
        }

        // hidden subtree is hackily hidden via CSS when hoisted to root
        // make sure it's never selected for e.g. deletion in such a case
        return nodes.filter((node) => hoistedNoteService.getHoistedNoteId() !== "root" || node.data.noteId !== "_hidden");
    }

    async setExpandedStatusForSubtree(node: Fancytree.FancytreeNode | null, isExpanded: boolean) {
        if (!node) {
            const hoistedNoteId = hoistedNoteService.getHoistedNoteId();

            node = this.getNodesByNoteId(hoistedNoteId)[0];
        }

        const { branchIds } = await server.put<ExpandedSubtreeResponse>(`branches/${node.data.branchId}/expanded-subtree/${isExpanded ? 1 : 0}`);

        froca.getBranches(branchIds, true).forEach((branch) => (branch.isExpanded = !!isExpanded));

        await this.batchUpdate(async () => {
            await node.load(true);

            if (node.data.noteId !== hoistedNoteService.getHoistedNoteId()) {
                // hoisted note should always be expanded
                await node.setExpanded(isExpanded, { noEvents: true, noAnimation: true });
            }
        });

        await this.filterHoistedBranch(true);

        // don't activate the active note, see discussion in https://github.com/zadam/trilium/issues/3664
    }

    async expandTree(node: Fancytree.FancytreeNode | null = null) {
        await this.setExpandedStatusForSubtree(node, true);
    }

    async collapseTree(node: Fancytree.FancytreeNode | null = null) {
        await this.setExpandedStatusForSubtree(node, false);
    }

    collapseTreeEvent() {
        this.collapseTree();
    }

    getActiveNode() {
        return this.tree.getActiveNode();
    }

    /**
     * focused & not active node can happen during multiselection where the node is selected
     * but not activated (its content is not displayed in the detail)
     * @returns {FancytreeNode|null}
     */
    getFocusedNode() {
        return this.tree.getFocusNode();
    }

    clearSelectedNodes() {
        for (const selectedNode of this.getSelectedNodes()) {
            selectedNode.setSelected(false);
        }
    }

    async scrollToActiveNoteEvent() {
        const activeContext = appContext.tabManager.getActiveContext();

        if (activeContext && activeContext.notePath) {
            this.tree.$container.focus();
            this.tree.setFocus(true);

            const node = await this.expandToNote(activeContext.notePath);

            if (node) {
                await node.makeVisible({ scrollIntoView: true });
                node.setActive(true, { noEvents: true, noFocus: false });
            }
        }
    }

    async focusTreeEvent() {
        this.tree.$container.focus();
        this.tree.setFocus(true);
    }

    async getNodeFromPath(notePath: string, expand = false, logErrors = true) {
        utils.assertArguments(notePath);
        /** @let {FancytreeNode} */
        let parentNode = this.getNodesByNoteId("root")[0];

        let resolvedNotePathSegments = await treeService.resolveNotePathToSegments(notePath, this.hoistedNoteId, logErrors);

        if (!resolvedNotePathSegments) {
            if (logErrors) {
                logError("Could not find run path for notePath:", notePath);
            }

            return;
        }

        resolvedNotePathSegments = resolvedNotePathSegments.slice(1);

        for (const childNoteId of resolvedNotePathSegments) {
            // we expand only after hoisted note since before then nodes are not actually present in the tree
            if (parentNode) {
                if (!parentNode.isLoaded()) {
                    await parentNode.load();
                }

                if (expand) {
                    if (!parentNode.isExpanded()) {
                        await parentNode.setExpanded(true, { noAnimation: true });
                    }

                    // although the previous line should set the expanded status, it seems to happen asynchronously,
                    // so we need to make sure it is set properly before calling updateNode which uses this flag
                    const branch = froca.getBranch(parentNode.data.branchId);
                    if (branch) {
                        branch.isExpanded = true;
                    }
                }

                await this.updateNode(parentNode);

                let foundChildNode = this.findChildNode(parentNode, childNoteId);

                if (!foundChildNode) {
                    // note might be recently created, so we'll force reload and try again
                    await parentNode.load(true);

                    foundChildNode = this.findChildNode(parentNode, childNoteId);

                    if (!foundChildNode) {
                        if (logErrors) {
                            // besides real errors, this can be also caused by hiding of e.g. included images
                            // these are real notes with real notePath, user can display them in a detail,
                            // but they don't have a node in the tree

                            const childNote = await froca.getNote(childNoteId);

                            if (!childNote || childNote.type !== "image") {
                                ws.logError(
                                    `Can't find node for child node of noteId=${childNoteId} for parent of noteId=${parentNode.data.noteId} and hoistedNoteId=${hoistedNoteService.getHoistedNoteId()}, requested path is ${notePath}`
                                );
                            }
                        }

                        return;
                    }
                }

                parentNode = foundChildNode;
            }
        }

        return parentNode;
    }

    findChildNode(parentNode: Fancytree.FancytreeNode, childNoteId: string) {
        return parentNode.getChildren().find((childNode) => childNode.data.noteId === childNoteId);
    }

    async expandToNote(notePath: string, logErrors = true) {
        return this.getNodeFromPath(notePath, true, logErrors);
    }

    getNodesByBranch(branch: BranchRow) {
        utils.assertArguments(branch);

        if (!branch.noteId) {
            return [];
        }

        return this.getNodesByNoteId(branch.noteId).filter((node) => node.data.branchId === branch.branchId);
    }

    getNodesByNoteId(noteId: string) {
        utils.assertArguments(noteId);

        const list = this.tree.getNodesByRef(noteId);
        return list ? list : []; // if no nodes with this refKey are found, fancy tree returns null
    }

    isEnabled() {
        return !!this.noteContext;
    }

    async refresh() {
        this.toggleInt(this.isEnabled());
        this.$treeSettingsPopup.hide();

        this.activityDetected();

        const oldActiveNode = this.getActiveNode();

        const newActiveNode =
            this.noteContext?.notePath &&
            (!treeService.isNotePathInHiddenSubtree(this.noteContext.notePath) || (await hoistedNoteService.isHoistedInHiddenSubtree())) &&
            (await this.getNodeFromPath(this.noteContext.notePath));

        if (newActiveNode !== oldActiveNode) {
            let oldActiveNodeFocused = false;

            if (oldActiveNode) {
                oldActiveNodeFocused = oldActiveNode.hasFocus();

                oldActiveNode.setActive(false);
                oldActiveNode.setFocus(false);
            }

            if (newActiveNode) {
                if (!newActiveNode.isVisible() && this.noteContext?.notePath) {
                    await this.expandToNote(this.noteContext.notePath);
                }

                newActiveNode.setActive(true, { noEvents: true, noFocus: !oldActiveNodeFocused });
                newActiveNode.makeVisible({ scrollIntoView: true });
            }
        }

        this.filterHoistedBranch(false);
    }

    async refreshSearch(e: JQuery.MouseDownEvent) {
        const activeNode = $.ui.fancytree.getNode(e as unknown as Event);

        activeNode.load(true);
        activeNode.setExpanded(true, { noAnimation: true });

        toastService.showMessage(t("note_tree.saved-search-note-refreshed"));
    }

    async batchUpdate(cb: () => Promise<void>) {
        try {
            // disable rendering during update for increased performance
            this.tree.enableUpdate(false);

            await cb();
        } finally {
            this.tree.enableUpdate(true);
        }
    }

    activityDetected() {
        if (this.autoCollapseTimeoutId) {
            clearTimeout(this.autoCollapseTimeoutId);
        }

        this.autoCollapseTimeoutId = setTimeout(() => {
            if (!this.autoCollapseNoteTree) {
                return;
            }

            /*
             * We're collapsing notes after a period of inactivity to "cleanup" the tree - users rarely
             * collapse the notes and the tree becomes unusuably large.
             * Some context: https://github.com/zadam/trilium/issues/1192
             */

            const noteIdsToKeepExpanded = new Set(
                appContext.tabManager
                    .getNoteContexts()
                    .map((nc) => nc.notePathArray)
                    .flat()
            );

            let noneCollapsedYet = true;

            if (!options.is("databaseReadonly")) {
                // can't change expanded notes when database is readonly
                this.tree.getRootNode().visit((node) => {
                    if (node.isExpanded() && !noteIdsToKeepExpanded.has(node.data.noteId)) {
                        node.setExpanded(false);

                        if (noneCollapsedYet) {
                            toastService.showMessage(t("note_tree.auto-collapsing-notes-after-inactivity"));
                            noneCollapsedYet = false;
                        }
                    }
                }, false);
            }

            this.filterHoistedBranch(true);
        }, 600 * 1000);
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        this.activityDetected();

        if (loadResults.isEmptyForTree()) {
            return;
        }

        const activeNode = this.getActiveNode();
        const activeNodeFocused = !!activeNode?.hasFocus();
        const activeNotePath = activeNode ? treeService.getNotePath(activeNode) : null;

        const refreshCtx: RefreshContext = {
            noteIdsToUpdate: new Set(),
            noteIdsToReload: new Set()
        };

        this.#processAttributeRows(loadResults.getAttributeRows(), refreshCtx);

        const branchRows = loadResults.getBranchRows();
        const { movedActiveNode, parentsOfAddedNodes } = await this.#processBranchRows(branchRows, refreshCtx);

        for (const noteId of loadResults.getNoteIds()) {
            refreshCtx.noteIdsToUpdate.add(noteId);
        }

        await this.#executeTreeUpdates(refreshCtx, loadResults);

        await this.#setActiveNode(activeNotePath, activeNodeFocused, movedActiveNode, parentsOfAddedNodes);

        if (refreshCtx.noteIdsToReload.size > 0 || refreshCtx.noteIdsToUpdate.size > 0) {
            // workaround for https://github.com/mar10/fancytree/issues/1054
            this.filterHoistedBranch(true);
        }
    }

    #processAttributeRows(attributeRows: AttributeRow[], refreshCtx: RefreshContext) {
        for (const attrRow of attributeRows) {
            const dirtyingLabels = ["iconClass", "cssClass", "workspace", "workspaceIconClass", "color"];

            if (attrRow.type === "label" && dirtyingLabels.includes(attrRow.name ?? "") && attrRow.noteId) {
                if (attrRow.isInheritable) {
                    refreshCtx.noteIdsToReload.add(attrRow.noteId);
                } else {
                    refreshCtx.noteIdsToUpdate.add(attrRow.noteId);
                }
            } else if (attrRow.type === "label" && attrRow.name === "archived" && attrRow.noteId) {
                const note = froca.getNoteFromCache(attrRow.noteId);

                if (note) {
                    // change of archived status can mean the note should not be displayed in the tree at all
                    // depending on the value of this.hideArchivedNotes
                    for (const parentNote of note.getParentNotes()) {
                        refreshCtx.noteIdsToReload.add(parentNote.noteId);
                    }
                }
            } else if (attrRow.type === "relation" && (attrRow.name === "template" || attrRow.name === "inherit") && attrRow.noteId) {
                // missing handling of things inherited from template
                refreshCtx.noteIdsToReload.add(attrRow.noteId);
            } else if (attrRow.type === "relation" && attrRow.name === "imageLink" && attrRow.noteId) {
                const note = froca.getNoteFromCache(attrRow.noteId);

                if (note && note.getChildNoteIds().includes(attrRow.value ?? "")) {
                    // there's a new /deleted imageLink between note and its image child - which can show/hide
                    // the image (if there is an imageLink relation between parent and child,
                    // then it is assumed to be "contained" in the note and thus does not have to be displayed in the tree)
                    refreshCtx.noteIdsToReload.add(attrRow.noteId);
                }
            }
        }
    }

    async #processBranchRows(branchRows: BranchRow[], refreshCtx: RefreshContext) {
        const allBranchesDeleted = branchRows.every((branchRow) => !!branchRow.isDeleted);

        // activeNode is supposed to be moved when we find out activeNode is deleted but not all branches are deleted. save it for fixing activeNodePath after all nodes loaded.
        let movedActiveNode: Fancytree.FancytreeNode | null = null;
        const parentsOfAddedNodes: Fancytree.FancytreeNode[] = [];

        for (const branchRow of branchRows) {
            if (branchRow.noteId) {
                if (branchRow.parentNoteId === "_share") {
                    // all shared notes have a sign in the tree, even the descendants of shared notes
                    refreshCtx.noteIdsToReload.add(branchRow.noteId);
                } else {
                    // adding noteId itself to update all potential clones
                    refreshCtx.noteIdsToUpdate.add(branchRow.noteId);
                }
            }

            if (branchRow.isDeleted) {
                for (const node of this.getNodesByBranch(branchRow)) {
                    if (node.isActive()) {
                        if (allBranchesDeleted) {
                            const newActiveNode = node.getNextSibling() || node.getPrevSibling() || node.getParent();

                            if (newActiveNode) {
                                newActiveNode.setActive(true, { noEvents: true, noFocus: true });
                            }
                        } else {
                            movedActiveNode = node;
                        }
                    }

                    if (node.getParent()) {
                        node.remove();
                    }

                    if (branchRow.parentNoteId) {
                        refreshCtx.noteIdsToUpdate.add(branchRow.parentNoteId);
                    }
                }
            } else if (branchRow.parentNoteId) {
                for (const parentNode of this.getNodesByNoteId(branchRow.parentNoteId)) {
                    parentsOfAddedNodes.push(parentNode);

                    if (!branchRow.noteId || (parentNode.isFolder() && !parentNode.isLoaded())) {
                        continue;
                    }

                    const note = await froca.getNote(branchRow.noteId);
                    const frocaBranch = branchRow.branchId ? froca.getBranch(branchRow.branchId) : null;
                    const foundNode = (parentNode.getChildren() || []).find((child) => child.data.noteId === branchRow.noteId);
                    if (foundNode) {
                        // the branch already exists in the tree
                        if (branchRow.isExpanded !== foundNode.isExpanded() && frocaBranch) {
                            refreshCtx.noteIdsToReload.add(frocaBranch.noteId);
                        }
                    } else if (frocaBranch) {
                        // make sure it's loaded
                        // we're forcing lazy since it's not clear if the whole required subtree is in froca
                        const newNode = this.prepareNode(frocaBranch, true);
                        if (newNode) {
                            parentNode.addChildren([newNode]);
                        }

                        if (frocaBranch?.isExpanded && note && note.hasChildren()) {
                            refreshCtx.noteIdsToReload.add(frocaBranch.noteId);
                        }

                        this.sortChildren(parentNode);

                        // this might be a first child which would force an icon change
                        if (branchRow.parentNoteId) {
                            refreshCtx.noteIdsToUpdate.add(branchRow.parentNoteId);
                        }
                    }
                }
            }
        }

        return {
            movedActiveNode,
            parentsOfAddedNodes
        };
    }

    async #executeTreeUpdates(refreshCtx: RefreshContext, loadResults: LoadResults) {
        await this.batchUpdate(async () => {
            for (const noteId of refreshCtx.noteIdsToReload) {
                for (const node of this.getNodesByNoteId(noteId)) {
                    await node.load(true);

                    refreshCtx.noteIdsToUpdate.add(noteId);
                }
            }

            for (const parentNoteId of loadResults.getNoteReorderings()) {
                for (const node of this.getNodesByNoteId(parentNoteId)) {
                    if (node.isLoaded()) {
                        this.sortChildren(node);
                    }
                }
            }
        });

        // for some reason, node update cannot be in the batchUpdate() block (node is not re-rendered)
        for (const noteId of refreshCtx.noteIdsToUpdate) {
            for (const node of this.getNodesByNoteId(noteId)) {
                await this.updateNode(node);
            }
        }
    }

    async #setActiveNode(activeNotePath: string | null, activeNodeFocused: boolean, movedActiveNode: Fancytree.FancytreeNode | null, parentsOfAddedNodes: Fancytree.FancytreeNode[]) {
        if (movedActiveNode) {
            for (const parentNode of parentsOfAddedNodes) {
                const foundNode = (parentNode.getChildren() || []).find((child) => child.data.noteId === movedActiveNode.data.noteId);
                if (foundNode) {
                    activeNotePath = treeService.getNotePath(foundNode);
                    break;
                }
            }
        }

        if (!activeNotePath) {
            return;
        }

        let node: Fancytree.FancytreeNode | null | undefined = await this.expandToNote(activeNotePath, false);

        if (node && node.data.noteId !== treeService.getNoteIdFromUrl(activeNotePath)) {
            // if the active note has been moved elsewhere then it won't be found by the path,
            // so we switch to the alternative of trying to find it by noteId
            const noteId = treeService.getNoteIdFromUrl(activeNotePath);

            if (noteId) {
                const notesById = this.getNodesByNoteId(noteId);

                // if there are multiple clones, then we'd rather not activate anyone
                node = notesById.length === 1 ? notesById[0] : null;
            }
        }

        if (!node) {
            return;
        }

        if (activeNodeFocused) {
            // needed by Firefox: https://github.com/zadam/trilium/issues/1865
            this.tree.$container.focus();
        }

        await node.setActive(true, { noEvents: true, noFocus: !activeNodeFocused });
    }

    sortChildren(node: Fancytree.FancytreeNode) {
        node.sortChildren((nodeA, nodeB) => {
            const branchA = froca.branches[nodeA.data.branchId];
            const branchB = froca.branches[nodeB.data.branchId];

            if (!branchA || !branchB) {
                return 0;
            }

            return branchA.notePosition - branchB.notePosition;
        });
    }

    setExpanded(branchId: string, isExpanded: boolean) {
        utils.assertArguments(branchId);

        const branch = froca.getBranch(branchId, true);

        if (!branch) {
            if (branchId && branchId.startsWith("virt")) {
                // in case of virtual branches there's nothing to update
                return;
            }
            logError(`Cannot find branch=${branchId}`);
            return;

        }

        branch.isExpanded = isExpanded;

        server.put(`branches/${branchId}/expanded/${isExpanded ? 1 : 0}`);
    }

    async reloadTreeFromCache() {
        const activeNode = this.getActiveNode();

        const activeNotePath = activeNode !== null ? treeService.getNotePath(activeNode) : null;

        const rootNode = this.prepareRootNode();

        await this.batchUpdate(async () => {
            await this.tree.reload([rootNode]);
        });

        await this.filterHoistedBranch(true);

        if (activeNotePath) {
            const node = await this.getNodeFromPath(activeNotePath, true);

            if (node) {
                await node.setActive(true, { noEvents: true, noFocus: true });
            }
        }
    }

    async hoistedNoteChangedEvent({ ntxId }: EventData<"hoistedNoteChanged">) {
        if (this.isNoteContext(ntxId)) {
            await this.filterHoistedBranch(true);
        }
    }

    async filterHoistedBranch(forceUpdate = false) {
        if (!this.noteContext) {
            return;
        }

        const hoistedNotePath = await treeService.resolveNotePath(this.noteContext.hoistedNoteId);

        if (!forceUpdate && this.lastFilteredHoistedNotePath === hoistedNotePath) {
            // no need to re-filter if the hoisting did not change
            // (helps with flickering on simple note change with large subtrees)
            return;
        }

        this.lastFilteredHoistedNotePath = hoistedNotePath;

        if (hoistedNotePath) {
            await this.getNodeFromPath(hoistedNotePath);
        }

        if (this.noteContext.hoistedNoteId === "root") {
            this.tree.clearFilter();
            this.toggleHiddenNode(false); // show everything but the hidden subtree
        } else {
            // hack when hoisted note is cloned then it could be filtered multiple times while we want only 1
            this.tree.filterBranches(
                (node) =>
                    node.data.noteId === this.noteContext?.hoistedNoteId && // optimization to not having always resolve the node path
                    treeService.getNotePath(node) === hoistedNotePath
            );

            this.toggleHiddenNode(true); // hoisting will handle hidden note visibility

            // Automatically expand the hoisted note by default
            const node = this.getActiveNode();
            if (node && node.data.noteId === this.noteContext.hoistedNoteId){
                this.setExpanded(node.data.branchId, true);
            }
        }
    }

    toggleHiddenNode(show: boolean) {
        const hiddenNode = this.getNodesByNoteId("_hidden")[0];
        // TODO: Check how .li exists here.
        $((hiddenNode as any).li).toggleClass("hidden-node-is-hidden", !show);
    }

    async frocaReloadedEvent() {
        this.reloadTreeFromCache();
    }

    async getHotKeys() {
        const actions = await keyboardActionsService.getActionsForScope("note-tree");
        const hotKeyMap: Record<string, (node: Fancytree.FancytreeNode, e: JQuery.KeyDownEvent) => boolean> = {};

        for (const action of actions) {
            for (const shortcut of action.effectiveShortcuts ?? []) {
                hotKeyMap[shortcutService.normalizeShortcut(shortcut)] = (node) => {
                    const notePath = treeService.getNotePath(node);

                    this.triggerCommand(action.actionName, { node, notePath });

                    return false;
                };
            }
        }

        return hotKeyMap;
    }

    getSelectedOrActiveBranchIds(node: Fancytree.FancytreeNode) {
        const nodes = this.getSelectedOrActiveNodes(node);

        return nodes.map((node) => node.data.branchId);
    }

    getSelectedOrActiveNoteIds(node: Fancytree.FancytreeNode): string[] {
        const nodes = this.getSelectedOrActiveNodes(node);

        return nodes.map((node) => node.data.noteId);
    }

    async deleteNotesCommand({ node }: CommandListenerData<"deleteNotes">) {
        const branchIds = this.getSelectedOrActiveBranchIds(node).filter((branchId) => !branchId.startsWith("virt-")); // search results can't be deleted

        if (!branchIds.length) {
            return;
        }

        await branchService.deleteNotes(branchIds);

        this.clearSelectedNodes();
    }

    async editBranchPrefixCommand({ node }: CommandListenerData<"editBranchPrefix">) {
        const branchIds = this.getSelectedOrActiveBranchIds(node).filter((branchId) => !branchId.startsWith("virt-"));

        if (!branchIds.length) {
            return;
        }

        // Trigger the event with the selected branch IDs
        appContext.triggerEvent("editBranchPrefix", {
            selectedOrActiveBranchIds: branchIds,
            node
        });
    }

    canBeMovedUpOrDown(node: Fancytree.FancytreeNode) {
        if (node.data.noteId === "root") {
            return false;
        }

        const parentNote = froca.getNoteFromCache(node.getParent().data.noteId);

        return !parentNote?.hasLabel("sorted");
    }

    async moveNoteUpCommand({ node }: CommandListenerData<"moveNoteUp">) {
        if (!node || !this.canBeMovedUpOrDown(node)) {
            return;
        }

        const beforeNode = node.getPrevSibling();

        if (beforeNode !== null) {
            await branchService.moveBeforeBranch([node.data.branchId], beforeNode.data.branchId);
            node.makeVisible({ scrollIntoView: true });
        }
    }

    async moveNoteDownCommand({ node }: CommandListenerData<"moveNoteDown">) {
        if (!this.canBeMovedUpOrDown(node)) {
            return;
        }

        const afterNode = node.getNextSibling();

        if (afterNode !== null) {
            await branchService.moveAfterBranch([node.data.branchId], afterNode.data.branchId);
            node.makeVisible({ scrollIntoView: true });
        }
    }

    moveNoteUpInHierarchyCommand({ node }: CommandListenerData<"moveNoteUpInHierarchy">) {
        branchService.moveNodeUpInHierarchy(node);
    }

    moveNoteDownInHierarchyCommand({ node }: CommandListenerData<"moveNoteDownInHierarchy">) {
        const toNode = node.getPrevSibling();

        if (toNode !== null) {
            branchService.moveToParentNote([node.data.branchId], toNode.data.branchId);
        }
    }

    addNoteAboveToSelectionCommand() {
        const node = this.getFocusedNode();

        if (!node) {
            return;
        }

        if (node.isActive()) {
            node.setSelected(true);
        }

        const prevSibling = node.getPrevSibling();

        if (prevSibling) {
            prevSibling.setActive(true, { noEvents: true });

            if (prevSibling.isSelected()) {
                node.setSelected(false);
            }

            prevSibling.setSelected(true);
        }
    }

    addNoteBelowToSelectionCommand() {
        const node = this.getFocusedNode();

        if (!node) {
            return;
        }

        if (node.isActive()) {
            node.setSelected(true);
        }

        const nextSibling = node.getNextSibling();

        if (nextSibling) {
            nextSibling.setActive(true, { noEvents: true });

            if (nextSibling.isSelected()) {
                node.setSelected(false);
            }

            nextSibling.setSelected(true);
        }
    }

    expandSubtreeCommand({ node }: CommandListenerData<"expandSubtree">) {
        this.expandTree(node);
    }

    collapseSubtreeCommand({ node }: CommandListenerData<"collapseSubtree">) {
        this.collapseTree(node);
    }

    async recentChangesInSubtreeCommand({ node }: CommandListenerData<"recentChangesInSubtree">) {
        this.triggerCommand("showRecentChanges", { ancestorNoteId: node.data.noteId });
    }

    selectAllNotesInParentCommand({ node }: CommandListenerData<"selectAllNotesInParent">) {
        for (const child of node.getParent().getChildren()) {
            child.setSelected(true);
        }
    }

    copyNotesToClipboardCommand({ node }: CommandListenerData<"copyNotesToClipboard">) {
        clipboard.copy(this.getSelectedOrActiveBranchIds(node));
    }

    cutNotesToClipboardCommand({ node }: CommandListenerData<"cutNotesToClipboard">) {
        clipboard.cut(this.getSelectedOrActiveBranchIds(node));
    }

    pasteNotesFromClipboardCommand({ node }: CommandListenerData<"pasteNotesFromClipboard">) {
        clipboard.pasteInto(node.data.branchId);
    }

    pasteNotesAfterFromClipboardCommand({ node }: CommandListenerData<"pasteNotesAfterFromClipboard">) {
        clipboard.pasteAfter(node.data.branchId);
    }

    async exportNoteCommand({ node }: CommandListenerData<"exportNote">) {
        const notePath = treeService.getNotePath(node);

        this.triggerCommand("showExportDialog", { notePath, defaultType: "subtree" });
    }

    async importIntoNoteCommand({ node }: CommandListenerData<"importIntoNote">) {
        this.triggerCommand("showImportDialog", { noteId: node.data.noteId });
    }

    editNoteTitleCommand() {
        appContext.triggerCommand("focusOnTitle");
    }

    protectSubtreeCommand({ node }: CommandListenerData<"protectSubtree">) {
        protectedSessionService.protectNote(node.data.noteId, true, true);
    }

    unprotectSubtreeCommand({ node }: CommandListenerData<"unprotectSubtree">) {
        protectedSessionService.protectNote(node.data.noteId, false, true);
    }

    duplicateSubtreeCommand({ node }: CommandListenerData<"duplicateSubtree">) {
        const nodesToDuplicate = this.getSelectedOrActiveNodes(node);

        for (const nodeToDuplicate of nodesToDuplicate) {
            const note = froca.getNoteFromCache(nodeToDuplicate.data.noteId);

            if (note?.isProtected && !protectedSessionHolder.isProtectedSessionAvailable()) {
                continue;
            }

            const branch = froca.getBranch(nodeToDuplicate.data.branchId);

            if (branch?.parentNoteId) {
                noteCreateService.duplicateSubtree(nodeToDuplicate.data.noteId, branch.parentNoteId);
            }
        }
    }

    moveLauncherToVisibleCommand({ selectedOrActiveBranchIds }: CommandListenerData<"moveLauncherToVisible">) {
        this.#moveLaunchers(selectedOrActiveBranchIds, "_lbVisibleLaunchers", "_lbMobileVisibleLaunchers");
    }

    moveLauncherToAvailableCommand({ selectedOrActiveBranchIds }: CommandListenerData<"moveLauncherToAvailable">) {
        this.#moveLaunchers(selectedOrActiveBranchIds, "_lbAvailableLaunchers", "_lbMobileAvailableLaunchers");
    }

    #moveLaunchers(selectedOrActiveBranchIds: string[], desktopParent: string, mobileParent: string) {
        const desktopLaunchersToMove = selectedOrActiveBranchIds.filter((branchId) => !branchId.startsWith("_lbMobile"));
        if (desktopLaunchersToMove) {
            branchService.moveToParentNote(desktopLaunchersToMove, `_lbRoot_${  desktopParent}`);
        }

        const mobileLaunchersToMove = selectedOrActiveBranchIds.filter((branchId) => branchId.startsWith("_lbMobile"));
        if (mobileLaunchersToMove) {
            branchService.moveToParentNote(mobileLaunchersToMove, `_lbMobileRoot_${  mobileParent}`);
        }
    }

    addNoteLauncherCommand({ node }: CommandListenerData<"addNoteLauncher">) {
        this.createLauncherNote(node, "note");
    }

    addScriptLauncherCommand({ node }: CommandListenerData<"addScriptLauncher">) {
        this.createLauncherNote(node, "script");
    }

    addWidgetLauncherCommand({ node }: CommandListenerData<"addWidgetLauncher">) {
        this.createLauncherNote(node, "customWidget");
    }

    addSpacerLauncherCommand({ node }: CommandListenerData<"addSpacerLauncher">) {
        this.createLauncherNote(node, "spacer");
    }

    async createLauncherNote(node: Fancytree.FancytreeNode, launcherType: LauncherType) {
        const resp = await server.post<CreateLauncherResponse>(`special-notes/launchers/${node.data.noteId}/${launcherType}`);

        if (!resp.success) {
            toastService.showError(resp.message);
        }

        await ws.waitForMaxKnownEntityChangeId();

        appContext.tabManager.getActiveContext()?.setNote(resp.note.noteId);
    }

    buildTouchBarCommand({ TouchBar, buildIcon }: CommandListenerData<"buildTouchBar">) {
        const triggerCommand = (command: TreeCommandNames) => {
            const node = this.getActiveNode();
            if (!node) return;
            const notePath = treeService.getNotePath(node);

            this.triggerCommand<TreeCommandNames>(command, {
                node,
                notePath,
                noteId: node.data.noteId,
                selectedOrActiveBranchIds: this.getSelectedOrActiveBranchIds(node),
                selectedOrActiveNoteIds: this.getSelectedOrActiveNoteIds(node)
            });
        };

        const items: TouchBarItem[] = [
            new TouchBar.TouchBarButton({
                icon: buildIcon("NSImageNameTouchBarAddTemplate"),
                click: () => {
                    const node = this.getActiveNode();
                    if (!node) return;
                    const notePath = treeService.getNotePath(node);
                    noteCreateService.createNote(notePath, {
                        isProtected: node.data.isProtected
                    });
                }
            }),
            new TouchBar.TouchBarButton({
                icon: buildIcon("NSImageNameTouchBarDeleteTemplate"),
                click: () => triggerCommand("deleteNotes")
            })
        ];

        return items;
    }
}
