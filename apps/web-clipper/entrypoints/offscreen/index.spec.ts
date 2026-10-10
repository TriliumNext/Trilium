import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import "./index";

const CROPPED_PNG = "data:image/png;base64,Q1JPUA==";

describe("offscreen document", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("crops the image on a canvas and answers asynchronously", async () => {
        const images: { src?: string, onload?: () => void }[] = [];
        vi.stubGlobal("Image", class {

            onload?: () => void;

            constructor() {
                images.push(this);
            }

            set src(value: string) {
                Object.defineProperty(this, "src", { value });
                setTimeout(() => this.onload?.());
            }

        });
        const drawImage = vi.fn();
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
            .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(CROPPED_PNG);

        const response = await sendMessage({
            type: "CROP_IMAGE",
            dataUrl: "data:image/png;base64,AAAA",
            cropRect: { x: 1, y: 2, width: 30, height: 40 }
        });

        expect(response).toBe(CROPPED_PNG);
        expect(images[0]?.src).toBe("data:image/png;base64,AAAA");
        expect(drawImage).toHaveBeenCalledWith(images[0], 1, 2, 30, 40, 0, 0, 30, 40);
        const canvas = getContext.mock.contexts[0] as HTMLCanvasElement;
        expect([ canvas.width, canvas.height ]).toEqual([ 30, 40 ]);

        getContext.mockReturnValue(null);
        const emptyCrop = {
            type: "CROP_IMAGE",
            dataUrl: "",
            cropRect: { x: 0, y: 0, width: 1, height: 1 }
        };
        await expect(sendMessage(emptyCrop)).resolves.toBe(CROPPED_PNG);
    });

    it("ignores other messages", async () => {
        const other = await fakeBrowser.runtime.onMessage.trigger({ type: "OTHER" }, {}, () => {});
        expect(other).toEqual([ undefined ]);
    });
});

function sendMessage(message: object) {
    return new Promise((resolve) => {
        void fakeBrowser.runtime.onMessage.trigger(message, {}, resolve);
    });
}
