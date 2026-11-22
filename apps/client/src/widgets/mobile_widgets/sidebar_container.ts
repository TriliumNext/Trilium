import type { Screen } from "../../components/mobile_screen_switcher.js";
import type NoteContext from "../../components/note_context.js";
import { onSystemBack } from "../../services/system_back.js";
import { isNarrowLayout, onNarrowLayoutChange } from "../../services/utils.js";
import { forgetTabs, getTabNavigation, setTabScreen } from "./tab_navigation.js";

const DRAG_STATE_NONE = 0;
const DRAG_STATE_INITIAL_DRAG = 1;
const DRAG_STATE_DRAGGING = 2;

/** Percentage of drag that the user has to do in order for the tree to open (0-100). */
const DRAG_OPEN_THRESHOLD = 10;

/** The number of pixels the user has to drag across the screen to trigger the drag open animation. */
const DRAG_START_THRESHOLD = 10;
/** How far the tree lies toward the start while the note covers it (0-100). */
const STACK_PARALLAX = 30;

/** The screen the sidebar is. */
const SCREEN: Screen = "tree";

/**
 * Moves the note tree of the mobile layout, `sidebarEl`, against the note. On a phone, the tree and
 * the note form a navigation stack: the tree lies under the note, which slides away to reveal it,
 * by a swipe from the edge or by `setActiveScreen`. On a tablet, the tree sits next to the note.
 * `MobileSidebar` hands it the events it follows.
 */
export default class SidebarNavigation {
    private sidebarEl: HTMLElement;
    private setActiveScreen: (screen: Screen) => void;
    /** The screen name that is currently active, according to the screen changed event. */
    private activeScreenName?: Screen;
    /** The main context ntxId of the active tab. */
    private activeTabId?: string;
    private currentTranslate: number;
    private dragState: number;
    private startX?: number;
    private translatePercentage: number;
    private detailEl?: HTMLElement;
    private originalSidebarTransition: string;
    private originalDetailTransition: string;
    private screenWidth: number;
    private disposers: (() => void)[];

    constructor(sidebarEl: HTMLElement, setActiveScreen: (screen: Screen) => void) {
        this.sidebarEl = sidebarEl;
        this.setActiveScreen = setActiveScreen;
        this.currentTranslate = -100;
        this.translatePercentage = 0;
        this.dragState = DRAG_STATE_NONE;
        this.originalSidebarTransition = sidebarEl.style.transition;
        this.originalDetailTransition = "";
        this.screenWidth = document.body.getBoundingClientRect().width;

        const onDragStart = (e: TouchEvent) => this.#onDragStart(e);
        const onDragMove = (e: TouchEvent) => this.#onDragMove(e);
        const onDragEnd = () => this.#onDragEnd();
        document.addEventListener("touchstart", onDragStart);
        document.addEventListener("touchmove", onDragMove, { passive: false });
        document.addEventListener("touchend", onDragEnd);
        this.disposers = [
            onNarrowLayoutChange(() => this.#setSidebarOpen(this.currentTranslate === 0)),
            onSystemBack(() => {
                if (!isNarrowLayout() || this.activeScreenName === SCREEN) return false;
                this.setActiveScreen(SCREEN);
                return true;
            }),
            () => {
                document.removeEventListener("touchstart", onDragStart);
                document.removeEventListener("touchmove", onDragMove);
                document.removeEventListener("touchend", onDragEnd);
            }
        ];
    }

    dispose() {
        for (const dispose of this.disposers) {
            dispose();
        }
    }

    switchToTab(noteContext: NoteContext) {
        const tabId = noteContext.getMainContext().ntxId;
        if (!tabId || tabId === this.activeTabId) return;
        this.activeTabId = tabId;

        // A tab that never showed the tree shows its note.
        if (isNarrowLayout()) {
            const screen = getTabNavigation(tabId)?.screen ?? "detail";
            this.#findDetail();
            this.#withoutTransition(() => this.#setSidebarOpen(screen === SCREEN));
            this.setActiveScreen(screen);
        }
    }

    /**
     * Shows the tree of the active tab once `NoteContext.setEmpty()` leaves it without a note, as
     * a new tab is. Splits and tabs opened in the background keep their screen.
     */
    noteSwitched(noteContext: NoteContext, notePath: string | null | undefined) {
        if (notePath || !isNarrowLayout()) return;
        if (!noteContext.isMainContext() || noteContext.ntxId !== this.activeTabId) return;

        this.#findDetail();
        this.#withoutTransition(() => this.#setSidebarOpen(true));
        this.setActiveScreen(SCREEN);
    }

    noteContextsRemoved(ntxIds: string[]) {
        forgetTabs(ntxIds);
    }

    activeScreenChanged(activeScreen: Screen) {
        this.activeScreenName = activeScreen;
        if (this.activeTabId) setTabScreen(this.activeTabId, activeScreen);
        this.#findDetail();
        this.#setSidebarOpen(activeScreen === SCREEN);
    }

    #onDragStart(e: TouchEvent) {
        // The note comes back by opening it, not by a swipe. On the launch bar, a swipe changes tabs.
        const isOnTabSwipe = e.target instanceof Element && !!e.target.closest("#launcher-pane.tab-swipe");
        if (!isNarrowLayout() || this.currentTranslate !== -100 || isOnTabSwipe) {
            return;
        }

        const x = e.touches[0].clientX;
        this.startX = x;

        // Prevent dragging if too far from the edge of the screen.
        const dragRefX = glob.isRtl ? this.screenWidth - x : x;
        if (dragRefX > 30) {
            return;
        }

        this.#findDetail();
        this.dragState = DRAG_STATE_INITIAL_DRAG;
        this.translatePercentage = 0;
    }

    #onDragMove(e: TouchEvent) {
        if (this.dragState === DRAG_STATE_NONE || !this.startX) {
            return;
        }

        const x = e.touches[0].clientX;
        const deltaX = glob.isRtl ? this.startX - x : x - this.startX;
        if (this.dragState === DRAG_STATE_INITIAL_DRAG) {
            if (deltaX > DRAG_START_THRESHOLD) {
                /* Disable the transitions since they affect performance, they are going to reenabled once drag ends. */
                this.sidebarEl.style.transition = "none";
                this.sidebarEl.classList.add("dragging");
                if (this.detailEl) this.detailEl.style.transition = "none";

                this.dragState = DRAG_STATE_DRAGGING;
            }
        } else if (this.dragState === DRAG_STATE_DRAGGING) {
            const width = this.sidebarEl.offsetWidth;
            const translatePercentage = Math.min(0, Math.max(this.currentTranslate + (deltaX / width) * 100, -100));
            this.translatePercentage = translatePercentage;
            this.#applyTranslate(translatePercentage);
        }

        // Consume the event to prevent the user from doing the back to previous page gesture on iOS.
        e.preventDefault();
    }

    #onDragEnd() {
        if (this.dragState === DRAG_STATE_NONE) {
            return;
        }

        if (this.dragState === DRAG_STATE_INITIAL_DRAG) {
            this.dragState = DRAG_STATE_NONE;
            return;
        }

        this.sidebarEl.classList.remove("dragging");

        // Snap the tree open only if the user swiped over a threshold.
        const isOpen = this.translatePercentage > -(100 - DRAG_OPEN_THRESHOLD);
        const screen = isOpen ? "tree" : "detail";

        if (this.activeScreenName !== screen) {
            // Trigger the set active screen command for the rest of the UI to know whether the sidebar is active or not.
            // This allows the toggle sidebar button to work, by knowing the right state.
            this.setActiveScreen(screen);
        } else {
            // If the active screen hasn't changed, usually due to the user making a very short gesture that results in the tree not being opened,
            // we need to hide the animation but setActiveScreen command will not trigger the event since we are still on the same screen.
            this.#setSidebarOpen(isOpen);
        }
    }

    /** Finds the note beside the tree, which the splits can render after the tree. */
    #findDetail() {
        if (this.detailEl) return;

        this.detailEl = document.getElementById("detail-container") ?? undefined;
        this.originalDetailTransition = this.detailEl?.style.transition ?? "";
    }

    /**
     * Places the tree `translatePercentage` of the way from open (0) to closed (-100) by moving the
     * note off it. On a tablet, both stay in place.
     */
    #applyTranslate(translatePercentage: number) {
        if (!isNarrowLayout()) {
            this.sidebarEl.style.transform = "";
            if (this.detailEl) this.detailEl.style.transform = "";
            return;
        }

        const direction = glob.isRtl ? -1 : 1;
        const openness = 100 + translatePercentage;
        this.sidebarEl.style.transform = `translateX(${-direction * STACK_PARALLAX * (100 - openness) / 100}%)`;
        // At rest the note carries no transform: one makes it a stacking context, which keeps a
        // dialog it renders under Bootstrap's backdrop.
        if (this.detailEl) this.detailEl.style.transform = openness ? `translateX(${direction * openness}%)` : "";
    }

    #setSidebarOpen(isOpen: boolean) {
        this.sidebarEl.classList.toggle("show", isOpen);
        document.body.classList.toggle("mobile-sidebar-open", isOpen);
        this.#applyTranslate(isOpen ? 0 : -100);
        this.sidebarEl.style.transition = this.originalSidebarTransition;
        if (this.detailEl) this.detailEl.style.transition = this.originalDetailTransition;

        this.currentTranslate = isOpen ? 0 : -100;
        this.dragState = DRAG_STATE_NONE;
    }

    /** Applies `change` at once: the slide between the tree and the note is for moving within a tab. */
    #withoutTransition(change: () => void) {
        const container = this.sidebarEl.parentElement;
        if (!container) return change();

        container.classList.add("instant-screen-change");
        change();
        // Reading the layout applies the change while transitions are off.
        void container.offsetWidth;
        container.classList.remove("instant-screen-change");
    }
}
