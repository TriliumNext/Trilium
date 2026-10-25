import appContext, { type CommandNames } from "../../components/app_context";

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

let activeTransition: ViewTransition | undefined;

/**
 * A tab switch whose slide follows the finger. The tab switches as the swipe starts, inside a view
 * transition whose animations stay paused while `move()` sets how far they have run. `release()`
 * carries them on to the other tab, or back to the first one and switches back to it, on a spring
 * that starts at the finger's speed. Without view
 * transitions, or with animations off, the tab switches on release instead.
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

    constructor(direction: SwipeDirection) {
        this.direction = direction;
        this.slide = (direction === "next") !== glob.isRtl ? "left" : "right";

        const canSlide = typeof document.startViewTransition === "function"
            && !document.body.classList.contains("motion-disabled");
        if (canSlide) this.#startTransition();
    }

    /** Moves the slide to `progress`, from 0 (the tab the swipe started on) to 1 (the other tab). */
    move(progress: number) {
        this.progress = Math.min(1, Math.max(0, progress));
        this.#seek();
    }

    /**
     * Ends the swipe; `velocity` is how fast, in px/ms, the finger was moving toward the other tab,
     * and `room` how far, in px, it travels for the whole slide.
     */
    release(velocity: number, room = window.innerWidth) {
        this.commit = this.progress >= COMMIT_PROGRESS || velocity >= COMMIT_VELOCITY;
        this.releaseVelocity = velocity / room;
        if (!this.transition) {
            if (this.commit) void appContext.triggerCommand(getCommand(this.direction));
        } else if (this.animations) {
            void this.#settle();
        } else if (this.skipped) {
            this.#switchBackIfCanceled();
        }
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
    return !!activeTransition;
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
