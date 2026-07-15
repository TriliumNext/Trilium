import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { awaitImageReveal } from "./image_decode";

type DecodableImage = HTMLImageElement & { decode?: () => Promise<void> };

function makeImage({ decode, complete = false, naturalWidth = 0 }: {
    decode?: (() => Promise<void>) | undefined;
    complete?: boolean;
    naturalWidth?: number;
}): DecodableImage {
    const img = document.createElement("img") as DecodableImage;
    // lib.dom declares decode() as required; widen so the no-decode() runtime can be simulated.
    (img as { decode: (() => Promise<void>) | undefined }).decode = decode;
    Object.defineProperty(img, "complete", { value: complete });
    Object.defineProperty(img, "naturalWidth", { value: naturalWidth });
    return img;
}

describe("awaitImageReveal", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("resolves ok when decode() succeeds", async () => {
        const { promise } = awaitImageReveal(makeImage({ decode: () => Promise.resolve() }));
        await expect(promise).resolves.toBe("ok");
    });

    it("resolves ok when decode() rejects but the image actually loaded (Chrome Android memory limits)", async () => {
        const img = makeImage({ decode: () => Promise.reject(new Error("EncodingError")), complete: true, naturalWidth: 4000 });
        const { promise } = awaitImageReveal(img);
        await expect(promise).resolves.toBe("ok");
    });

    it("resolves error when decode() rejects for an image that truly failed to load", async () => {
        const img = makeImage({ decode: () => Promise.reject(new Error("broken")) });
        const { promise } = awaitImageReveal(img);
        await expect(promise).resolves.toBe("error");
    });

    it("resolves ok via the fallback timer when decode() never settles (e.g. some SVGs)", async () => {
        const img = makeImage({ decode: () => new Promise(() => {}) });
        const { promise } = awaitImageReveal(img, 1000);
        const settled = vi.fn();
        void promise.then(settled);

        await vi.advanceTimersByTimeAsync(999);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await expect(promise).resolves.toBe("ok");
    });

    it("resolves ok immediately where decode() is unavailable (ancient/headless runtimes)", async () => {
        const { promise } = awaitImageReveal(makeImage({ decode: undefined }));
        await expect(promise).resolves.toBe("ok");
    });

    it("settles only once and never after cancel()", async () => {
        let rejectDecode: (reason: Error) => void = () => {};
        const img = makeImage({ decode: () => new Promise((_resolve, reject) => { rejectDecode = reject; }) });
        const { promise, cancel } = awaitImageReveal(img, 1000);
        const settled = vi.fn();
        void promise.then(settled);

        cancel();
        rejectDecode(new Error("late"));
        await vi.advanceTimersByTimeAsync(5000);
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
    });
});
