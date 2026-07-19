import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_ORIENTATION,
    flipOrientationHorizontal,
    isDefaultOrientation,
    type Orientation,
    renderOrientedImage,
    rotateOrientation
} from "./orientation";

describe("orientation math", () => {
    it("starts at the default orientation", () => {
        expect(DEFAULT_ORIENTATION).toEqual({ quarterTurns: 0, flipX: false });
        expect(isDefaultOrientation(DEFAULT_ORIENTATION)).toBe(true);
        expect(isDefaultOrientation({ quarterTurns: 1, flipX: false })).toBe(false);
        expect(isDefaultOrientation({ quarterTurns: 0, flipX: true })).toBe(false);
    });

    it("accumulates quarter turns in both directions with wrap-around", () => {
        let orientation = rotateOrientation(DEFAULT_ORIENTATION, 90);
        expect(orientation).toEqual({ quarterTurns: 1, flipX: false });
        orientation = rotateOrientation(orientation, 90);
        orientation = rotateOrientation(orientation, 90);
        orientation = rotateOrientation(orientation, 90);
        expect(orientation).toEqual(DEFAULT_ORIENTATION);
        expect(rotateOrientation(DEFAULT_ORIENTATION, -90)).toEqual({ quarterTurns: 3, flipX: false });
        expect(rotateOrientation({ quarterTurns: 3, flipX: false }, 90)).toEqual({ quarterTurns: 0, flipX: false });
    });

    it("mirrors what the user sees: flipping a rotated view negates the rotation", () => {
        // Display transform is R(quarterTurns) ∘ F(flipX); a visual mirror composes on the left,
        // and Fx ∘ R(θ) = R(-θ) ∘ Fx, so the stored rotation flips sign.
        expect(flipOrientationHorizontal(DEFAULT_ORIENTATION)).toEqual({ quarterTurns: 0, flipX: true });
        expect(flipOrientationHorizontal({ quarterTurns: 1, flipX: false })).toEqual({ quarterTurns: 3, flipX: true });
        expect(flipOrientationHorizontal({ quarterTurns: 2, flipX: false })).toEqual({ quarterTurns: 2, flipX: true });
    });

    it("flipping twice restores the original orientation, from any rotation", () => {
        for (const quarterTurns of [ 0, 1, 2, 3 ]) {
            for (const flipX of [ false, true ]) {
                const start: Orientation = { quarterTurns, flipX };
                expect(flipOrientationHorizontal(flipOrientationHorizontal(start))).toEqual(start);
            }
        }
    });

    it("rotating a flipped view still turns the visible image in the requested direction", () => {
        // Rotation also composes on the left: R(90) ∘ R(q) ∘ F(f) = R(q+1) ∘ F(f).
        expect(rotateOrientation({ quarterTurns: 0, flipX: true }, 90)).toEqual({ quarterTurns: 1, flipX: true });
        expect(rotateOrientation({ quarterTurns: 3, flipX: true }, -90)).toEqual({ quarterTurns: 2, flipX: true });
    });
});

describe("renderOrientedImage", () => {
    interface MockContext {
        translate: ReturnType<typeof vi.fn>;
        rotate: ReturnType<typeof vi.fn>;
        scale: ReturnType<typeof vi.fn>;
        drawImage: ReturnType<typeof vi.fn>;
    }

    let context: MockContext;
    let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> };
    let createdUrls: string[];
    let revokedUrls: string[];

    const loadImage = vi.fn(async () => ({ naturalWidth: 800, naturalHeight: 600 }) as HTMLImageElement);

    beforeEach(() => {
        context = { translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() };
        canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
            toBlob: vi.fn((callback: (blob: Blob | null) => void) => callback(new Blob([ "png" ], { type: "image/png" })))
        };
        const realCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
            tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : realCreateElement(tag));

        createdUrls = [];
        revokedUrls = [];
        let counter = 0;
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: vi.fn(() => {
                const url = `blob:mock-${++counter}`;
                createdUrls.push(url);
                return url;
            }),
            revokeObjectURL: vi.fn((url: string) => revokedUrls.push(url))
        });
        loadImage.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("draws the source rotated around the output center and reports swapped dimensions on odd turns", async () => {
        const result = await renderOrientedImage("api/images/n1/x.png", { quarterTurns: 1, flipX: false }, loadImage);

        expect(loadImage).toHaveBeenCalledWith("api/images/n1/x.png");
        expect(canvas.width).toBe(600);
        expect(canvas.height).toBe(800);
        expect(context.translate).toHaveBeenCalledWith(300, 400);
        expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
        expect(context.scale).toHaveBeenCalledWith(1, 1);
        expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), -400, -300);
        expect(result).toMatchObject({ url: "blob:mock-1", width: 600, height: 800 });
    });

    it("keeps dimensions and mirrors horizontally for a pure flip", async () => {
        const result = await renderOrientedImage("src", { quarterTurns: 0, flipX: true }, loadImage);

        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(600);
        expect(context.rotate).toHaveBeenCalledWith(0);
        expect(context.scale).toHaveBeenCalledWith(-1, 1);
        expect(result).toMatchObject({ width: 800, height: 600 });
    });

    it("release() revokes the object URL exactly once", async () => {
        const result = await renderOrientedImage("src", { quarterTurns: 2, flipX: false }, loadImage);
        result.release();
        result.release();
        expect(revokedUrls).toEqual([ createdUrls[0] ]);
    });

    it("rejects when the source has no decodable dimensions", async () => {
        loadImage.mockResolvedValueOnce({ naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement);
        await expect(renderOrientedImage("src", { quarterTurns: 1, flipX: false }, loadImage)).rejects.toThrow();
    });

    it("rejects when the canvas cannot produce a blob", async () => {
        canvas.toBlob.mockImplementationOnce((callback: (blob: Blob | null) => void) => callback(null));
        await expect(renderOrientedImage("src", { quarterTurns: 1, flipX: false }, loadImage)).rejects.toThrow();
    });
});
