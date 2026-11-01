import appContext, { type CommandNames } from "../../components/app_context";
import { isNarrowLayout } from "../../services/utils";
import { getTabNavigation } from "./tab_navigation";

export type SwipeDirection = "next" | "previous";

/** How much of the way to the other tab a released swipe must have slid to switch to it. */
const COMMIT_PROGRESS = 0.3;
/** How fast, in px/ms, a released flick must move toward the other tab to switch whatever its distance. */
const COMMIT_VELOCITY = 0.3;
/** The stiffness of the spring that finishes a released slide, per ms: it settles in about 300 ms. */
const SPRING_OMEGA = 0.022;
/** How close to its end, in progress, the spring counts as settled. */
const SPRING_REST = 0.002;
/** The longest the spring runs, in ms, whatever it started from. */
const SPRING_MAX_DURATION = 1000;
/** Longer than any swipe is held; the animation holding the transition open is canceled long before. */
const HOLD_DURATION = 1e9;
/** How far, as a share of its width, a swipe past the first or last tab can pull the screen at most. */
const OVERSCROLL_LIMIT = 0.25;
/** How quickly the pull past the first or last tab approaches `OVERSCROLL_LIMIT` as the finger moves. */
const OVERSCROLL_STIFFNESS = 2;

let activeTransition: ViewTransition | undefined;
let activeSplitSlide: SplitSlide | undefined;
let activeOverscroll: HTMLElement | undefined;

/** The note splits of a tab switch that slides them: their container and the incoming tab's split. */
interface SplitSlide {
    container: HTMLElement;
    incoming: HTMLElement;
}

/**
 * A tab switch whose slide follows the finger. `release()` carries the slide on to the other tab, or
 * back to the first one, on a spring that starts at the finger's speed.
 *
 * Between the notes of two tabs on a phone, the slide moves the tabs' note splits themselves, and the
 * tab switches once it settles on the other one. Otherwise the tab switches as the swipe starts,
 * inside a view transition whose animations stay paused while `move()` sets how far they have run,
 * and a slide that runs back switches back. Without view transitions, or with animations off, the
 * tab switches on release instead.
 *
 * Past the first or the last tab, the swipe pulls the shown screen with a growing resistance and
 * springs it back on release, with no tab to switch to.
 */
export class TabSwipe {
    /** Which way the content slides: toward the start for the next tab. */
    readonly slide: "left" | "right";
    private readonly direction: SwipeDirection;
    private progress = 0;
    private commit?: boolean;
    /** How fast the slide was moving toward the other tab as the finger lifted, in progress per ms. */
    private releaseVelocity = 0;
    private transition?: ViewTransition;
    private animations?: Animation[];
    private hold?: Animation;
    private skipped = false;
    private splitSlide?: SplitSlide;
    private readonly isPastEnd: boolean;
    private overscroll?: HTMLElement;

    constructor(direction: SwipeDirection) {
        this.direction = direction;
        this.slide = (direction === "next") !== glob.isRtl ? "left" : "right";

        this.isPastEnd = isPastLastTab(direction);
        if (document.body.classList.contains("motion-disabled")) return;
        if (this.isPastEnd) {
            this.overscroll = findShownScreen();
            if (this.overscroll) this.#startOverscroll();
            return;
        }
        this.splitSlide = findSplitSlide(direction);
        if (this.splitSlide) {
            this.#startSplitSlide(this.splitSlide);
        } else if (typeof document.startViewTransition === "function") {
            this.#startTransition();
        }
    }

    /** Moves the slide to `progress`, from 0 (the tab the swipe started on) to 1 (the other tab). */
    move(progress: number) {
        this.progress = Math.min(1, Math.max(0, progress));
        if (this.overscroll) {
            this.#placeOverscroll(this.overscroll);
        } else if (this.splitSlide) {
            this.#placeSplits(this.splitSlide);
        } else {
            this.#seek();
        }
    }

    /**
     * Ends the swipe; `velocity` is how fast, in px/ms, the finger was moving toward the other tab,
     * and `room` how far, in px, it travels for the whole slide.
     */
    release(velocity: number, room = window.innerWidth) {
        if (this.isPastEnd) {
            if (this.overscroll) void this.#settleOverscroll(this.overscroll);
            return;
        }
        this.commit = this.progress >= COMMIT_PROGRESS || velocity >= COMMIT_VELOCITY;
        this.releaseVelocity = velocity / room;
        if (this.splitSlide) {
            void this.#settleSplitSlide(this.splitSlide);
        } else if (!this.transition) {
            if (this.commit) void appContext.triggerCommand(getCommand(this.direction));
        } else if (this.animations) {
            void this.#settle();
        } else if (this.skipped) {
            this.#switchBackIfCanceled();
        }
    }

    #startOverscroll() {
        activeOverscroll = this.overscroll;
        document.documentElement.dataset.tabOverscroll = "";
    }

    #placeOverscroll(screen: HTMLElement) {
        const pull = OVERSCROLL_LIMIT * (1 - 1 / (1 + OVERSCROLL_STIFFNESS * this.progress));
        const offset = (this.slide === "left" ? -1 : 1) * pull;
        screen.style.transform = offset ? `translateX(calc(100% * ${offset}))` : "";
    }

    async #settleOverscroll(screen: HTMLElement) {
        this.commit = false;
        await this.#spring(0);
        screen.style.transform = "";
        delete document.documentElement.dataset.tabOverscroll;
        if (activeOverscroll === screen) activeOverscroll = undefined;
    }

    #startSplitSlide(slide: SplitSlide) {
        activeSplitSlide = slide;
        document.documentElement.dataset.tabDrag = this.slide;
        slide.incoming.classList.add("tab-slide-incoming");
    }

    #placeSplits({ container }: SplitSlide) {
        const offset = (this.slide === "left" ? -1 : 1) * this.progress;
        container.style.transform = offset ? `translateX(calc((100% + var(--tab-slide-gap)) * ${offset}))` : "";
    }

    async #settleSplitSlide(slide: SplitSlide) {
        await this.#spring(this.commit ? 1 : 0);
        // The incoming split stays in place until the switch shows it in its own right.
        if (this.commit) await appContext.triggerCommand(getCommand(this.direction));
        slide.container.style.transform = "";
        slide.incoming.classList.remove("tab-slide-incoming");
        delete document.documentElement.dataset.tabDrag;
        if (activeSplitSlide === slide) activeSplitSlide = undefined;
    }

    #startTransition() {
        const root = document.documentElement;
        root.dataset.tabSlide = this.slide;
        // The browser renders no frames until the update finishes, so it must not wait for one; what
        // Preact renders later still shows, as the incoming side of the slide is live.
        const transition = document.startViewTransition(async () => {
            // Styles that only the snapshots can show, as the page behind the transition no longer paints.
            root.dataset.tabSlideCaptured = "";
            await appContext.triggerCommand(getCommand(this.direction));
        });
        this.transition = transition;
        activeTransition = transition;

        transition.ready.then(() => this.#takeOver(), () => {
            // A skipped slide (a timeout, another transition) still switches the tab.
            this.skipped = true;
            if (this.commit !== undefined) this.#switchBackIfCanceled();
        });
        const cleanUp = () => {
            if (activeTransition !== transition) return;
            delete root.dataset.tabSlide;
            delete root.dataset.tabSlideCaptured;
            activeTransition = undefined;
        };
        transition.finished.then(cleanUp, cleanUp);
    }

    #takeOver() {
        const root = document.documentElement;
        this.animations = document.getAnimations().filter((animation) => {
            const effect = animation.effect as KeyframeEffect | null;
            return effect?.target === root && !!effect.pseudoElement?.startsWith("::view-transition");
        });
        for (const animation of this.animations) {
            animation.pause();
        }
        // The transition ends once its animations finish; this one keeps it open until the swipe settles.
        this.hold = root.animate([], { duration: HOLD_DURATION, pseudoElement: "::view-transition" });
        this.#seek();
        if (this.commit !== undefined) void this.#settle();
    }

    #seek() {
        for (const animation of this.animations ?? []) {
            animation.currentTime = this.progress * getDuration(animation);
        }
    }

    async #settle() {
        const target = this.commit ? 1 : 0;
        await this.#spring(target);

        // Finished, not paused, so that the transition can end once the hold is canceled.
        for (const animation of this.animations ?? []) {
            animation.playbackRate = target ? 1 : -1;
            animation.finish();
        }
        if (!this.commit) {
            await appContext.triggerCommand(getCommand(getOpposite(this.direction)));
            // The transition reveals the page as it ends, so the first tab is drawn before that.
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        this.hold?.cancel();
        // The snapshots stay up until the next frame removes them, and that frame paints the
        // revealed page after its `requestAnimationFrame()` callbacks run.
        requestAnimationFrame(() => delete document.documentElement.dataset.tabSlideCaptured);
    }

    /** Moves the slide to `target` on a critically damped spring, which settles without bouncing. */
    #spring(target: number) {
        const offset = this.progress - target;
        const velocity = this.releaseVelocity;
        return new Promise<void>((resolve) => {
            let start: number | undefined;
            const step = (time: number) => {
                start ??= time;
                const elapsed = time - start;
                const position = (offset + (velocity + SPRING_OMEGA * offset) * elapsed)
                    * Math.exp(-SPRING_OMEGA * elapsed);
                const isSettled = (elapsed > 0 && Math.abs(position) < SPRING_REST)
                    || elapsed >= SPRING_MAX_DURATION;
                this.move(isSettled ? target : target + position);
                if (isSettled) resolve();
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }

    #switchBackIfCanceled() {
        if (!this.commit) void appContext.triggerCommand(getCommand(getOpposite(this.direction)));
    }
}

/** Whether a swipe's slide is still running, during which another swipe does not start. */
export function isTabSwipeActive() {
    return !!activeTransition || !!activeSplitSlide || !!activeOverscroll;
}

/** Whether the active tab is the last one toward `direction`. */
function isPastLastTab(direction: SwipeDirection) {
    const tabs = appContext.tabManager.getMainNoteContexts();
    return tabs.some((tab) => tab.ntxId === appContext.tabManager.getActiveMainContext()?.ntxId)
        && !getTabToward(direction);
}

/** The screen a swipe past the first or last tab pulls: the tree while a phone shows it, or the notes. */
function findShownScreen() {
    const sidebar = document.getElementById("mobile-sidebar-wrapper");
    if (isNarrowLayout() && sidebar?.classList.contains("show")) {
        return sidebar.firstElementChild instanceof HTMLElement ? sidebar.firstElementChild : undefined;
    }
    return document.querySelector<HTMLElement>("#detail-container > .split-note-container-widget") ?? undefined;
}

/** The tab next to the active one toward `direction`, if the active one is not the last that way. */
export function getTabToward(direction: SwipeDirection) {
    const tabs = appContext.tabManager.getMainNoteContexts();
    const index = tabs.findIndex((tab) => tab.ntxId === appContext.tabManager.getActiveMainContext()?.ntxId);
    if (index < 0) return;
    return tabs[index + (direction === "next" ? 1 : -1)];
}

/**
 * The splits to slide toward the tab `direction` leads to, on the note screen of a phone: both tabs
 * must show their note in a single split, and the incoming one must have been rendered.
 */
function findSplitSlide(direction: SwipeDirection): SplitSlide | undefined {
    if (!isNarrowLayout() || document.getElementById("mobile-sidebar-wrapper")?.classList.contains("show")) return;

    const current = appContext.tabManager.getActiveMainContext();
    const target = getTabToward(direction);
    if (!current || !target?.ntxId || (getTabNavigation(target.ntxId)?.screen ?? "detail") !== "detail") return;
    if (current.getSubContexts().length !== 1 || target.getSubContexts().length !== 1) return;

    const container = document.querySelector<HTMLElement>("#detail-container > .split-note-container-widget");
    const incoming = container?.querySelector<HTMLElement>(`:scope > [data-ntx-id="${target.ntxId}"]`);
    if (!container || !incoming?.classList.contains("note-split") || incoming.classList.contains("empty-note")) return;
    return { container, incoming };
}

function getCommand(direction: SwipeDirection): CommandNames {
    return direction === "next" ? "activateNextTab" : "activatePreviousTab";
}

function getOpposite(direction: SwipeDirection): SwipeDirection {
    return direction === "next" ? "previous" : "next";
}

function getDuration(animation: Animation) {
    const duration = animation.effect?.getComputedTiming().duration;
    return typeof duration === "number" ? duration : 0;
}
