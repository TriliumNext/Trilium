import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import server from "../../../services/server";
import toast from "../../../services/toast";
import { DEFAULT_NODE_IMAGE_WIDTH, fitNodeImage, getNodeImageShape, loadImageData, measureImage, nearestNodeImageWidth, NODE_IMAGE_WIDTHS, shapeNodeImage, uploadNodeImage } from "./images";

vi.mock("../../../services/server", () => ({ default: { upload: vi.fn() } }));
vi.mock("../../../services/toast", () => ({ default: { showError: vi.fn() } }));

/**
 * Stands in for the browser's decoder, which no test environment carries: whatever is handed over
 * is a picture of the given size, or not a picture at all.
 */
function stubDecoder(size: { width: number, height: number } | null) {
    vi.stubGlobal("Image", class {

        naturalWidth = size?.width ?? 0;
        naturalHeight = size?.height ?? 0;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(_value: string) {
            queueMicrotask(() => (size ? this.onload?.() : this.onerror?.()));
        }

    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picture");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    stubDecoder({ width: 800, height: 600 });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("fitNodeImage", () => {
    it("draws a picture at the width it is given, keeping its proportions", () => {
        const image = { url: "a.png", width: 800, height: 600 };

        expect(fitNodeImage(image, 240)).toEqual({ url: "a.png", width: 240, height: 180 });
        // Whatever else the picture carries is kept, and a fractional height is rounded to a pixel.
        expect(fitNodeImage({ ...image, height: 601, fit: "cover" }, 240))
            .toEqual({ url: "a.png", width: 240, height: 180, fit: "cover" });
        // A picture of no width at all — one a map made elsewhere may carry — is drawn square
        // rather than not at all.
        expect(fitNodeImage({ url: "a.png", width: 0, height: 0 }, 240))
            .toEqual({ url: "a.png", width: 240, height: 240 });
    });
});

describe("nearestNodeImageWidth", () => {
    it("reads a width as the offered one it is closest to", () => {
        for (const width of NODE_IMAGE_WIDTHS) {
            expect(nearestNodeImageWidth(width)).toBe(width);
        }
        expect(nearestNodeImageWidth(60)).toBe(NODE_IMAGE_WIDTHS[0]);
        expect(nearestNodeImageWidth(200)).toBe(NODE_IMAGE_WIDTHS[1]);
        expect(nearestNodeImageWidth(4000)).toBe(NODE_IMAGE_WIDTHS[2]);
    });
});

describe("shapeNodeImage", () => {
    const image = { url: "a.png", width: 240, height: 180 };

    it("cuts a picture to a shape it did not come in, and asks it to fill the box", async () => {
        expect(await shapeNodeImage(image, "square")).toEqual({ url: "a.png", width: 240, height: 240, fit: "cover" });
        expect(await shapeNodeImage(image, "wide")).toEqual({ url: "a.png", width: 240, height: 135, fit: "cover" });
    });

    it("reads the picture again to give it its own shape back, keeping the width it is drawn at", async () => {
        // Cut to a square, a picture no longer says what it came in — so it is asked.
        stubDecoder({ width: 800, height: 600 });
        const square = await shapeNodeImage(image, "square");

        expect(await shapeNodeImage(square, "original")).toEqual({ url: "a.png", width: 240, height: 180, fit: undefined });
    });

    it("leaves a picture as it stands where it can no longer be read", async () => {
        stubDecoder(null);
        const square = { url: "gone.png", width: 240, height: 240, fit: "cover" } as const;

        expect(await shapeNodeImage(square, "original")).toBe(square);
    });
});

describe("getNodeImageShape", () => {
    it("reads the shape a picture is drawn in, its own being every other", () => {
        expect(getNodeImageShape({ url: "a.png", width: 240, height: 240 })).toBe("square");
        expect(getNodeImageShape({ url: "a.png", width: 240, height: 135 })).toBe("wide");
        expect(getNodeImageShape({ url: "a.png", width: 240, height: 180 })).toBe("original");

        // A height rounded to whole pixels still reads as the shape it was cut to.
        expect(getNodeImageShape({ url: "a.png", width: 121, height: 68 })).toBe("wide");
    });
});

describe("uploadNodeImage", () => {
    const file = new File([ "" ], "photo.png", { type: "image/png" });

    it("stores the picture on the note and hands it back at a size a node can wear", async () => {
        vi.mocked(server.upload).mockResolvedValue({ uploaded: true, url: "api/attachments/att1/image/photo.png" });

        expect(await uploadNodeImage("mapNote", file)).toEqual({
            url: "api/attachments/att1/image/photo.png",
            width: DEFAULT_NODE_IMAGE_WIDTH,
            height: DEFAULT_NODE_IMAGE_WIDTH * 600 / 800
        });
        expect(server.upload).toHaveBeenCalledWith("notes/mapNote/attachments/upload", file, undefined, "POST");
    });

    it("never draws a picture larger than it came", async () => {
        stubDecoder({ width: 64, height: 32 });
        vi.mocked(server.upload).mockResolvedValue({ uploaded: true, url: "api/attachments/att1/image/photo.png" });

        expect(await uploadNodeImage("mapNote", file)).toMatchObject({ width: 64, height: 32 });
    });

    it("says what went wrong when the note will not take it, and gives the node nothing", async () => {
        vi.mocked(server.upload).mockResolvedValue({ uploaded: false, message: "Too large." });
        expect(await uploadNodeImage("mapNote", file)).toBeNull();
        expect(vi.mocked(toast.showError).mock.calls[0][0]).toContain("Too large.");

        vi.mocked(server.upload).mockRejectedValue(new Error("Offline."));
        expect(await uploadNodeImage("mapNote", file)).toBeNull();
        expect(vi.mocked(toast.showError).mock.calls[1][0]).toContain("Offline.");

        // A file that is no picture is refused as well, whatever the note made of it.
        stubDecoder(null);
        vi.mocked(server.upload).mockResolvedValue({ uploaded: true, url: "api/attachments/att1/image/photo.png" });
        expect(await uploadNodeImage("mapNote", file)).toBeNull();
    });
});

describe("measureImage", () => {
    it("reads the size a picture comes in, and nothing for what is not one", async () => {
        expect(await measureImage(new Blob())).toEqual({ width: 800, height: 600 });

        stubDecoder(null);
        expect(await measureImage(new Blob())).toBeNull();
    });
});

describe("loadImageData", () => {
    it("fetches a picture once and carries it as data", async () => {
        const fetchPicture = vi.fn(async () => new Response(new Blob([ "bytes" ], { type: "image/png" })));
        vi.stubGlobal("fetch", fetchPicture);

        const data = await loadImageData("api/attachments/att1/image/a.png", 240);
        expect(data).toMatch(/^data:/);

        // Asked for again at the same size, it is the one already fetched: the SVG holding it is
        // written again at every pause in the editing.
        expect(await loadImageData("api/attachments/att1/image/a.png", 240)).toBe(data);
        expect(fetchPicture).toHaveBeenCalledTimes(1);
    });

    it("hands back nothing for a picture that cannot be fetched", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
        expect(await loadImageData("api/attachments/gone/image/a.png", 240)).toBeNull();

        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("Refused.");
        }));
        expect(await loadImageData("https://elsewhere.example/a.png", 240)).toBeNull();
    });
});
