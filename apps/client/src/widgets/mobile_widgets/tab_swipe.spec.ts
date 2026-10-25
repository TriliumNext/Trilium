import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import { isTabSwipeActive, TabSwipe } from "./tab_swipe";

describe("TabSwipe", () => {
    let log: string[];

    beforeEach(() => {
        glob.isRtl = false;
        log = [];
        vi.spyOn(appContext, "triggerCommand").mockImplementation(async (name) => {
            log.push(name);
        });
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            callback(0);
            return 0;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(document, "startViewTransition");
        Reflect.deleteProperty(document, "getAnimations");
        Reflect.deleteProperty(document.documentElement, "animate");
    });

    /** A view transition whose slide animates the content's two sides and is held open by `TabSwipe`. */
    function fakeTransition({ skipped = false } = {}) {
        const root = document.documentElement;
        const animation = (target: Element, pseudoElement: string) => ({
            currentTime: 0,
            playbackRate: 1,
            paused: false,
            effect: { target, pseudoElement, getComputedTiming: () => ({ duration: 250 }) },
            pause() {
                this.paused = true;
            },
            play() {
                this.paused = false;
                this.currentTime = this.playbackRate > 0 ? 250 : 0;
            },
            finished: Promise.resolve()
        });
        const outgoing = animation(root, "::view-transition-old(tab-content)");
        const incoming = animation(root, "::view-transition-new(tab-content)");
        const unrelated = animation(document.body, "");
        document.getAnimations = () => [ outgoing, incoming, unrelated ] as unknown as Animation[];

        let end = () => {};
        const finished = new Promise<void>((resolve) => { end = resolve; });
        document.documentElement.animate = vi.fn(() => ({
            cancel() {
                log.push("end");
                end();
            }
        })) as unknown as typeof root.animate;
        document.startViewTransition = ((update: () => Promise<void>) => {
            const updated = update();
            if (skipped) updated.then(end);
            return {
                ready: skipped ? Promise.reject(new DOMException("Skipped", "AbortError")) : updated,
                finished
            };
        }) as unknown as typeof document.startViewTransition;
        return { outgoing, incoming, unrelated, finished };
    }

    it("follows the finger, then plays on to the other tab once released far enough", async () => {
        const { outgoing, incoming, unrelated, finished } = fakeTransition();

        const swipe = new TabSwipe("next");
        expect(document.documentElement.dataset.tabSlide).toBe("left");
        expect(isTabSwipeActive()).toBe(true);
        await vi.waitFor(() => expect(outgoing.paused).toBe(true));
        expect(log).toEqual([ "activateNextTab" ]);

        swipe.move(0.5);
        expect([ outgoing.currentTime, incoming.currentTime, unrelated.currentTime ]).toEqual([ 125, 125, 0 ]);
        swipe.move(1.4);
        expect(outgoing.currentTime).toBe(250);

        swipe.move(0.4);
        swipe.release(0);
        expect(outgoing.playbackRate).toBeGreaterThan(0);
        await finished;
        await vi.waitFor(() => expect(isTabSwipeActive()).toBe(false));
        expect(log).toEqual([ "activateNextTab", "end" ]);
        expect(document.documentElement.dataset.tabSlide).toBeUndefined();
    });

    it("runs back and switches back to the first tab, before the slide ends, when released short", async () => {
        const { outgoing, finished } = fakeTransition();

        const swipe = new TabSwipe("next");
        await vi.waitFor(() => expect(outgoing.paused).toBe(true));
        swipe.move(0.1);
        swipe.release(0);
        expect(outgoing.playbackRate).toBeLessThan(0);
        await finished;
        expect(log).toEqual([ "activateNextTab", "activatePreviousTab", "end" ]);
    });

    it("settles a flick released before the slide takes over", async () => {
        const { outgoing, finished } = fakeTransition();

        const swipe = new TabSwipe("previous");
        swipe.move(0.05);
        swipe.release(1);
        await finished;
        expect(outgoing.currentTime).toBe(250);
        expect(log).toEqual([ "activatePreviousTab", "end" ]);
    });

    it("switches back on a short release when the browser skips the slide", async () => {
        const { finished } = fakeTransition({ skipped: true });

        const swipe = new TabSwipe("next");
        swipe.release(0);
        await finished;
        await vi.waitFor(() => expect(log).toEqual([ "activateNextTab", "activatePreviousTab" ]));
    });

    it("switches on release without view transitions, if the swipe went far or fast enough", () => {
        const short = new TabSwipe("previous");
        short.move(0.1);
        short.release(0);
        expect(log).toEqual([]);

        const far = new TabSwipe("previous");
        far.move(0.5);
        far.release(0);
        expect(log).toEqual([ "activatePreviousTab" ]);
        expect(document.documentElement.dataset.tabSlide).toBeUndefined();

        glob.isRtl = true;
        expect(new TabSwipe("next").slide).toBe("right");
    });
});
