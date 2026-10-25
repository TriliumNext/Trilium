import type { EventData } from "../../components/app_context.js";
import type { Screen } from "../../components/mobile_screen_switcher.js";
import type NoteContext from "../../components/note_context.js";
import options from "../../services/options.js";
import { onSystemBack } from "../../services/system_back.js";
import { isNarrowLayout, onNarrowLayoutChange } from "../../services/utils.js";
import type BasicWidget from "../basic_widget.js";
import FlexContainer, { type FlexDirection } from "../containers/flex_container.js";
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

/**
 * The note tree of the mobile layout. On a phone, the tree and the note form a navigation stack: the
 * tree lies under the note, which slides away to reveal it. On a tablet, the tree sits next to the note.
 */
export default class SidebarContainer extends FlexContainer<BasicWidget> {
    private screenName: Screen;
    /** The screen name that is currently active, according to the screen changed event. */
    private activeScreenName?: Screen;
    /** The main context ntxId of the active tab. */
    private activeTabId?: string;
    private currentTranslate: number;
    private dragState: number;
    private startX?: number;
    private translatePercentage: number;
    private sidebarEl!: HTMLElement;
    private detailEl?: HTMLElement;
    private originalSidebarTransition: string;
    private originalDetailTransition: string;
    private screenWidth: number;
    /** Whether the sidebar is shown in tablet mode, where it sits next to the note (same option as the left pane on desktop). */
    private leftPaneVisible: boolean;

    constructor(screenName: Screen, direction: FlexDirection) {
        super(direction);

        this.screenName = screenName;
        this.leftPaneVisible = options.is("leftPaneVisible");
        this.currentTranslate = -100;
        this.translatePercentage = 0;
        this.dragState = DRAG_STATE_NONE;
        this.originalSidebarTransition = "";
        this.originalDetailTransition = "";
        this.screenWidth = document.body.getBoundingClientRect().width;
    }

    doRender() {
        super.doRender();

        // Only has an effect in tablet mode, see `style.css`.
        this.$widget.toggleClass("left-pane-hidden", !this.leftPaneVisible);

        onNarrowLayoutChange(() => this.#setSidebarOpen(this.currentTranslate === 0));
        onSystemBack(() => {
            if (!isNarrowLayout() || this.activeScreenName === this.screenName) return false;
            this.triggerCommand("setActiveScreen", { screen: this.screenName });
            return true;
        });

        document.addEventListener("touchstart", (e) => this.#onDragStart(e));
        document.addEventListener("touchmove", (e) => this.#onDragMove(e), { passive: false });
        document.addEventListener("touchend", (e) => this.#onDragEnd(e));
    }

    #onDragStart(e: TouchEvent | MouseEvent) {
        // The note comes back by opening it, not by a swipe.
        if (!isNarrowLayout() || this.currentTranslate !== -100) {
            return;
        }

        const x = "touches" in e ? e.touches[0].clientX : e.clientX;
        this.startX = x;

        // Prevent dragging if too far from the edge of the screen.
        const dragRefX = glob.isRtl ? this.screenWidth - x : x;
        if (dragRefX > 30) {
            return;
        }

        this.#setInitialState();
        this.dragState = DRAG_STATE_INITIAL_DRAG;
        this.translatePercentage = 0;
    }

    #onDragMove(e: TouchEvent | MouseEvent) {
        if (this.dragState === DRAG_STATE_NONE || !this.startX) {
            return;
        }

        const x = "touches" in e ? e.touches[0].clientX : e.clientX;
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

    #onDragEnd(e: TouchEvent | MouseEvent) {
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
            this.triggerCommand("setActiveScreen", { screen });
        } else {
            // If the active screen hasn't changed, usually due to the user making a very short gesture that results in the tree not being opened,
            // we need to hide the animation but setActiveScreen command will not trigger the event since we are still on the same screen.
            this.#setSidebarOpen(isOpen);
        }
    }

    #setInitialState() {
        if (this.sidebarEl) {
            // Already initialized.
            return;
        }

        const sidebarEl = document.getElementById("mobile-sidebar-wrapper");
        if (!sidebarEl) {
            throw new Error("Unable to find the sidebar.");
        }

        this.sidebarEl = sidebarEl;
        this.originalSidebarTransition = this.sidebarEl.style.transition;

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
        if (!this.sidebarEl) {
            return;
        }

        this.sidebarEl.classList.toggle("show", isOpen);
        this.#applyTranslate(isOpen ? 0 : -100);
        this.sidebarEl.style.transition = this.originalSidebarTransition;
        if (this.detailEl) this.detailEl.style.transition = this.originalDetailTransition;

        this.currentTranslate = isOpen ? 0 : -100;
        this.dragState = DRAG_STATE_NONE;
    }

    setLeftPaneVisibilityEvent({ leftPaneVisible }: EventData<"setLeftPaneVisibility">) {
        const visible = leftPaneVisible ?? !this.leftPaneVisible;
        if (visible === this.leftPaneVisible) return;

        this.leftPaneVisible = visible;
        this.$widget.toggleClass("left-pane-hidden", !this.leftPaneVisible);

        options.save("leftPaneVisible", this.leftPaneVisible.toString());
    }

    activeContextChangedEvent({ noteContext }: EventData<"activeContextChanged">) {
        this.#switchToTab(noteContext);
    }

    noteSwitchedAndActivatedEvent({ noteContext }: EventData<"noteSwitchedAndActivated">) {
        this.#switchToTab(noteContext);
    }

    #switchToTab(noteContext: NoteContext) {
        const tabId = noteContext.getMainContext().ntxId;
        if (!tabId || tabId === this.activeTabId) return;
        this.activeTabId = tabId;

        // A tab that never showed the tree shows its note.
        if (isNarrowLayout()) {
            this.triggerCommand("setActiveScreen", { screen: getTabNavigation(tabId)?.screen ?? "detail" });
        }
    }

    noteContextRemovedEvent({ ntxIds }: EventData<"noteContextRemoved">) {
        forgetTabs(ntxIds);
    }

    activeScreenChangedEvent({ activeScreen }: EventData<"activeScreenChanged">) {
        this.activeScreenName = activeScreen;
        if (this.activeTabId) setTabScreen(this.activeTabId, activeScreen);
        this.#setInitialState();
        this.#setSidebarOpen(activeScreen === this.screenName);
    }
}
