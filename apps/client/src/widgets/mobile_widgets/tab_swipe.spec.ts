import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import { forgetTabs, setTabScreen } from "./tab_navigation";
import { isTabSwipeActive, TabSwipe } from "./tab_swipe";

describe("TabSwipe", () => {
    let log: string[];

    beforeEach(() => {
        glob.isRtl = false;
        log = [];
        vi.spyOn(appContext, "triggerCommand").mockImplementation(async (name) => {
            log.push(name);
        });
        let now = 0;
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            now += 16;
            const time = now;
            setTimeout(() => callback(time));
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
        const animation = (target: Element, pseudoElement: string) => {
            let currentTime = 0;
            return {
                /** Every position the slide was moved to. */
                positions: [] as number[],
                get currentTime() {
                    return currentTime;
                },
                set currentTime(time: number) {
                    currentTime = time;
                    this.positions.push(time);
                },
                playbackRate: 1,
                paused: false,
                effect: { target, pseudoElement, getComputedTiming: () => ({ duration: 250 }) },
                pause() {
                    this.paused = true;
                },
                finish() {
                    this.paused = false;
                    currentTime = this.playbackRate > 0 ? 250 : 0;
                }
            };
        };
        const outgoing = animation(root, "::view-transition-old(tab-content)");
        const incoming = animation(root, "::view-transition-new(tab-content)");
        const unrelated = animation(document.body, "");
        document.getAnimations = () => [ outgoing, incoming, unrelated ] as unknown as Animation[];

        /** Whether `data-tab-slide-captured` is set as the transition starts and as its hold ends. */
        const captured: string[] = [];
        const isCaptured = () => root.dataset.tabSlideCaptured !== undefined;
        let end = () => {};
        const finished = new Promise<void>((resolve) => { end = resolve; });
        document.documentElement.animate = vi.fn(() => ({
            cancel() {
                captured.push(`at end: ${isCaptured()}`);
                log.push("end");
                end();
            }
        })) as unknown as typeof root.animate;
        document.startViewTransition = ((update: () => Promise<void>) => {
            captured.push(`at start: ${isCaptured()}`);
            const updated = update();
            if (skipped) updated.then(end);
            return {
                ready: skipped ? Promise.reject(new DOMException("Skipped", "AbortError")) : updated,
                finished
            };
        }) as unknown as typeof document.startViewTransition;
        return { outgoing, incoming, unrelated, finished, captured, isCaptured };
    }

    it("follows the finger, then plays on to the other tab once released far enough", async () => {
        const { outgoing, incoming, unrelated, finished, captured, isCaptured } = fakeTransition();

        const swipe = new TabSwipe("next");
        expect(document.documentElement.dataset.tabSlide).toBe("left");
        expect(isTabSwipeActive()).toBe(true);
        await vi.waitFor(() => expect(outgoing.paused).toBe(true));
        expect(log).toEqual([ "activateNextTab" ]);
        // Marked only once the old state is captured, so the live page never paints with it.
        expect(isCaptured()).toBe(true);

        swipe.move(0.5);
        expect([ outgoing.currentTime, incoming.currentTime, unrelated.currentTime ]).toEqual([ 125, 125, 0 ]);
        swipe.move(1.4);
        expect(outgoing.currentTime).toBe(250);

        swipe.move(0.4);
        outgoing.positions.length = 0;
        swipe.release(0);
        await finished;
        // The spring carries the slide on from where the finger left it, without passing the end.
        expect(outgoing.positions.length).toBeGreaterThan(5);
        expect(outgoing.positions).toEqual([ ...outgoing.positions ].sort((a, b) => a - b));
        expect(outgoing.positions[0]).toBe(100);
        expect(outgoing.positions.at(-1)).toBe(250);
        expect(outgoing.currentTime).toBe(250);
        // A paused animation would keep the transition from ending.
        expect(outgoing.paused).toBe(false);
        await vi.waitFor(() => expect(isTabSwipeActive()).toBe(false));
        expect(log).toEqual([ "activateNextTab", "end" ]);
        expect(document.documentElement.dataset.tabSlide).toBeUndefined();
        // Kept as the hold ends, since the snapshots stay up until the next frame removes them.
        expect(captured).toEqual([ "at start: false", "at end: true" ]);
        expect(isCaptured()).toBe(false);
    });

    it("runs back and switches back to the first tab, before the slide ends, when released short", async () => {
        const { outgoing, finished } = fakeTransition();

        const swipe = new TabSwipe("next");
        await vi.waitFor(() => expect(outgoing.paused).toBe(true));
        swipe.move(0.1);
        swipe.release(0);
        await finished;
        expect(outgoing.positions.at(-1)).toBe(0);
        expect(outgoing.currentTime).toBe(0);
        expect(log).toEqual([ "activateNextTab", "activatePreviousTab", "end" ]);
    });

    it("starts the spring at the speed of the finger", async () => {
        const firstStep = async (velocity: number) => {
            const { outgoing, finished } = fakeTransition();
            const swipe = new TabSwipe("next");
            await vi.waitFor(() => expect(outgoing.paused).toBe(true));
            swipe.move(0.5);
            outgoing.positions.length = 0;
            swipe.release(velocity, 400);
            await finished;
            return outgoing.positions[1] - outgoing.positions[0];
        };

        const resting = await firstStep(0);
        const flicked = await firstStep(2);
        expect(resting).toBeGreaterThan(0);
        expect(flicked).toBeGreaterThan(2 * resting);
    });

    it("settles a flick released before the slide takes over", async () => {
        const { outgoing, finished } = fakeTransition();

        const swipe = new TabSwipe("previous");
        swipe.move(0.05);
        swipe.release(1);
        await finished;
        expect(outgoing.currentTime).toBe(250);
        // A paused animation would keep the transition from ending.
        expect(outgoing.paused).toBe(false);
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

    describe("on the note screen of a phone", () => {
        const { tabManager } = appContext;
        let startViewTransition: ReturnType<typeof vi.fn>;
        let splits: HTMLElement;

        beforeEach(() => {
            vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
                matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()
            }) as unknown as MediaQueryList);
            const pending = new Promise<void>(() => {});
            startViewTransition = vi.fn(() => ({ ready: pending, finished: pending }));
            document.startViewTransition = startViewTransition as unknown as typeof document.startViewTransition;

            const tab = (ntxId: string) => {
                const noteContext = { ntxId } as NoteContext;
                noteContext.getSubContexts = () => [ noteContext ];
                return noteContext;
            };
            const tabs = [ tab("first"), tab("second") ];
            appContext.tabManager = {
                getActiveMainContext: () => tabs[0],
                getMainNoteContexts: () => tabs
            } as unknown as typeof tabManager;

            document.body.innerHTML = `
                <div id="mobile-rest-container">
                    <div id="mobile-sidebar-wrapper"></div>
                    <div id="detail-container"><div class="split-note-container-widget">
                        <div class="note-split visible" data-ntx-id="first"></div>
                        <div class="note-split hidden-ext" data-ntx-id="second"></div>
                    </div></div>
                </div>`;
            const container = document.querySelector<HTMLElement>(".split-note-container-widget");
            if (!container) throw new Error("expected the splits");
            splits = container;
        });

        afterEach(() => {
            appContext.tabManager = tabManager;
            forgetTabs([ "second" ]);
            document.body.innerHTML = "";
        });

        const incoming = () => splits.querySelector<HTMLElement>("[data-ntx-id=second]");

        it("slides the two tabs' notes, and switches tabs only once the slide settles", async () => {
            const swipe = new TabSwipe("next");
            expect(startViewTransition).not.toHaveBeenCalled();
            expect(isTabSwipeActive()).toBe(true);
            expect(document.documentElement.dataset.tabDrag).toBe("left");
            expect(incoming()?.classList.contains("tab-slide-incoming")).toBe(true);

            swipe.move(0.5);
            expect(splits.style.transform).toBe("translateX(calc((100% + var(--tab-slide-gap)) * -0.5))");
            expect(log).toEqual([]);

            swipe.release(0.5);
            await vi.waitFor(() => expect(isTabSwipeActive()).toBe(false));
            expect(log).toEqual([ "activateNextTab" ]);
            expect(splits.style.transform).toBe("");
            expect(incoming()?.classList.contains("tab-slide-incoming")).toBe(false);
            expect(document.documentElement.dataset.tabDrag).toBeUndefined();
        });

        it("runs back without switching tabs when released short, and slides the other way for the previous tab", async () => {
            const swipe = new TabSwipe("previous");
            expect(document.documentElement.dataset.tabDrag).toBe("right");
            swipe.move(0.1);
            expect(splits.style.transform).toBe("translateX(calc((100% + var(--tab-slide-gap)) * 0.1))");

            swipe.release(0);
            await vi.waitFor(() => expect(isTabSwipeActive()).toBe(false));
            expect(log).toEqual([]);
            expect(splits.style.transform).toBe("");
            expect(incoming()?.classList.contains("tab-slide-incoming")).toBe(false);
        });

        it("keeps the view transition for a tab not shown yet, or one left on its tree", () => {
            incoming()?.classList.add("empty-note");
            new TabSwipe("next");
            expect(startViewTransition).toHaveBeenCalledTimes(1);
            expect(incoming()?.classList.contains("tab-slide-incoming")).toBe(false);

            incoming()?.classList.remove("empty-note");
            setTabScreen("second", "tree");
            new TabSwipe("next");
            expect(startViewTransition).toHaveBeenCalledTimes(2);
            expect(document.documentElement.dataset.tabDrag).toBeUndefined();
        });
    });
});
