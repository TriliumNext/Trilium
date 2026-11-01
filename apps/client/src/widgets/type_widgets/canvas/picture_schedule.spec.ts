import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("schedulePicture", () => {
    let schedulePicture: typeof import("./picture_schedule").schedulePicture;
    let watchPictures: typeof import("./picture_schedule").watchPictures;
    let drawPicture: typeof import("./picture_schedule").drawPicture;

    beforeEach(async () => {
        vi.useFakeTimers();
        // A new module, without the input and the pictures of the other tests.
        vi.resetModules();
        ({ schedulePicture, watchPictures, drawPicture } = await import("./picture_schedule"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("draws once the delay passes without another picture of the same drawing", async () => {
        const first = vi.fn(async () => {});
        const second = vi.fn(async () => {});
        const other = vi.fn(async () => {});

        schedulePicture("d1", first, 1000);
        schedulePicture("d2", other, 1000);
        await vi.advanceTimersByTimeAsync(600);
        schedulePicture("d1", second, 1000);
        await vi.advanceTimersByTimeAsync(600);
        expect(other).toHaveBeenCalledOnce();
        expect(second).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(400);
        expect(second).toHaveBeenCalledOnce();
        expect(first).not.toHaveBeenCalled();
    });

    it("draws a waiting picture at once when asked to, as when its editor closes", async () => {
        const draw = vi.fn(async () => {});
        schedulePicture("d1", draw, 5000);
        drawPicture("d1");
        drawPicture("nothing waits");
        await vi.advanceTimersByTimeAsync(0);
        expect(draw).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(10000);
        expect(draw).toHaveBeenCalledOnce();
    });

    it("waits until the user gives no input for a while, as during panning", async () => {
        const draw = vi.fn(async () => {});
        schedulePicture("d1", draw, 1000);

        await vi.advanceTimersByTimeAsync(900);
        document.dispatchEvent(new Event("wheel"));
        await vi.advanceTimersByTimeAsync(1950);
        expect(draw).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(50);
        expect(draw).toHaveBeenCalledOnce();
    });

    it("draws the waiting pictures once the page is hidden, and new ones at once", async () => {
        const draw = vi.fn(async () => {});
        schedulePicture("d1", draw, 30000);

        const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(0);
        expect(draw).toHaveBeenCalledOnce();

        // A save that ends after the page is hidden.
        const later = vi.fn(async () => {});
        schedulePicture("d2", later, 30000);
        await vi.advanceTimersByTimeAsync(0);
        expect(later).toHaveBeenCalledOnce();
        visibility.mockRestore();

        await vi.advanceTimersByTimeAsync(30000);
        expect(draw).toHaveBeenCalledOnce();
        expect(later).toHaveBeenCalledOnce();
    });

    it("draws the pictures of a drawing one after the other, also after a failed one", async () => {
        const order: string[] = [];
        let finishFirst = () => {};
        schedulePicture("d1", () => new Promise<void>((resolve, reject) => {
            order.push("first started");
            finishFirst = () => {
                order.push("first failed");
                reject(new Error("offline"));
            };
        }), 100);
        await vi.advanceTimersByTimeAsync(100);

        schedulePicture("d1", async () => {
            order.push("second started");
        }, 100);
        await vi.advanceTimersByTimeAsync(100);
        expect(order).toEqual([ "first started" ]);

        finishFirst();
        await vi.advanceTimersByTimeAsync(0);
        expect(order).toEqual([ "first started", "first failed", "second started" ]);
    });

    it("tells whether a picture of the drawing was scheduled since the watch began", () => {
        const draw = async () => {};
        schedulePicture("d1", draw, 1000);
        const isUnscheduled = watchPictures("d1");
        const isOtherUnscheduled = watchPictures("d2");

        schedulePicture("d2", draw, 1000);
        expect(isUnscheduled()).toBe(true);
        expect(isOtherUnscheduled()).toBe(false);

        schedulePicture("d1", draw, 1000);
        expect(isUnscheduled()).toBe(false);
        expect(watchPictures("d1")()).toBe(true);
    });
});
