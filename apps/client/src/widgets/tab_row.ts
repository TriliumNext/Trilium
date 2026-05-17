import "./tab_row.css";

import Draggabilly, { type MoveVector } from "draggabilly";
import { h } from "preact";

import appContext, { type CommandListenerData, type CommandNames, type EventData } from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";
import contextMenu from "../menus/context_menu.js";
import attributeService from "../services/attributes.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import keyboardActionService from "../services/keyboard_actions.js";
import utils from "../services/utils.js";
import BasicWidget from "./basic_widget.js";
import { renderReactWidget } from "./react/react_utils.js";
import Tab from "./tab_row/Tab.js";
import { setupHorizontalScrollViaWheel } from "./widget_utils.js";

const isDesktop = utils.isDesktop();

const TAB_CONTAINER_MIN_WIDTH = 100;
const TAB_CONTAINER_MAX_WIDTH = 240;
const TAB_CONTAINER_LEFT_PADDING = 5;
const MIN_FILLER_WIDTH = isDesktop ? 50 : 15;
const MARGIN_WIDTH = 5;

const TAB_SIZE_SMALL = 84;
const TAB_SIZE_SMALLER = 60;
const TAB_SIZE_MINI = 48;


const CONTAINER_ANCHOR_TPL = `<div class="tab-row-container-anchor"></div>`;

const NEW_TAB_BUTTON_TPL = `<div class="note-new-tab" data-trigger-command="openNewTab" title="${t("tab_row.add_new_tab")}">+</div>`;
const FILLER_TPL = `<div class="tab-row-filler"></div>`;

const TAB_ROW_TPL = `
<div class="tab-row-widget">
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

        this.$widget.css("--min-filler-width", MIN_FILLER_WIDTH);
        this.$widget.on("contextmenu", ".note-tab", (e) => {
            e.preventDefault();

            const ntxId = $(e.target).closest(".note-tab").attr("data-ntx-id");

            contextMenu.show<CommandNames>({
                x: e.pageX,
                y: e.pageY,
                items: [
                    { title: t("tab_row.close"), command: "closeTab", uiIcon: "bx bx-x" },
                    { title: t("tab_row.close_other_tabs"), command: "closeOtherTabs", uiIcon: "bx bx-empty", enabled: appContext.tabManager.noteContexts.length !== 1 },
                    { title: t("tab_row.close_right_tabs"), command: "closeRightTabs", uiIcon: "bx bx-empty", enabled: appContext.tabManager.noteContexts?.at(-1)?.ntxId !== ntxId },
                    { title: t("tab_row.close_all_tabs"), command: "closeAllTabs", uiIcon: "bx bx-empty" },

                    { kind: "separator" },

                    { title: t("tab_row.reopen_last_tab"), command: "reopenLastTab", uiIcon: "bx bx-undo", enabled: appContext.tabManager.recentlyClosedTabs.length !== 0 },

                    { kind: "separator" },

                    { title: t("tab_row.move_tab_to_new_window"), command: "moveTabToNewWindow", uiIcon: "bx bx-window-open" },
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
        const segments = [{ ntxId, title: t("tab_row.new_tab") }];
        const $tab = renderReactWidget(this, h(Tab, { ntxId, segments }));

        keyboardActionService.updateDisplayedShortcuts($tab);

        $tab.addClass("note-tab-was-just-added");

        setTimeout(() => $tab.removeClass("note-tab-was-just-added"), 500);
        this.$containerAnchor.before($tab);
        this.setVisibility();
        this.setTabCloseEvent($tab);
        this.setSegmentClickEvents($tab);
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

    setSegmentClickEvents($tab: JQuery<HTMLElement>) {
        $tab.on("click", ".note-tab-segment", (e) => {
            e.stopPropagation();
            const segmentNtxId = $(e.currentTarget).attr("data-ntx-id");
            if (segmentNtxId) {
                appContext.tabManager.activateNoteContext(segmentNtxId);
            }
        });
    }

    updateTabSegments(mainNtxId: string) {
        const $tab = this.getTabById(mainNtxId);
        if (!$tab.length) {
            return;
        }

        const mainContext = appContext.tabManager.getNoteContextById(mainNtxId);
        const subContexts = mainContext.getSubContexts();
        const hasSplits = subContexts.length > 1;

        $tab.toggleClass("note-tab-split", hasSplits);

        const $wrapper = $tab.find(".note-tab-wrapper");
        // Remove existing segments and separators
        $wrapper.find(".note-tab-segment, .note-tab-separator").remove();

        // Insert segments before the close button
        const $closeBtn = $wrapper.find(".note-tab-close");
        for (let i = 0; i < subContexts.length; i++) {
            const subContext = subContexts[i];
            if (i > 0) {
                $closeBtn.before($('<div class="note-tab-separator"/>'));
            }
            const $segment = $(`<div class="note-tab-segment" data-ntx-id="${subContext.ntxId}">
                <div class="note-tab-icon"></div>
                <div class="note-tab-title"></div>
            </div>`);
            $closeBtn.before($segment);

            this.updateSegment($segment, subContext);
        }

        this.updateActiveSegment($tab);
    }

    async updateSegment($segment: JQuery<HTMLElement>, noteContext: NoteContext) {
        const { note } = noteContext;
        const title = note
            ? (await noteContext.getNavigationTitle()) ?? note.title
            : t("tab_row.new_tab");

        $segment.attr("title", title ?? "");
        $segment.find(".note-tab-title").text(title ?? "");

        if (note) {
            let noteIcon = "";
            if (this.showNoteIcons) {
                noteIcon = note.getIcon();
            } else {
                const hoistedNote = froca.getNoteFromCache(noteContext.hoistedNoteId);
                if (hoistedNote) {
                    noteIcon = hoistedNote.getWorkspaceIconClass();
                }
            }
            if (noteIcon) {
                $segment.find(".note-tab-icon").removeClass().addClass("note-tab-icon").addClass(noteIcon);
            }
        }
    }

    updateActiveSegment($tab: JQuery<HTMLElement>) {
        const activeContext = appContext.tabManager.getActiveContext();
        $tab.find(".note-tab-segment").removeAttr("active");
        if (activeContext) {
            $tab.find(`.note-tab-segment[data-ntx-id='${activeContext.ntxId}']`).attr("active", "");
        }
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
            if (activeTabEl) activeTabEl.removeAttribute("active");
            if (tabEl) tabEl.setAttribute("active", "");
        }

        // Update active segment highlighting
        if (tabEl) {
            this.updateActiveSegment($(tabEl));
        }
    }

    newNoteContextCreatedEvent({ noteContext }: EventData<"newNoteContextCreated">) {
        if (!noteContext.mainNtxId && noteContext.ntxId) {
            this.addTab(noteContext.ntxId);
        } else if (noteContext.mainNtxId) {
            this.updateTabSegments(noteContext.mainNtxId);
        }
    }

    removeTab(ntxId: string) {
        const tabEl = this.getTabById(ntxId)[0];

        if (tabEl) {
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
        $tab.attr("title", title);
        // Update the title in the first segment (single-split case)
        $tab.find(".note-tab-segment .note-tab-title").first().text(title);
    }

    getTabById(ntxId: string | null) {
        return this.$widget.find(`.note-tab[data-ntx-id='${ntxId}']`);
    }

    getTabId($tab: JQuery<HTMLElement>) {
        return $tab.attr("data-ntx-id");
    }

    noteContextRemovedEvent({ ntxIds }: EventData<"noteContextRemoved">) {
        for (const ntxId of ntxIds) {
            // Check if this is a main tab or a split within a tab
            const $tab = this.$widget.find(`.note-tab[data-ntx-id='${ntxId}']`);
            if ($tab.length) {
                this.removeTab(ntxId);
            } else {
                // It might be a split segment - find the parent tab and update segments
                const $segment = this.$widget.find(`.note-tab-segment[data-ntx-id='${ntxId}']`);
                if ($segment.length) {
                    const mainNtxId = $segment.closest(".note-tab").attr("data-ntx-id");
                    if (mainNtxId) {
                        this.updateTabSegments(mainNtxId);
                    }
                }
            }
        }
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
                appContext.tabManager.activateNoteContext(tabEl.getAttribute("data-ntx-id"));
            });

            draggabilly.on("dragStart", () => {
                this.isDragging = true;
                this.draggabillyDragging = draggabilly;
                tabEl.classList.add("note-tab-is-dragging");
                this.$widget.addClass("tab-row-widget-is-sorting");

                initialScrollLeft = this.$tabScrollingContainer?.scrollLeft() ?? 0;
                draggabilly.positionDrag = () => { };
            });

            draggabilly.on("dragEnd", () => {
                this.isDragging = false;
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
                const destinationIndex = Math.max(0, Math.min(tabEls.length, destinationIndexTarget));

                if (currentIndex !== destinationIndex) {
                    this.animateTabMove(tabEl, currentIndex, destinationIndex);
                }

                if (Math.abs(moveVector.y) > 100) {
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

        const mainNtxId = noteContext.mainNtxId || noteContext.ntxId;
        this.updateTabById(mainNtxId);
    }

    noteSwitchedEvent({ noteContext }: EventData<"noteSwitched">) {
        const mainNtxId = noteContext.mainNtxId || noteContext.ntxId;
        this.updateTabById(mainNtxId);
    }

    noteContextReorderEvent({ oldMainNtxId, newMainNtxId }: EventData<"noteContextReorder">) {
        if (!oldMainNtxId || !newMainNtxId) {
            // no need to update tab row
            return;
        }

        // update tab id for the new main context
        this.getTabById(oldMainNtxId).attr("data-ntx-id", newMainNtxId);
        this.updateTabById(newMainNtxId);
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

        for (const clazz of Array.from($tab[0].classList)) {
            // create copy to safely iterate over while removing classes
            if (clazz !== "note-tab" && clazz !== "note-tab-split") {
                $tab.removeClass(clazz);
            }
        }

        if (noteContext) {
            const hoistedNote = froca.getNoteFromCache(noteContext.hoistedNoteId);

            if (hoistedNote) {
                $tab.find(".note-tab-wrapper").css("--workspace-tab-background-color", hoistedNote.getWorkspaceTabBackgroundColor());
            } else {
                $tab.find(".note-tab-wrapper").removeAttr("style");
            }
        }

        const subContexts = noteContext.getSubContexts();

        if (subContexts.length > 1) {
            this.updateTabSegments(noteContext.ntxId!);
        } else {
            // Single context — update the first (only) segment
            const $segment = $tab.find(".note-tab-segment");
            if ($segment.length) {
                this.updateSegment($segment, noteContext);
            }

            const { note } = noteContext;

            if (!note) {
                this.updateTitle($tab, t("tab_row.new_tab"));
                return;
            }

            const title = await noteContext.getNavigationTitle();
            if (title) {
                this.updateTitle($tab, title);
            }

            $tab.addClass(note.getCssClass());
            $tab.addClass(utils.getNoteTypeClass(note.type));
            $tab.addClass(utils.getMimeTypeClass(note.mime));
        }
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        const updatedMainNtxIds = new Set<string>();

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
                if (mainNtxId && !updatedMainNtxIds.has(mainNtxId)) {
                    updatedMainNtxIds.add(mainNtxId);
                    const mainContext = appContext.tabManager.getNoteContextById(mainNtxId);
                    const $tab = this.getTabById(mainNtxId);
                    this.updateTab($tab, mainContext);
                }
            }
        }
    }

    frocaReloadedEvent() {
        for (const noteContext of appContext.tabManager.getMainNoteContexts()) {
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
}
