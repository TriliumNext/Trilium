import { Tooltip } from "bootstrap";
import Draggabilly, { type MoveVector } from "draggabilly";

import appContext, { type CommandListenerData, type CommandNames, type EventData } from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";
import contextMenu from "../menus/context_menu.js";
import attributeService from "../services/attributes.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import keyboardActionService from "../services/keyboard_actions.js";
import { clampDragDestination } from "../services/tab_pinning.js";
import { buildTabTitle, TAB_TITLE_SEPARATOR } from "../services/tab_title.js";
import utils from "../services/utils.js";
import BasicWidget from "./basic_widget.js";
import { setupHorizontalScrollViaWheel } from "./widget_utils.js";

const isDesktop = utils.isDesktop();

const TAB_CONTAINER_MIN_WIDTH = 100;
const TAB_CONTAINER_MAX_WIDTH = 240;
const TAB_CONTAINER_LEFT_PADDING = 5;
const SCROLL_BUTTON_WIDTH = 36;
const NEW_TAB_WIDTH = 36;
const MIN_FILLER_WIDTH = isDesktop ? 50 : 15;
const MARGIN_WIDTH = 5;

const TAB_SIZE_SMALL = 84;
const TAB_SIZE_SMALLER = 60;
const TAB_SIZE_MINI = 48;

const TAB_TPL = `
<div class="note-tab">
  <div class="note-tab-wrapper">
    <div class="note-tab-drag-handle"></div>
    <div class="note-tab-icon"></div>
    <div class="note-tab-title"></div>
    <div class="note-tab-pin-indicator bx bx-pin" aria-label="${t("tab_row.unpin_tab")}"></div>
    <div class="note-tab-close bx bx-x" aria-label="${t("tab_row.close_tab")}"></div>
  </div>
</div>`;

const CONTAINER_ANCHOR_TPL = `<div class="tab-row-container-anchor"></div>`;

const NEW_TAB_BUTTON_TPL = `<div class="note-new-tab" data-trigger-command="openNewTab" aria-label="${t("tab_row.add_new_tab")}">+</div>`;
const FILLER_TPL = `<div class="tab-row-filler"></div>`;

const TAB_ROW_TPL = `
<div class="tab-row-widget">
    <style>
    .tab-row-widget {
        display:flex;
        box-sizing: border-box;
        position: relative;
        width: 100%;
        background: var(--main-background-color);
        user-select: none;
    }

    .tab-row-widget.full-width {
        background: var(--launcher-pane-background-color);
    }

    .tab-row-widget * {
        box-sizing: inherit;
        font: inherit;
    }

    .tab-row-widget .tab-row-widget-container {
        box-sizing: border-box;
        position: relative;
        height: 100%;
    }

    .tab-row-widget .note-tab {
        position: absolute;
        left: 0;
        width: 240px;
        border: 0;
        margin: 0;
        z-index: 1;
        pointer-events: none;
    }

    .note-new-tab {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 ${NEW_TAB_WIDTH}px;
        height: ${NEW_TAB_WIDTH}px;
        padding: 1px;
        font-size: 24px;
        cursor: pointer;
        box-sizing: border-box;
    }

    .note-new-tab:hover {
        background-color: var(--accented-background-color);
        border-radius: var(--button-border-radius);
    }

    .tab-row-filler {
        box-sizing: border-box;
        -webkit-app-region: drag;
        min-width: ${MIN_FILLER_WIDTH}px;
        flex-grow: 1;
    }

    .tab-row-container-anchor{
        position: absolute;
        left: 0;
        width: 0px;
        height: 36px;
        border: 0;
        margin: 0;
        z-index: 1;
        cursor: pointer;
        box-sizing: border-box;
    }
    body.mobile .tab-row-filler {
        display: none;
    }

    .tab-row-widget .note-tab[active] {
        z-index: 5;
    }

    .tab-row-widget .note-tab,
    .tab-row-widget .note-tab * {
        cursor: default;
    }

    .tab-row-widget .note-tab.note-tab-was-just-added {
        top: 10px;
        animation: note-tab-was-just-added 120ms forwards ease-in-out;
    }

    .tab-row-widget .note-tab .note-tab-wrapper {
        position: absolute;
        display: flex;
        align-items: center;
        top: 0;
        bottom: 0;
        left: 0;
        right: 0;
        height: 36px;
        padding: 7px 5px 7px 11px;
        border-radius: 8px;
        overflow: hidden;
        pointer-events: all;
        color: var(--inactive-tab-text-color);
        --tab-background-color: var(--workspace-tab-background-color);
        background-color: var(--tab-background-color, var(--inactive-tab-background-color));
    }

    .tab-row-widget .note-tab[active] .note-tab-wrapper {
        font-weight: bold;
        color: var(--active-tab-text-color);
        background-color : var(--tab-background-color, var(--active-tab-background-color));
    }

    .tab-row-widget .note-tab[is-mini] .note-tab-wrapper {
        padding-inline-start: 2px;
        padding-inline-end: 2px;
    }

    .tab-row-widget .note-tab .note-tab-title {
        flex: 1;
        vertical-align: top;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    /* In the active tab, dim every split segment except the focused one so it stands out. */
    .tab-row-widget .note-tab[active] .note-tab-segment:not(.note-tab-segment-active) {
        opacity: 0.55;
        font-weight: normal;
    }

    .tab-row-widget .note-tab .note-tab-icon {
        position: relative;
        padding-inline-end: 3px;
    }

    .tab-row-widget .note-tab[is-small] .note-tab-title {
        margin-inline-start: 0;
    }

    .tab-row-widget .note-tab .note-tab-drag-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        right: 0;
        left: 0;
        z-index: 50;
    }

    .tab-row-widget .note-tab .note-tab-close {
        flex: 0 0 22px;
        border-radius: 50%;
        z-index: 100;
        width: 22px;
        height: 22px;
        cursor: pointer;
        text-align: center;
    }

    .tab-row-widget .note-tab .note-tab-pin-indicator {
        display: none;
        flex: 0 0 22px;
        width: 22px;
        height: 22px;
        align-items: center;
        justify-content: center;
        text-align: center;
        /* purely a visual indicator: clicks fall through to the tab so it activates, never unpins */
        pointer-events: none;
    }

    .tab-row-widget .note-tab[pinned] .note-tab-pin-indicator {
        display: flex;
    }

    .tab-row-widget .note-tab[pinned] .note-tab-close {
        display: none;
    }

    .tab-scroll-button-left, .tab-scroll-button-right {
        display: none;
        flex: 0 0 ${SCROLL_BUTTON_WIDTH}px;
        height: ${SCROLL_BUTTON_WIDTH}px;
        padding: 1px 1px 1px 1px;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .tab-scroll-button-left {
        color: var(--active-tab-text-color);
        box-shadow: inset -1px 0 0 0 var(--main-border-color);
    }

    .tab-scroll-button-right {
        color: var(--active-tab-text-color);
        box-shadow: inset 1px 0 0 0 var(--main-border-color);
    }

    .tab-scroll-button-left.disabled,
    .tab-scroll-button-right.disabled {
        color: var(--inactive-tab-text-color);
        box-shadow: none;
        pointer-events: none;
    }

    .tab-scroll-button-left:hover,
    .tab-scroll-button-right:hover {
        background-color: var(--tab-background-color, var(--inactive-tab-hover-background-color));
    }

    .tab-row-widget .note-tab:hover .note-tab-wrapper {
        background-color: var(--tab-background-color, var(--inactive-tab-hover-background-color));
    }

    .tab-row-widget .note-tab[active]:hover .note-tab-wrapper {
        background-color: var(--tab-background-color, var(--active-tab-hover-background-color));
    }

    body.desktop .tab-row-widget .note-tab .note-tab-close:hover {
        background-color: var(--hover-item-background-color);
        color: var(--hover-item-text-color);
    }

    .tab-row-widget .note-tab[is-smaller] .note-tab-close {
        margin-inline-start: auto;
    }
    .tab-row-widget .note-tab[is-mini]:not([active]) .note-tab-close {
        display: none;
    }
    .tab-row-widget .note-tab[is-mini][active] .note-tab-close {
        margin-inline-start: auto;
        margin-inline-end: auto;
    }
    @-moz-keyframes note-tab-was-just-added {
        to {
            top: 0;
        }
    }
    @-webkit-keyframes note-tab-was-just-added {
        to {
            top: 0;
        }
    }
    @-o-keyframes note-tab-was-just-added {
        to {
            top: 0;
        }
    }
    @keyframes note-tab-was-just-added {
        to {
            top: 0;
        }
    }
    .tab-row-widget.tab-row-widget-is-sorting .note-tab:not(.note-tab-is-dragging),
    .tab-row-widget:not(.tab-row-widget-is-sorting) .note-tab.note-tab-was-just-dragged {
        transition: transform 120ms ease-in-out;
    }
    .tab-row-widget-wrapper {
        display: flex;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
    }

    .tab-row-widget-scrolling-container {
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none; /* Firefox */
    }

    /* Chrome/Safari */
    .tab-row-widget-scrolling-container::-webkit-scrollbar {
        display: none;
    }

    </style>
    <div class="tab-scroll-button-left bx bx-chevron-left"></div>
    <div class="tab-row-widget-scrolling-container">
        <div class="tab-row-widget-container"></div>
    </div>
    <div class="tab-scroll-button-right bx bx-chevron-right"></div>
</div>`;

export default class TabRowWidget extends BasicWidget {

    private isDragging?: boolean;
    private showNoteIcons?: boolean;
    private draggabillies!: Draggabilly[];
    private draggabillyDragging?: Draggabilly | null;

    private $style!: JQuery<HTMLElement>;
    private $tabScrollingContainer!: JQuery<HTMLElement>;
    private $tabContainer!: JQuery<HTMLElement>;
    private $scrollButtonLeft!: JQuery<HTMLElement>;
    private $scrollButtonRight!: JQuery<HTMLElement>;
    private $containerAnchor!: JQuery<HTMLElement>;
    private $filler!: JQuery<HTMLElement>;
    private $newTab!: JQuery<HTMLElement>;
    private updateScrollTimeout: ReturnType<typeof setTimeout> | undefined;

    private newTabOuterWidth: number = 0;
    private scrollButtonsOuterWidth: number = 0;

    /** Monotonic id stamped on a tab per `updateTab` call, so an out-of-order async update can detect it's stale. */
    private tabUpdateId = 0;

    doRender() {
        this.$widget = $(TAB_ROW_TPL);
        this.$tabScrollingContainer = this.$widget.children(".tab-row-widget-scrolling-container");
        this.$tabContainer = this.$widget.find(".tab-row-widget-container");
        this.$scrollButtonLeft = this.$widget.children(".tab-scroll-button-left");
        this.$scrollButtonRight = this.$widget.children(".tab-scroll-button-right");

        const documentStyle = window.getComputedStyle(document.documentElement);
        this.showNoteIcons = documentStyle.getPropertyValue("--tab-note-icons") === "true";

        this.draggabillies = [];

        this.setupStyle();
        this.setupEvents();
        this.setupContainerAnchor();
        this.setupDraggabilly();
        this.setupNewButton();
        this.setupFiller();
        this.layoutTabs();
        this.setVisibility();
        this.setupScrollEvents();

        this.$widget.on("contextmenu", ".note-tab", (e) => {
            e.preventDefault();

            const ntxId = $(e.target).closest(".note-tab").attr("data-ntx-id");

            const mainContext = appContext.tabManager.getMainNoteContexts().find((nc) => nc.ntxId === ntxId);
            const isPinned = !!mainContext?.pinned;
            const isEmpty = !mainContext || mainContext.isEmpty();

            contextMenu.show<CommandNames>({
                x: e.pageX,
                y: e.pageY,
                items: [
                    isPinned
                        ? { title: t("tab_row.unpin_tab"), command: "unpinTab", uiIcon: "bx bx-pin" }
                        : { title: t("tab_row.pin_tab"), command: "pinTab", uiIcon: "bx bx-pin", enabled: !isEmpty },

                    { kind: "separator" },

                    { title: t("tab_row.close"), command: "closeTab", uiIcon: "bx bx-x", enabled: !isPinned },
                    { title: t("tab_row.close_other_tabs"), command: "closeOtherTabs", uiIcon: "bx bx-empty", enabled: appContext.tabManager.noteContexts.length !== 1 },
                    { title: t("tab_row.close_right_tabs"), command: "closeRightTabs", uiIcon: "bx bx-empty", enabled: appContext.tabManager.noteContexts?.at(-1)?.ntxId !== ntxId },
                    { title: t("tab_row.close_all_tabs"), command: "closeAllTabs", uiIcon: "bx bx-empty" },

                    { kind: "separator" },

                    { title: t("tab_row.reopen_last_tab"), command: "reopenLastTab", uiIcon: "bx bx-undo", enabled: appContext.tabManager.recentlyClosedTabs.length !== 0 },

                    { kind: "separator" },

                    { title: t("tab_row.move_tab_to_new_window"), command: "moveTabToNewWindow", uiIcon: "bx bx-window-open", enabled: !isPinned },
                    { title: t("tab_row.copy_tab_to_new_window"), command: "copyTabToNewWindow", uiIcon: "bx bx-empty" }
                ],
                selectMenuItemHandler: ({ command }) => {
                    if (command) {
                        this.triggerCommand(command, { ntxId });
                    }
                }
            });
        });
    }

    setupStyle() {
        this.$style = $("<style>");
        this.$widget.append(this.$style);
    }

    scrollTabContainer(direction: number, behavior: ScrollBehavior = "smooth") {
        this.$tabScrollingContainer[0].scrollBy({
            left: direction,
            behavior
        });
    };

    setupScrollEvents() {
        setupHorizontalScrollViaWheel(this.$tabScrollingContainer);

        this.$scrollButtonLeft[0].addEventListener('click', () => this.scrollTabContainer(-210));
        this.$scrollButtonRight[0].addEventListener('click', () => this.scrollTabContainer(210));

        this.$tabScrollingContainer[0].addEventListener('scroll', () => {
            clearTimeout(this.updateScrollTimeout);
            this.updateScrollTimeout = setTimeout(() => {
                this.updateScrollButtonState();
            }, 100);
        });
    }

    updateScrollButtonState() {
        const scrollLeft = this.$tabScrollingContainer[0].scrollLeft;
        const scrollWidth = this.$tabScrollingContainer[0].scrollWidth;
        const clientWidth = this.$tabScrollingContainer[0].clientWidth;
        // Detect whether the scrollbar is at the far left or far right.
        this.$scrollButtonLeft.toggleClass("disabled", Math.abs(scrollLeft) <= 1);
        this.$scrollButtonRight.toggleClass("disabled", Math.abs(scrollLeft + clientWidth - scrollWidth) <= 1);
    }

    setScrollButtonVisibility(show: boolean = true) {
        if (show) {
            this.$scrollButtonLeft.css("display", "flex");
            this.$scrollButtonRight.css("display", "flex");
            clearTimeout(this.updateScrollTimeout);
            this.updateScrollTimeout = setTimeout(() => {
                this.updateScrollButtonState();
            }, 200);
        } else {
            this.$scrollButtonLeft.css("display", "none");
            this.$scrollButtonRight.css("display", "none");
        }
    }

    setupEvents() {
        new ResizeObserver((_) => {
            this.cleanUpPreviouslyDraggedTabs();
            this.layoutTabs();
        }).observe(this.$widget[0]);

        this.tabEls.forEach((tabEl) => this.setTabCloseEvent(tabEl));
    }

    setVisibility() {
        this.$widget.show();
    }

    /** A tab carries two Bootstrap tooltips: the composite title (on the drag handle) and the close button. */
    getTabTooltips(tabEl: Element): Tooltip[] {
        return [".note-tab-drag-handle", ".note-tab-close"]
            .map((selector) => tabEl.querySelector(selector))
            .map((el) => (el ? Tooltip.getInstance(el) : null))
            .filter((tooltip): tooltip is Tooltip => !!tooltip);
    }

    /**
     * Enables/disables all tab tooltips. Disabled while dragging so a `mouseenter` from the moving tab
     * can't re-show a tooltip that would be stranded at a stale position (it lives in `<body>`).
     */
    setTooltipsEnabled(enabled: boolean) {
        for (const tabEl of this.tabEls) {
            for (const tooltip of this.getTabTooltips(tabEl)) {
                if (enabled) {
                    tooltip.enable();
                } else {
                    tooltip.hide();
                    tooltip.disable();
                }
            }
        }
    }

    get tabEls() {
        return Array.prototype.slice.call(this.$widget.find(".note-tab"));
    }

    updateOuterWidth() {
        if (this.newTabOuterWidth == 0) {
            this.newTabOuterWidth = this.$newTab?.outerWidth(true) ?? 0;
        }
        if (this.scrollButtonsOuterWidth == 0) {
            this.scrollButtonsOuterWidth = (this.$scrollButtonLeft?.outerWidth(true) ?? 0) + (this.$scrollButtonRight?.outerWidth(true) ?? 0);
        }
    }


    get tabWidths() {
        const numberOfTabs = this.tabEls.length;
        // this.$newTab may include margin, and using NEW_TAB_WIDTH could cause tabsContainerWidth to be slightly larger,
        // resulting in misaligned scrollbars/buttons. Therefore, use outerwidth.
        this.updateOuterWidth();
        let tabsContainerWidth = Math.floor(
            (this.$widget.width() ?? 0) - this.newTabOuterWidth - MIN_FILLER_WIDTH
        );
        // Check whether the scroll buttons need to be displayed.
        if ((TAB_CONTAINER_MIN_WIDTH + MARGIN_WIDTH) * numberOfTabs > tabsContainerWidth) {
            tabsContainerWidth -= this.scrollButtonsOuterWidth;
            this.setScrollButtonVisibility(true);
        } else {
            this.setScrollButtonVisibility(false);
        }

        const marginWidth = (numberOfTabs - 1) * MARGIN_WIDTH + TAB_CONTAINER_LEFT_PADDING;
        const targetWidth = (tabsContainerWidth - marginWidth) / numberOfTabs;
        const clampedTargetWidth = Math.max(TAB_CONTAINER_MIN_WIDTH, Math.min(TAB_CONTAINER_MAX_WIDTH, targetWidth));
        const flooredClampedTargetWidth = Math.floor(clampedTargetWidth);
        const totalTabsWidthUsingTarget = flooredClampedTargetWidth * numberOfTabs + marginWidth;
        const totalExtraWidthDueToFlooring = tabsContainerWidth - totalTabsWidthUsingTarget;

        const widths: number[] = [];
        let extraWidthRemaining = totalExtraWidthDueToFlooring;

        for (let i = 0; i < numberOfTabs; i += 1) {
            const extraWidth = flooredClampedTargetWidth < TAB_CONTAINER_MAX_WIDTH && extraWidthRemaining >= 1 ? 1 : 0;

            widths.push(flooredClampedTargetWidth + extraWidth);

            if (extraWidthRemaining >= 1) {
                extraWidthRemaining -= 1;
            }
        }

        return widths;
    }

    getTabPositions() {
        const tabPositions: number[] = [];

        let position = TAB_CONTAINER_LEFT_PADDING;
        this.tabWidths.forEach((width) => {
            tabPositions.push(position);
            position += width + MARGIN_WIDTH;
        });

        position -= MARGIN_WIDTH; // the last margin should not be applied

        const anchorPosition = position;
        if (glob.isRtl) {
            tabPositions.reverse();
        }

        return { tabPositions, anchorPosition };
    }

    layoutTabs() {
        const tabContainerWidths = this.tabWidths;

        this.tabEls.forEach((tabEl, i) => {
            const width = tabContainerWidths[i];

            tabEl.style.width = `${width}px`;
            tabEl.removeAttribute("is-small");
            tabEl.removeAttribute("is-smaller");
            tabEl.removeAttribute("is-mini");

            if (width < TAB_SIZE_SMALL) tabEl.setAttribute("is-small", "");
            if (width < TAB_SIZE_SMALLER) tabEl.setAttribute("is-smaller", "");
            if (width < TAB_SIZE_MINI) tabEl.setAttribute("is-mini", "");
        });

        let styleHTML = "";

        const { tabPositions, anchorPosition } = this.getTabPositions();

        tabPositions.forEach((position, i) => {
            styleHTML += `.note-tab:nth-child(${i + 1}) { transform: translate3d(${position}px, 0, 0)} `;
        });

        styleHTML += `.tab-row-container-anchor { transform: translate3d(${anchorPosition}px, 0, 0) } `;
        styleHTML += `.tab-row-widget-container {width: ${anchorPosition}px}`;
        this.$style.html(styleHTML);
    }

    addTab(ntxId: string) {
        const $tab = $(TAB_TPL).attr("data-ntx-id", ntxId);

        keyboardActionService.updateDisplayedShortcuts($tab);

        $tab.addClass("note-tab-was-just-added");

        setTimeout(() => $tab.removeClass("note-tab-was-just-added"), 500);
        this.$containerAnchor.before($tab);
        // When opened from a link the model may place this tab before the end; mirror that order in
        // the DOM. When appended (the common case) it is already correct, so skip the O(n) walk.
        const mainContexts = appContext.tabManager.getMainNoteContexts();
        if (mainContexts[mainContexts.length - 1]?.ntxId !== ntxId) {
            this.syncTabOrder();
        }
        this.setVisibility();
        this.setTabCloseEvent($tab);
        this.updateTitle($tab, t("tab_row.new_tab"));

        // Trilium-styled tooltip instead of the native one; reads the live composite title each time.
        // Attach to the drag handle (the full-tab interaction layer, `pointer-events` enabled) rather
        // than .note-tab, whose `pointer-events: none` makes Bootstrap's hover tracking misfire. The
        // close button sits above the handle (higher z-index) with its own tooltip, so they never overlap.
        new Tooltip($tab.find(".note-tab-drag-handle")[0], {
            // titles are pre-escaped in buildTabTitle (only the active <strong> wrapper is trusted);
            // Bootstrap's own sanitizer stays on as a second layer
            html: true,
            title: () => $tab.attr("data-tab-title") || "",
            trigger: "hover",
            placement: "bottom",
            container: "body",
            delay: { show: 500, hide: 0 }
        });

        new Tooltip($tab.find(".note-tab-close")[0], {
            title: t("tab_row.close_tab"),
            trigger: "hover",
            placement: "bottom",
            container: "body",
            delay: { show: 500, hide: 0 }
        });

        this.cleanUpPreviouslyDraggedTabs();
        this.layoutTabs();
        this.setupDraggabilly();
    }

    closeActiveTabCommand({ $el }: CommandListenerData<"closeActiveTab">) {
        const ntxId = $el.closest(".note-tab").attr("data-ntx-id");

        appContext.tabManager.removeNoteContext(ntxId ?? null);
    }

    setTabCloseEvent($tab: JQuery<HTMLElement>) {
        $tab.on("mousedown", (e) => {
            if (e.which === 2) {
                appContext.tabManager.removeNoteContext($tab.attr("data-ntx-id") ?? null);

                return true; // event has been handled
            }
        });

        $tab.find(".note-tab-close").on("click", (e) => {
            this.triggerCommand("closeActiveTab", { $el: $(e.target) });
            return true;
        });
    }

    get activeTabEl() {
        return this.$widget.find(".note-tab[active]")[0];
    }

    activeContextChangedEvent() {
        let activeNoteContext = appContext.tabManager.getActiveContext();

        if (!activeNoteContext) {
            return;
        }

        if (activeNoteContext.mainNtxId) {
            activeNoteContext = appContext.tabManager.getNoteContextById(activeNoteContext.mainNtxId);
        }

        const tabEl = this.getTabById(activeNoteContext.ntxId)[0];
        const activeTabEl = this.activeTabEl;

        if (activeTabEl !== tabEl) {
            if (activeTabEl) {
                activeTabEl.removeAttribute("active");
                // the previously active tab loses its emphasized segment
                this.refreshTab(activeTabEl.getAttribute("data-ntx-id"));
            }
            if (tabEl) tabEl.setAttribute("active", "");
        }

        // (re)emphasize the focused split within the now-active tab — also covers switching panes
        // within the same tab, where the active tab element itself doesn't change
        this.refreshTab(activeNoteContext.ntxId);
    }

    newNoteContextCreatedEvent({ noteContext }: EventData<"newNoteContextCreated">) {
        if (!noteContext.mainNtxId && noteContext.ntxId) {
            this.addTab(noteContext.ntxId);
        }
    }

    removeTab(ntxId: string) {
        const tabEl = this.getTabById(ntxId)[0];

        if (tabEl) {
            for (const tooltip of this.getTabTooltips(tabEl)) {
                tooltip.dispose();
            }
            tabEl.parentNode?.removeChild(tabEl);
            this.cleanUpPreviouslyDraggedTabs();
            this.layoutTabs();
            this.setupDraggabilly();
            this.setVisibility();
        }
    }

    getNtxIdsInOrder() {
        return this.tabEls.map((el) => el.getAttribute("data-ntx-id"));
    }

    updateTitle($tab: JQuery<HTMLElement>, title: string) {
        $tab.attr("data-tab-title", title);
        $tab.find(".note-tab-title").text(title);
    }

    getTabById(ntxId: string | null) {
        return this.$widget.find(`[data-ntx-id='${ntxId}']`);
    }

    getTabId($tab: JQuery<HTMLElement>) {
        return $tab.attr("data-ntx-id");
    }

    noteContextRemovedEvent({ ntxIds }: EventData<"noteContextRemoved">) {
        for (const ntxId of ntxIds) {
            this.removeTab(ntxId);
        }

        // a closed split must drop its segment from the owning tab's title
        this.refreshAllTabs();
    }

    cleanUpPreviouslyDraggedTabs() {
        this.tabEls.forEach((tabEl) => tabEl.classList.remove("note-tab-was-just-dragged"));
    }

    setupDraggabilly() {
        const tabEls = this.tabEls;
        const { tabPositions } = this.getTabPositions();
        let initialScrollLeft = 0;

        if (this.isDragging && this.draggabillyDragging) {
            this.isDragging = false;
            this.$widget.removeClass("tab-row-widget-is-sorting");
            // TODO: Some of these don't make sense, might need removal.
            this.draggabillyDragging.element.classList.remove("note-tab-is-dragging");
            this.draggabillyDragging.element.style.transform = "";
            this.draggabillyDragging.dragEnd();
            this.draggabillyDragging.isDragging = false;
            this.draggabillyDragging.positionDrag = () => { }; // Prevent Draggabilly from updating tabEl.style.transform in later frames
            this.draggabillyDragging.destroy();
            this.draggabillyDragging = null;
        }

        this.draggabillies.forEach((d) => d.destroy());

        tabEls.forEach((tabEl, originalIndex) => {
            const originalTabPositionX = tabPositions[originalIndex];
            const draggabilly = new Draggabilly(tabEl, {
                axis: "x",
                handle: ".note-tab-drag-handle",
                containment: this.$tabContainer[0]
            });

            this.draggabillies.push(draggabilly);

            draggabilly.on("staticClick", () => {
                // restore the tab's last-focused split rather than always jumping to its main split
                appContext.tabManager.activateTabContext(tabEl.getAttribute("data-ntx-id"));
            });

            draggabilly.on("dragStart", () => {
                this.isDragging = true;
                this.draggabillyDragging = draggabilly;
                tabEl.classList.add("note-tab-is-dragging");
                this.$widget.addClass("tab-row-widget-is-sorting");

                // tooltips live in <body> and won't follow the tab — turn them off for the whole drag
                this.setTooltipsEnabled(false);

                initialScrollLeft = this.$tabScrollingContainer?.scrollLeft() ?? 0;
                draggabilly.positionDrag = () => { };
            });

            draggabilly.on("dragEnd", () => {
                this.isDragging = false;
                this.setTooltipsEnabled(true);
                const currentScrollLeft = this.$tabScrollingContainer?.scrollLeft() ?? 0;
                const scrollDelta = currentScrollLeft - initialScrollLeft;
                const translateX = parseFloat(tabEl.style.left) + scrollDelta;
                const maxTranslateX = this.$tabContainer[0]?.offsetWidth - tabEl.offsetWidth;
                const minTranslateX = 0;
                const finalTranslateX = Math.min(maxTranslateX, Math.max(minTranslateX, translateX));

                tabEl.style.transform = `translate3d(0, 0, 0)`;

                // Animate dragged tab back into its place
                requestAnimationFrame((_) => {
                    tabEl.style.left = "0";
                    tabEl.style.transform = `translate3d(${finalTranslateX}px, 0, 0)`;

                    requestAnimationFrame((_) => {
                        tabEl.classList.remove("note-tab-is-dragging");
                        this.$widget.removeClass("tab-row-widget-is-sorting");

                        tabEl.classList.add("note-tab-was-just-dragged");

                        requestAnimationFrame((_) => {
                            tabEl.style.transform = "";

                            this.layoutTabs();
                            this.setupDraggabilly();
                        });
                    });
                });
            });

            draggabilly.on("dragMove", (event: unknown, pointer: PointerEvent, moveVector: MoveVector) => {
                // The current index be computed within the event since it can change during the dragMove
                const tabEls = this.tabEls;
                const currentIndex = tabEls.indexOf(tabEl);

                const scorllContainerBounds = this.$tabScrollingContainer[0]?.getBoundingClientRect();
                const pointerX = pointer.pageX;
                const scrollSpeed = 105; // The increment of each scroll.
                // Check if the mouse is near the edge of the container and trigger scrolling.
                if (pointerX < scorllContainerBounds.left) {
                    this.scrollTabContainer(- scrollSpeed);
                } else if (pointerX > scorllContainerBounds.right) {
                    this.scrollTabContainer(scrollSpeed);
                }

                const currentScrollLeft = this.$tabScrollingContainer?.scrollLeft() ?? 0;
                const scrollDelta = currentScrollLeft - initialScrollLeft;
                let translateX = moveVector.x + scrollDelta;

                // Limit the `translateX` so that `tabEl` cannot exceed the left and right boundaries of the container.
                const maxTranslateX = this.$tabContainer[0]?.offsetWidth - tabEl.offsetWidth - originalTabPositionX;
                const minTranslateX = - originalTabPositionX;
                translateX = Math.min(maxTranslateX, Math.max(minTranslateX, translateX));
                tabEl.style.transform = `translate3d(${translateX}px, 0, 0)`;
                const currentTabPositionX = originalTabPositionX + translateX;
                const destinationIndexTarget = this.closest(currentTabPositionX, tabPositions);
                // keep pinned and unpinned tabs in their own zones — neither can cross the boundary
                const pinnedCount = tabEls.filter((el) => el.hasAttribute("pinned")).length;
                const destinationIndex = clampDragDestination(destinationIndexTarget, tabEl.hasAttribute("pinned"), pinnedCount, tabEls.length);

                if (currentIndex !== destinationIndex) {
                    this.animateTabMove(tabEl, currentIndex, destinationIndex);
                }

                // pinned tabs stay put — don't trigger the drag-to-new-window tear-off
                if (Math.abs(moveVector.y) > 100 && !tabEl.hasAttribute("pinned")) {
                    this.triggerCommand("moveTabToNewWindow", { ntxId: this.getTabId($(tabEl)) });
                }
            });
        });
    }

    animateTabMove(tabEl: HTMLElement, originIndex: number, destinationIndex: number) {
        if (destinationIndex < originIndex) {
            tabEl.parentNode?.insertBefore(tabEl, this.tabEls[destinationIndex]);
        } else {
            const beforeEl = this.tabEls[destinationIndex + 1] || this.$containerAnchor[0];
            tabEl.parentNode?.insertBefore(tabEl, beforeEl);
        }
        this.triggerEvent("tabReorder", { ntxIdsInOrder: this.getNtxIdsInOrder() });
        this.layoutTabs();
    }

    setupNewButton() {
        this.$newTab = $(NEW_TAB_BUTTON_TPL);
        this.$widget.append(this.$newTab);

        new Tooltip(this.$newTab[0], {
            title: t("tab_row.add_new_tab"),
            trigger: "hover",
            placement: "bottom",
            container: "body",
            delay: { show: 500, hide: 0 }
        });
    }

    setupFiller() {
        this.$filler = $(FILLER_TPL);

        this.$widget.append(this.$filler);
    }

    setupContainerAnchor() {
        this.$containerAnchor = $(CONTAINER_ANCHOR_TPL);

        this.$tabContainer.append(this.$containerAnchor);
    }

    closest(value: number, array: number[]) {
        let closest = Infinity;
        let closestIndex = -1;

        array.forEach((v, i) => {
            if (Math.abs(value - v) < closest) {
                closest = Math.abs(value - v);
                closestIndex = i;
            }
        });

        return closestIndex;
    }

    noteSwitchedAndActivatedEvent({ noteContext }: EventData<"noteSwitchedAndActivated">) {
        this.activeContextChangedEvent();

        this.updateTabById(noteContext.mainNtxId || noteContext.ntxId);
    }

    noteSwitchedEvent({ noteContext }: EventData<"noteSwitched">) {
        this.updateTabById(noteContext.mainNtxId || noteContext.ntxId);
    }

    noteContextReorderEvent({ oldMainNtxId, newMainNtxId }: EventData<"noteContextReorder">) {
        if (oldMainNtxId && newMainNtxId) {
            // the main split of a tab changed — the tab now represents the new main context
            this.getTabById(oldMainNtxId).attr("data-ntx-id", newMainNtxId);
        }

        // split order (or main context) changed → rebuild composite titles so the segments reflect it
        this.refreshAllTabs();
    }

    contextsReopenedEvent({ mainNtxId, tabPosition }: EventData<"contextsReopened">) {
        if (!mainNtxId || tabPosition < 0) {
            // no tab reopened
            return;
        }
        const tabEl = this.getTabById(mainNtxId)[0];

        if ( tabEl && tabEl.parentNode ){
            tabEl.parentNode.insertBefore(tabEl, this.tabEls[tabPosition]);
        }

        // a reopened split may have changed this tab's composition
        this.refreshTab(mainNtxId);
    }

    updateTabById(ntxId: string | null) {
        const $tab = this.getTabById(ntxId);
        $tab[0].scrollIntoView({
            behavior: 'smooth'
        });
        const noteContext = appContext.tabManager.getNoteContextById(ntxId);

        this.updateTab($tab, noteContext);
    }

    async updateTab($tab: JQuery<HTMLElement>, noteContext: NoteContext) {
        if (!$tab.length) {
            return;
        }

        // a tab is the main context; its icon/classes follow the first split, the title spans them all
        const mainContext = noteContext.getMainContext();

        // keep the pinned attribute in sync (drives the pin indicator + hidden close button)
        $tab.attr("pinned", mainContext.pinned ? "" : null);

        for (const clazz of Array.from($tab[0].classList)) {
            // create copy to safely iterate over while removing classes
            if (clazz !== "note-tab") {
                $tab.removeClass(clazz);
            }
        }

        let noteIcon = "";

        const hoistedNote = froca.getNoteFromCache(mainContext.hoistedNoteId);
        if (hoistedNote) {
            $tab.find(".note-tab-wrapper").css("--workspace-tab-background-color", hoistedNote.getWorkspaceTabBackgroundColor());
            if (!this.showNoteIcons) {
                noteIcon = hoistedNote.getWorkspaceIconClass();
            }
        } else {
            $tab.find(".note-tab-wrapper").removeAttr("style");
        }

        const updateId = ++this.tabUpdateId;
        $tab.data("update-id", updateId);

        const subContexts = mainContext.getSubContexts();
        const focusedNtxId = this.getFocusedNtxId(mainContext, subContexts);

        await this.updateTabTitle($tab, subContexts, focusedNtxId, mainContext.pinned, updateId);

        // a newer updateTab may have started during the await — don't overwrite it with stale icon/classes
        if ($tab.data("update-id") !== updateId) {
            return;
        }

        // The icon and type classes follow the tab's focused split (remembered across activations),
        // falling back to its main (first) split.
        const displayContext = subContexts.find((ctx) => ctx.ntxId === focusedNtxId) ?? mainContext;
        const note = displayContext.note;
        if (note) {
            $tab.addClass(note.getCssClass());
            $tab.addClass(utils.getNoteTypeClass(note.type));
            $tab.addClass(utils.getMimeTypeClass(note.mime));

            if (this.showNoteIcons) {
                noteIcon = note.getIcon();
            }
        }

        if (noteIcon) {
            $tab.find(".note-tab-icon").removeClass().addClass("note-tab-icon").addClass(noteIcon);
        }
    }

    /**
     * Builds the tab title from every split in the tab, e.g. "Note A • Note B • Note C", with the
     * currently focused split emphasized. The full text is also set as the tooltip.
     */
    async updateTabTitle($tab: JQuery<HTMLElement>, subContexts: NoteContext[], focusedNtxId: string | null, pinned: boolean, updateId?: number) {
        const splits = await Promise.all(
            subContexts.map(async (ctx) => ({
                title: ctx.note ? await ctx.getNavigationTitle() : null,
                active: !!ctx.ntxId && ctx.ntxId === focusedNtxId
            }))
        );

        // bail if a newer update superseded this one while titles were resolving
        if (updateId !== undefined && $tab.data("update-id") !== updateId) {
            return;
        }

        const { segments, tooltipHtml } = buildTabTitle(splits, t("tab_row.new_tab"), {
            pinnedPrefix: pinned ? t("tab_row.pinned_prefix") : undefined
        });

        $tab.attr("data-tab-title", tooltipHtml);

        const $title = $tab.find(".note-tab-title").empty();
        segments.forEach((segment, idx) => {
            if (idx > 0) {
                $title.append(document.createTextNode(TAB_TITLE_SEPARATOR));
            }
            const $segment = $("<span>").addClass("note-tab-segment").text(segment.text);
            if (segment.active) {
                $segment.addClass("note-tab-segment-active");
            }
            $title.append($segment);
        });
    }

    /** The split a tab currently represents: its remembered last-focused split (if still open), else its main split. */
    getFocusedNtxId(mainContext: NoteContext, subContexts: NoteContext[]): string | null {
        const remembered = mainContext.lastActiveNtxId;
        if (remembered && subContexts.some((ctx) => ctx.ntxId === remembered)) {
            return remembered;
        }
        return mainContext.ntxId;
    }

    /** Rebuilds a tab in place (title, icon, classes) without scrolling it into view. */
    refreshTab(ntxId: string | null | undefined) {
        if (!ntxId) {
            return;
        }
        const $tab = this.getTabById(ntxId);
        const noteContext = appContext.tabManager.noteContexts.find((nc) => nc.ntxId === ntxId);
        if ($tab.length && noteContext) {
            this.updateTab($tab, noteContext);
        }
    }

    /** Rebuilds every tab's title — used when a split was added/removed/reordered in some tab. */
    refreshAllTabs() {
        for (const mainContext of appContext.tabManager.getMainNoteContexts()) {
            this.refreshTab(mainContext.ntxId);
        }
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        // A reloaded note may live in a split (sub-context), which has no tab of its own — refresh the
        // owning tab so its composite title picks up the change. Dedupe so each tab rebuilds once.
        const mainNtxIdsToRefresh = new Set<string>();

        for (const noteContext of appContext.tabManager.noteContexts) {
            if (!noteContext.noteId) {
                continue;
            }

            if (
                loadResults.isNoteReloaded(noteContext.noteId) ||
                loadResults
                    .getAttributeRows()
                    .find((attr) => ["workspace", "iconClass", "workspaceIconClass", "workspaceTabBackgroundColor"].includes(attr.name || "") && attributeService.isAffecting(attr, noteContext.note))
            ) {
                const mainNtxId = noteContext.mainNtxId || noteContext.ntxId;
                if (mainNtxId) {
                    mainNtxIdsToRefresh.add(mainNtxId);
                }
            }
        }

        for (const mainNtxId of mainNtxIdsToRefresh) {
            this.refreshTab(mainNtxId);
        }
    }

    frocaReloadedEvent() {
        for (const noteContext of appContext.tabManager.noteContexts) {
            const $tab = this.getTabById(noteContext.ntxId);

            this.updateTab($tab, noteContext);
        }
    }

    hoistedNoteChangedEvent({ ntxId }: EventData<"hoistedNoteChanged">) {
        const $tab = this.getTabById(ntxId);

        if ($tab && ntxId) {
            const noteContext = appContext.tabManager.getNoteContextById(ntxId);

            this.updateTab($tab, noteContext);
        }
    }

    tabPinStateChangedEvent({ ntxId, pinned }: EventData<"tabPinStateChanged">) {
        const $tab = this.getTabById(ntxId);

        if (!$tab.length) {
            return;
        }

        $tab.attr("pinned", pinned ? "" : null);

        // the model already moved the context; mirror that order in the DOM and re-layout
        this.syncTabOrder();
        this.layoutTabs();
        this.setupDraggabilly();
    }

    /** Reorders the tab elements in the DOM to match the model order (pinned tabs grouped first). */
    syncTabOrder() {
        for (const noteContext of appContext.tabManager.getMainNoteContexts()) {
            const tabEl = this.getTabById(noteContext.ntxId)[0];

            if (tabEl) {
                this.$containerAnchor.before(tabEl);
            }
        }
    }
}
