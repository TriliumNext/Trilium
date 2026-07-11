import type { EventData } from "../../components/app_context.js";
import type { Screen } from "../../components/mobile_screen_switcher.js";
import type BasicWidget from "../basic_widget.js";
import FlexContainer, { type FlexDirection } from "../containers/flex_container.js";

const DRAG_STATE_NONE = 0;
const DRAG_STATE_INITIAL_DRAG = 1;
const DRAG_STATE_DRAGGING = 2;

/** Percentage of drag that the user has to do in order for the popup to open (0-100). */
const DRAG_OPEN_THRESHOLD = 10;

/** The number of pixels the user has to drag across the screen to the right when the sidebar is closed to trigger the drag open animation. */
const DRAG_CLOSED_START_THRESHOLD = 10;
/** The number of pixels the user has to drag across the screen to the left when the sidebar is opened to trigger the drag close animation. */
const DRAG_OPENED_START_THRESHOLD = 100;

export default class SidebarContainer extends FlexContainer<BasicWidget> {
    private screenName: Screen;
    /** The screen name that is currently active, according to the screen changed event. */
    private activeScreenName?: Screen;
    private currentTranslate: number;
    private dragState: number;
    private startX?: number;
    private translatePercentage: number;
    private sidebarEl!: HTMLElement;
    private backdropEl!: HTMLElement;
    private originalSidebarTransition: string;
    private originalBackdropTransition: string;
    private screenWidth: number;

    constructor(screenName: Screen, direction: FlexDirection) {
        super(direction);

        this.screenName = screenName;
        this.currentTranslate = -100;
        this.translatePercentage = 0;
        this.dragState = DRAG_STATE_NONE;
        this.originalSidebarTransition = "";
        this.originalBackdropTransition = "";
        this.screenWidth = document.body.getBoundingClientRect().width;
    }

    doRender() {
        super.doRender();

        document.addEventListener("touchstart", (e) => this.#onDragStart(e));
        document.addEventListener("touchmove", (e) => this.#onDragMove(e), { passive: false });
        document.addEventListener("touchend", (e) => this.#onDragEnd(e));
    }

    #onDragStart(e: TouchEvent | MouseEvent) {
        const x = "touches" in e ? e.touches[0].clientX : e.clientX;
        this.startX = x;

        // Prevent dragging if too far from the edge of the screen and the menu is closed.
        const dragRefX = glob.isRtl ? this.screenWidth - x : x;
        if (dragRefX > 30 && this.currentTranslate === -100) {
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
            if (this.currentTranslate === -100 ? deltaX > DRAG_CLOSED_START_THRESHOLD : deltaX < -DRAG_OPENED_START_THRESHOLD) {
                /* Disable the transitions since they affect performance, they are going to reenabled once drag ends. */
                this.sidebarEl.style.transition = "none";
                this.backdropEl.style.transition = "none";

                this.backdropEl.style.opacity = String(this.currentTranslate === -100 ? 0 : 1);
                this.backdropEl.classList.add("show");

                this.dragState = DRAG_STATE_DRAGGING;
            }

            if (this.currentTranslate !== -100) {
                // Return early to avoid consuming the event, this allows the user to scroll vertically.
                return;
            }
        } else if (this.dragState === DRAG_STATE_DRAGGING) {
            const width = this.sidebarEl.offsetWidth;
            const translatePercentage = Math.min(0, Math.max(this.currentTranslate + (deltaX / width) * 100, -100));
            const backdropOpacity = Math.max(0, 1 + translatePercentage / 100);
            this.translatePercentage = translatePercentage;
            if (glob.isRtl) {
                this.sidebarEl.style.transform = `translateX(${-translatePercentage}%)`;
            } else {
                this.sidebarEl.style.transform = `translateX(${translatePercentage}%)`;
            }
            this.backdropEl.style.opacity = String(backdropOpacity);
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

        // If the sidebar is closed, snap the sidebar open only if the user swiped over a threshold.
        // When the sidebar is open, always close for a smooth experience.
        const isOpen = this.currentTranslate === -100 && this.translatePercentage > -(100 - DRAG_OPEN_THRESHOLD);
        const screen = isOpen ? "tree" : "detail";

        if (this.activeScreenName !== screen) {
            // Trigger the set active screen command for the rest of the UI to know whether the sidebar is active or not.
            // This allows the toggle sidebar button to work, by knowing the right state.
            this.triggerCommand("setActiveScreen", { screen });
        } else {
            // If the active screen hasn't changed, usually due to the user making a very short gesture that results in the sidebar not being closed/opened,
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
        const backdropEl = document.getElementById("mobile-sidebar-container");
        backdropEl?.addEventListener("click", () => {
            this.triggerCommand("setActiveScreen", { screen: "detail" });
        });

        if (!sidebarEl || !backdropEl) {
            throw new Error("Unable to find the sidebar or backdrop.");
        }

        this.sidebarEl = sidebarEl;
        this.backdropEl = backdropEl;
        this.originalSidebarTransition = this.sidebarEl.style.transition;
        this.originalBackdropTransition = this.backdropEl.style.transition;
    }

    #setSidebarOpen(isOpen: boolean) {
        if (!this.sidebarEl) {
            return;
        }

        this.sidebarEl.classList.toggle("show", isOpen);
        if (isOpen) {
            this.sidebarEl.style.transform = "translateX(0)";
        } else if (glob.isRtl) {
            this.sidebarEl.style.transform = "translateX(100%)";
        } else {
            this.sidebarEl.style.transform = "translateX(-100%)";
        }
        this.sidebarEl.style.transition = this.originalSidebarTransition;

        this.backdropEl.classList.toggle("show", isOpen);
        this.backdropEl.style.transition = this.originalBackdropTransition;
        this.backdropEl.style.opacity = String(isOpen ? 1 : 0);

        this.currentTranslate = isOpen ? 0 : -100;
        this.dragState = DRAG_STATE_NONE;
    }

    activeScreenChangedEvent({ activeScreen }: EventData<"activeScreenChanged">) {
        this.activeScreenName = activeScreen;
        this.#setInitialState();
        this.#setSidebarOpen(activeScreen === this.screenName);
    }
}
